#!/usr/bin/env python3
"""第 20 章的**胶水**：把 case 目录喂给你的 harness core，产出 `output.json`。

**这份文件不用改**（它只做编排：读材料 → 逐轮调用 core → 汇总 → 画图）。
你只需要实现 `harness/api.py` 里的五个函数（见那个文件的 TODO）。

运行：

    python3 harness/run.py <case目录> <output.json>      # 例如：python3 harness/run.py . output.json

case 目录里会有什么，见 `task.md` 的「数据字典」；口径也全在 `task.md` 里。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import math
import re
import tempfile
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent
FIG_NAME = "app_report_overview.png"
PREFERENCE_MARK = "报告只列异常指标"
FORGET_PATTERN = re.compile(r"忘掉\s*(MEM\d+)")
CLINICAL_MARKERS = ("直接告诉我", "你直接说")
BM25_K1, BM25_B = 1.5, 0.75


# ---------------------------------------------------------------- 读材料

def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_case(case_dir: Path) -> dict:
    limits = json.loads((case_dir / "limits.json").read_text(encoding="utf-8"))
    kb = {}
    kb_dir = case_dir / "kb"
    if kb_dir.is_dir():
        for path in sorted(kb_dir.glob("*.md")):
            kb[path.stem] = path.read_text(encoding="utf-8")
    return {
        "dir": case_dir,
        "limits": limits,
        "report_format": json.loads((case_dir / "report_format.json").read_text(encoding="utf-8")),
        "tools": json.loads((case_dir / "tools.json").read_text(encoding="utf-8"))["tools"],
        "calls": read_jsonl(case_dir / "tool_calls.jsonl"),
        "requests": read_jsonl(case_dir / "requests.jsonl"),
        "plan": {t["turn"]: t["steps"] for t in
                 json.loads((case_dir / "plan_stub.json").read_text(encoding="utf-8"))["turns"]},
        "kb": kb,
        "template": json.loads((case_dir / "template.json").read_text(encoding="utf-8")),
        "attachments": (case_dir / "attachments"),
    }


def web_sha256(web_dir: Path) -> str:
    """`web/` 的哈希（口径见 task.md §六）。"""
    acc = hashlib.sha256()
    if not web_dir.is_dir():
        return ""
    files = sorted((p for p in web_dir.rglob("*") if p.is_file()),
                   key=lambda p: p.relative_to(web_dir).as_posix())
    for path in files:
        acc.update(path.relative_to(web_dir).as_posix().encode("utf-8"))
        acc.update(b"\0")
        acc.update(path.read_bytes())
        acc.update(b"\0")
    return acc.hexdigest()[:16]


# ---------------------------------------------------------------- 检索（已给好）

def normalize(text: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", text.lower())


def grams(text: str) -> list[str]:
    s = normalize(text)
    if len(s) < 2:
        return [s] if s else []
    return [s[i:i + 2] for i in range(len(s) - 1)]


def bm25_rank(query: str, kb: dict[str, str], top_k: int) -> list[str]:
    docs = {pid: grams(text) for pid, text in kb.items()}
    n = len(docs)
    if not n:
        return []
    avgdl = sum(len(t) for t in docs.values()) / n
    qterms = set(grams(query))
    df = {term: sum(1 for t in docs.values() if term in t) for term in qterms}
    scored = []
    for pid, terms in docs.items():
        tf = Counter(terms)
        dl = len(terms)
        score = 0.0
        for term in qterms:
            f = tf.get(term, 0)
            if not f:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * f * (BM25_K1 + 1) / (f + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl))
        scored.append((pid, score))
    scored.sort(key=lambda x: (-round(x[1], 9), x[0]))
    return [pid for pid, _ in scored[:top_k]]


def tf_cosine_rank(query: str, kb: dict[str, str], top_k: int) -> list[str]:
    q = Counter(grams(query))
    qnorm = math.sqrt(sum(v * v for v in q.values())) or 1.0
    scored = []
    for pid, text in kb.items():
        d = Counter(grams(text))
        dnorm = math.sqrt(sum(v * v for v in d.values())) or 1.0
        dot = sum(v * d.get(term, 0) for term, v in q.items())
        scored.append((pid, dot / (qnorm * dnorm)))
    scored.sort(key=lambda x: (-round(x[1], 9), x[0]))
    return [pid for pid, _ in scored[:top_k]]


# ---------------------------------------------------------------- 工具层（已给好）

def validate_call(call: dict, tools: dict, thresholds: dict):
    """四级参数校验 + 一级业务校验（口径见 task.md §四）。"""
    spec = tools.get(call.get("tool"))
    if spec is None:
        return False, "unknown_tool", -32601
    args = call.get("args")
    if not isinstance(args, dict):
        return False, "invalid_args", -32602
    params = spec["parameters"]
    for name, decl in params.items():
        if decl.get("required") and name not in args:
            return False, "missing_required", -32602
    for name, decl in params.items():
        if name not in args:
            continue
        value = args[name]
        kind = decl["type"]
        if kind == "string" and not isinstance(value, str):
            return False, "type_mismatch", -32602
        if kind == "number" and (isinstance(value, bool) or not isinstance(value, (int, float))):
            return False, "type_mismatch", -32602
    if call["tool"] == "flag_metric" and args["item"] not in thresholds:
        return False, "unknown_item", -32602
    return True, "", 0


def mock_execute(call: dict, thresholds: dict) -> str:
    item, value = call["args"]["item"], call["args"]["value"]
    return f"{item}={value} flag={flag_of(item, value, thresholds)}"


def flag_of(item: str, value: float, thresholds: dict) -> str:
    th = thresholds.get(item)
    if not th:
        return "unknown"
    if value < th["low"]:
        return "low"
    if value > th["high"]:
        return "high"
    return "normal"


# ---------------------------------------------------------------- 记忆（已给好）

def update_memory(entries: list[dict], text: str, seq: int) -> int:
    """偏好写入 / 遗忘（口径见 task.md §五）。"""
    for entry_id in FORGET_PATTERN.findall(text):
        for entry in entries:
            if entry["entry_id"] == entry_id and entry["state"] == "active":
                entry["state"] = "forgotten"
    if PREFERENCE_MARK in text:
        if not any(e["state"] == "active" and e["fact"] == PREFERENCE_MARK for e in entries):
            seq += 1
            entries.append({"entry_id": f"MEM{seq:02d}", "fact": PREFERENCE_MARK,
                            "category": "preference", "state": "active", "importance": 2})
    return seq


def active_preferences(entries: list[dict]) -> list[str]:
    return [e["fact"] for e in entries if e["state"] == "active"]


# ---------------------------------------------------------------- core 装载

def load_core():
    api_file = APP_DIR / "harness" / "api.py"
    spec = importlib.util.spec_from_file_location("app_harness_api", api_file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


# ---------------------------------------------------------------- 主流程

def run_case(case_dir: Path, app_dir: Path, fig_dir: Path = Path("figures")) -> dict:
    case = load_case(case_dir)
    limits = case["limits"]
    fmt = case["report_format"]
    thresholds = fmt["thresholds"]
    max_steps = int(limits["max_steps"])
    top_k = int(limits["top_k"])
    core = load_core()
    state = core.load(app_dir)

    tools = {t["name"]: t for t in case["tools"]}
    calls_by_id = {c["call_id"]: c for c in case["calls"]}

    entries: list[dict] = []
    seq = 0
    parsed: dict[str, dict] = {}          # name → 解析结果（同一附件只解析一次）
    rows: list[dict] = []                 # 累积的指标行（按附件出现顺序）
    trace: list[dict] = []
    retrieval: list[dict] = []
    answers: list[dict] = []
    refusals: list[dict] = []
    short: list[str] = []
    working: list[str] = []
    terminated: list[str] = []
    report: dict = {}

    for req in case["requests"]:
        t = int(req["turn"])
        text = req["user"]

        bm25_top = bm25_rank(text, case["kb"], top_k)
        cos_top = tf_cosine_rank(text, case["kb"], top_k)
        retrieval.append({"turn": t, "bm25_top3": bm25_top, "cosine_top3": cos_top})

        pref_now = active_preferences(entries)
        ctx = {
            "turn": t, "message": text, "case": case, "state": state,
            "tools": tools, "calls_by_id": calls_by_id, "thresholds": thresholds,
            "formats": fmt, "kb_top": bm25_top, "attachments_dir": case["attachments"],
            "parsed": parsed, "rows": rows, "preferences": pref_now,
            "preference_ids": [e["entry_id"] for e in entries if e["state"] == "active"],
            "max_steps": max_steps, "executed": [],
        }

        steps = case["plan"].get(t, [])
        done = False
        for index, step in enumerate(steps[:max_steps], start=1):
            observation = core.plan_step(state, step, ctx)
            trace.append({"turn": t, "step": index, "action": step["action"],
                          "observation": str(observation)})
            if step["action"] == "finish":
                done = True
                break
        terminated.append("done" if done else "max_steps")

        seq = update_memory(entries, text, seq)
        # 报告要反映**记忆更新之后**的偏好（遗忘/新增都在这一轮生效），见 task.md §五
        ctx["preferences"] = active_preferences(entries)
        ctx["preference_ids"] = [e["entry_id"] for e in entries if e["state"] == "active"]

        if any(marker in text for marker in CLINICAL_MARKERS):
            refusal = core.refusal(state, t, text)
            refusals.append(refusal)
            answers.append({"turn": t, "reply": refusal["reply"], "citations": []})
        else:
            answer = core.build_answer(state, t, text, ctx)
            answers.append({"turn": t, "reply": answer.get("reply", ""),
                            "citations": answer.get("citations", [])})

        working = (working + [f"T{t}: {text[:20]}"])[-int(limits["window"]):]
        short.append(f"T{t}: 步 {index} / 行 {len(rows)} / 命中 {bm25_top[0] if bm25_top else '-'}")

        report = core.build_report(state, ctx)

    tool_calls = []
    for call in case["calls"]:
        ok, reason, code = validate_call(call, tools, thresholds)
        tool_calls.append({
            "call_id": call["call_id"], "tool": call["tool"], "args_valid": ok,
            "status": "executed" if ok else "rejected", "error_code": code,
            "rejected_reason": reason,
            "result_summary": mock_execute(call, thresholds) if ok else "",
        })

    escalations = core.scan_safety(state, rows, fmt)
    meta = core.load(app_dir)
    web_digest = web_sha256(app_dir / "web")

    checksum = hashlib.sha256(json.dumps(
        [[e["turn"], e["step"], e["action"], e["observation"]] for e in trace],
        ensure_ascii=False).encode("utf-8")).hexdigest()[:12]

    abnormal = [r for r in rows if r["flag"] != "normal"]
    plot_overview(trace, case["requests"], rows, abnormal, fig_dir)

    return {
        "app": {
            "title": meta.get("title", ""),
            "scenario": meta.get("scenario", ""),
            "entry": meta.get("entry", ""),
            "theme": meta.get("theme", {}),
            "attachments": meta.get("attachments", []),
            "visibility": meta.get("visibility", ""),
            "web_sha256": web_digest,
            "template_web_sha256": case["template"]["template_web_sha256"],
        },
        "attachments": [{k: v for k, v in item.items() if k in ("name", "kind", "chars", "checksum")}
                        for item in parsed.values()],
        "harness": {"turns": len(case["requests"]), "max_steps": max_steps,
                    "steps_total": len(trace), "terminated": terminated},
        "trace": trace,
        "tool_calls": tool_calls,
        "memory": {
            "working": working, "short": short,
            "long": {k: [e for e in entries if e["state"] == k]
                     for k in ("active", "superseded", "forgotten")},
        },
        "retrieval": retrieval,
        "answers": answers,
        "report": report,
        "safety": {"escalations": escalations, "refusals": refusals},
        "metrics": {
            "tool_executed": sum(1 for c in tool_calls if c["args_valid"]),
            "tool_rejected": sum(1 for c in tool_calls if not c["args_valid"]),
            "report_rows": len(rows),
            "abnormal_rows": len(abnormal),
            "trace_checksum": checksum,
        },
        "figures": [{
            "path": f"figures/{FIG_NAME}",
            "takeaway": f"共登记 {len(rows)} 行指标，其中 {len(abnormal)} 行超出参考区间；"
                        f"{len(trace)} 步循环里有 {terminated.count('max_steps')} 轮触到步数上限。",
        }],
        "notes": (
            "这一章的重点不是再写一遍循环，而是把 harness 接到**真应用**上："
            "附件必须先被解析成结构化行，报告才能逐字段复核；否则所谓报告只是把 PDF 的文本换个地方放。"
            "解析 PDF 与 DOCX 都自己写（环境里没有 pypdf / python-docx）：PDF 抽未压缩内容流里的 Tj 文本、"
            "DOCX 解 zip 取 document.xml 里的 w:t —— 看懂格式比调库更能说明你理解了「附件」。"
            "偏好记忆让报告只列异常项，这是记忆真的在改变输出，而不是只写在字段里。"
            "安全边界上，超出参考区间的行只升级、诊断式提问直接拒答：读数可能是测错的，诊断必须由医生作出。"
            "局限：本实验的 PDF 是约定形态（未压缩文本流），真实 PDF 会有压缩流与 CJK 字体；"
            "图片只登记尺寸不做识别；前端是零依赖模板改的，没有构建链与状态管理；"
            "分享与权限由平台托管提供，本地只验证页面与接口能跑通。"
        ),
    }


def plot_overview(trace: list[dict], requests: list[dict], rows: list[dict],
                  abnormal: list[dict], fig_dir: Path) -> str:
    fig_dir.mkdir(parents=True, exist_ok=True)
    turns = [int(r["turn"]) for r in requests]
    steps = [sum(1 for s in trace if s["turn"] == t) for t in turns]
    plt.figure(figsize=(6, 3.2))
    plt.bar([f"T{t}" for t in turns], steps, color="#4c72b0", label="steps")
    plt.plot([f"T{t}" for t in turns], [len(rows)] * len(turns), color="#dd8452",
             marker="o", label="rows (final)")
    plt.plot([f"T{t}" for t in turns], [len(abnormal)] * len(turns), color="#55a868",
             marker="s", label="abnormal (final)")
    plt.title("Steps and parsed rows per turn")
    plt.xlabel("turn")
    plt.ylabel("count")
    plt.legend(fontsize=8)
    plt.tight_layout()
    path = fig_dir / FIG_NAME
    plt.savefig(path, dpi=110)
    plt.close()
    return str(path)


def run_case_to_file(case_dir: Path, out_path: Path, app_dir: Path) -> None:
    out = run_case(case_dir, app_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir} → {out_path}")


def regen_expected() -> None:
    for case_dir in sorted(p for p in (APP_DIR.parent / "problem" / "cases").iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            out = run_case(case_dir, APP_DIR, Path(tmp))
        expected = {k: v for k, v in out.items() if k not in ("figures", "notes")}
        fmt = json.loads((case_dir / "report_format.json").read_text(encoding="utf-8"))
        expected["report"] = {
            "section_names": [s["name"] for s in out["report"]["sections"]],
            "section_min_chars": [s["min_chars"] for s in fmt["sections"]],
            "metric_rows": out["report"]["metric_rows"],
            "counts": out["report"]["counts"],
        }
        path = case_dir / "expected.json"
        path.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[regen] {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()
    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>，或用 --regen-expected")
    run_case_to_file(Path(args.case_dir), Path(args.out_path), APP_DIR)


if __name__ == "__main__":
    main()
