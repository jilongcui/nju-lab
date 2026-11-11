#!/usr/bin/env python3
"""第 19 章（智能体 Harness）的**教师侧解答样例**。

> ⚠️ **这份文件不随题目包下发**。它放在实验目录根下的 `solution/`（不在 `problem/` 里），
> 作用是两份**机器证明**：
> 1. **题目可解**：拿它跑一遍平台复验（`--skill /p/solution --problem /p/problem.zip`）应 2/2 通过；
> 2. **判据不误杀**：`expected.json` 由它算出来（口径钉死 ⇒ 结果唯一确定）。
>
> 学生拿到的是 `skill-template/`（只有 `SKILL.md`、`report.md` 与 TODO 空壳）。

它实现的六件事（就是 harness 的六个部件）：

  ① **模型接口层** —— `plan_stub.json` 当作模型决策（真实工程里这一层换成 API 调用）；
  ② **循环控制器** —— 按决策序列逐步执行、记 `trace`、尊重 `max_steps`、给出终止原因；
  ③ **工具层**     —— MCP 风格：名册 → 四级参数校验（-32601 / -32602）→ 业务校验 → mock 执行；
  ④ **记忆分层**   —— working（窗口）/ short（摘要）/ long（条目表，含更新与遗忘）；
  ⑤ **知识库**     —— 字符 2-gram + BM25 检索，并与 TF 余弦对照；
  ⑥ **安全边界**   —— 越界读数升级（固定话术）、要求下诊断的提问拒答。

用法：

  python3 scripts/harness.py <case目录> <output.json>   # 单个 case
  python3 scripts/harness.py --regen-expected           # 重算 expected.json（教师侧）

  # 教师侧复验（应 2/2 通过）
  docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low -e VERIFY_MAX_CASES=0 \
    -v "$PWD/server/fixtures/harness-agent:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
    nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/solution --problem /p/problem.zip \
    --out /outputs/harness-agent.json --timeout-ms 300000
"""
from __future__ import annotations

import argparse
import csv
import hashlib
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
CASES_DIR = HERE.parent.parent / "problem" / "cases"
FIG_DIR = Path("figures")
FIG_NAME = "harness_overview.png"

# 口径（全部写死在 task.md 里）
WEAK_PATTERN = re.compile(r"老是搞混\s*([^\s，。！？、,]+)\s*和\s*([^\s，。！？、,]+)")
CORRECT_PATTERN = re.compile(
    r"更正：?我其实不搞混\s*([^\s，。！？、,]+)\s*和\s*([^\s，。！？、,]+)\s*了")
CORRECT_NEW_PATTERN = re.compile(r"是搞混\s*([^\s，。！？、,]+)\s*和\s*([^\s，。！？、,]+)")
FORGET_PATTERN = re.compile(r"忘掉\s*(MEM\d+)")
REFUSAL_MARKERS = ("直接告诉我", "你直接说")
BM25_K1, BM25_B = 1.5, 0.75


# ---------------------------------------------------------------- 读输入

def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def read_case(case_dir: Path) -> dict:
    limits = json.loads((case_dir / "limits.json").read_text(encoding="utf-8"))
    with (case_dir / "records.csv").open(encoding="utf-8", newline="") as fh:
        records = list(csv.DictReader(fh))
    for r in records:
        r["value"] = float(r["value"])
    kb = {}
    for path in sorted((case_dir / "kb").glob("*.md")):
        kb[path.stem] = path.read_text(encoding="utf-8")
    return {
        "limits": limits,
        "records": records,
        "kb": kb,
        "tools": json.loads((case_dir / "tools.json").read_text(encoding="utf-8"))["tools"],
        "dialogue": read_jsonl(case_dir / "dialogue.jsonl"),
        "calls": read_jsonl(case_dir / "tool_calls.jsonl"),
        "plan": {t["turn"]: t["steps"] for t in
                 json.loads((case_dir / "plan_stub.json").read_text(encoding="utf-8"))["turns"]},
    }


# ---------------------------------------------------------------- ⑤ 检索

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
    avgdl = sum(len(t) for t in docs.values()) / n if n else 0.0
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


# ---------------------------------------------------------------- ③ 工具层

def out_of_range_rows(records: list[dict], thresholds: dict) -> list[dict]:
    out = []
    for r in records:
        th = thresholds.get(r["item"])
        if not th:
            continue
        if r["value"] < th["low"] or r["value"] > th["high"]:
            out.append(r)
    return out


def validate_call(call: dict, tools: dict, records: list[dict], out_ids: set[str]):
    """四级参数校验 + 一级业务校验。命中即停，返回 (args_valid, rejected_reason, error_code)。"""
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
        if decl["type"] == "string" and not isinstance(value, str):
            return False, "type_mismatch", -32602
        if decl["type"] == "integer" and (isinstance(value, bool) or not isinstance(value, int)):
            return False, "type_mismatch", -32602
    if call["tool"] == "escalate_value" and args["record_id"] not in out_ids:
        return False, "not_out_of_range", -32602
    return True, "", 0


def num(value: float):
    return int(value) if float(value) == int(value) else value


def mock_execute(call: dict, records: list[dict], kb: dict[str, str]) -> str:
    name, args = call["tool"], call["args"]
    if name == "lookup_record":
        rows = [r for r in records
                if r["patient_id"] == args["patient_id"] and r["item"] == args["item"]]
        if not rows:
            return f"{args['patient_id']}/{args['item']} 无记录"
        last = rows[-1]
        return f"{last['patient_id']}/{last['item']} 最近一次 {num(last['value']):g} {last['unit']}（{last['record_id']}）"
    if name == "summarize_metric":
        rows = [r for r in records if r["item"] == args["item"]]
        if not rows:
            return f"{args['item']} 无记录"
        mean = sum(r["value"] for r in rows) / len(rows)
        return f"{args['item']} 均值 {round(mean, args.get('decimals', 0))}"
    if name == "fetch_guideline":
        hit = sorted(pid for pid, text in kb.items() if args["item"] in text)
        return f"{args['item']} 的指南段落 {hit[0] if hit else '无'}"
    if name == "escalate_value":
        return f"{args['record_id']} 已登记升级"
    return "未实现"


# ---------------------------------------------------------------- ④ 记忆分层

def fact_pair(fact: str):
    m = WEAK_PATTERN.search(fact)
    return (m.group(1), m.group(2)) if m else None


def new_entry(state: dict, a: str, b: str) -> dict:
    state["seq"] += 1
    entry = {
        "entry_id": f"MEM{state['seq']:02d}",
        "fact": f"老是搞混 {a} 和 {b}",
        "category": "weak_point",
        "state": "active",
        "importance": 3,
    }
    state["entries"].append(entry)
    return entry


# ---------------------------------------------------------------- 主流程

def run_case(case_dir: Path, fig_dir: Path) -> dict:
    case = read_case(case_dir)
    limits = case["limits"]
    thresholds = limits["thresholds"]
    max_steps = int(limits["max_steps"])
    window = int(limits["window"])
    top_k = int(limits["top_k"])
    warn_message = limits["messages"]["warn"]

    tools = {t["name"]: t for t in case["tools"]}
    calls_by_id = {c["call_id"]: c for c in case["calls"]}
    out_rows = out_of_range_rows(case["records"], thresholds)
    out_ids = {r["record_id"] for r in out_rows}

    mem = {"seq": 0, "entries": []}
    working: list[str] = []
    short: list[str] = []
    applied: list[dict] = []
    trace: list[dict] = []
    retrieval: list[dict] = []
    answers: list[dict] = []
    refusals: list[dict] = []
    terminated: list[str] = []

    for turn in case["dialogue"]:
        t = int(turn["turn"])
        text = turn["user"]

        # ① 检索（BM25 与 TF 余弦对照）—— 每轮开始前完成，与 loop 顺序无关
        bm25_top = bm25_rank(text, case["kb"], top_k)
        cos_top = tf_cosine_rank(text, case["kb"], top_k)
        retrieval.append({"turn": t, "bm25_top3": bm25_top, "cosine_top3": cos_top})

        # ② 记忆应用（用**进入本轮之前**的 active 条目；**更正轮不记应用**，口径见 task.md）
        used = []
        correcting = bool(CORRECT_PATTERN.search(text))
        if not correcting:
            for entry in mem["entries"]:
                if entry["state"] != "active":
                    continue
                pair = fact_pair(entry["fact"])
                if pair and pair[0] in text and pair[1] in text:
                    used.append(entry["entry_id"])
                    applied.append({"turn": t, "entry_id": entry["entry_id"]})

        # ③ loop：按模型决策序列执行，尊重 max_steps
        steps = case["plan"].get(t, [])
        done = False
        index = 0
        executed_ids: list[str] = []
        for index, step in enumerate(steps[:max_steps], start=1):
            action = step["action"]
            if action == "recall":
                obs = "记忆命中：" + (",".join(used) if used else "-")
            elif action == "tool":
                call = calls_by_id[step["call_id"]]
                ok, reason, _code = validate_call(call, tools, case["records"], out_ids)
                if ok:
                    executed_ids.append(call["tool"])
                    obs = mock_execute(call, case["records"], case["kb"])
                else:
                    obs = f"rejected:{reason}"
            elif action == "kb":
                obs = "检索命中：" + ",".join(bm25_top)
            else:  # finish
                obs = "完成"
            trace.append({"turn": t, "step": index, "action": action, "observation": obs})
            if action == "finish":
                done = True
                break
        terminated.append("done" if done else "max_steps")

        # ④ 记忆更新：遗忘 → 更正 → 写入（三种句式互斥，顺序不影响结果）
        for entry_id in FORGET_PATTERN.findall(text):
            for entry in mem["entries"]:
                if entry["entry_id"] == entry_id and entry["state"] == "active":
                    entry["state"] = "forgotten"
        m = CORRECT_PATTERN.search(text)
        if m:
            old_a, old_b = m.group(1), m.group(2)
            for entry in mem["entries"]:
                if entry["state"] == "active" and fact_pair(entry["fact"]) == (old_a, old_b):
                    entry["state"] = "superseded"
            new = CORRECT_NEW_PATTERN.search(text)
            if new:
                new_entry(mem, new.group(1), new.group(2))
        else:
            for a, b in WEAK_PATTERN.findall(text):
                if not any(e["state"] == "active" and fact_pair(e["fact"]) == (a, b)
                           for e in mem["entries"]):
                    new_entry(mem, a, b)

        # ⑤ 安全边界：拒答优先于引用
        if any(marker in text for marker in REFUSAL_MARKERS):
            refusals.append({
                "turn": t,
                "reason": "是否感染属于诊断结论，助手只能提供读数与指南出处，必须由临床医生结合症状与体征判断。",
            })
            answer = {"turn": t, "answer": "这个结论我不能替你下：只能给读数与出处，诊断由医生作出。", "citations": []}
        else:
            top1 = bm25_top[0] if bm25_top else "无"
            answer = {
                "turn": t,
                "answer": f"第 {t} 轮已按请求处理（工具：{','.join(executed_ids) or '无'}），指南出处见 {top1}。",
                "citations": [{"kind": "kb", "ref": top1}] if bm25_top else [],
            }
        answers.append(answer)

        # ⑥ 记忆三层：working 窗口 / short 摘要
        working.append(f"T{t}: {text[:20]}")
        working = working[-window:]
        short.append(
            f"T{t}: 步 {index} / 工具 {','.join(executed_ids) or '-'} / 命中 {bm25_top[0] if bm25_top else '-'}")

    # ⑦ 工具调用全量记账（含未被决策序列引用的那些）
    tool_calls_out = []
    n_executed = n_rejected = 0
    for call in case["calls"]:
        ok, reason, code = validate_call(call, tools, case["records"], out_ids)
        if ok:
            n_executed += 1
            tool_calls_out.append({
                "call_id": call["call_id"], "tool": call["tool"], "args_valid": True,
                "status": "executed", "error_code": 0, "rejected_reason": "",
                "result_summary": mock_execute(call, case["records"], case["kb"]),
            })
        else:
            n_rejected += 1
            tool_calls_out.append({
                "call_id": call["call_id"], "tool": call["tool"], "args_valid": False,
                "status": "rejected", "error_code": code, "rejected_reason": reason,
                "result_summary": "",
            })

    long_term = {k: [e for e in mem["entries"] if e["state"] == k]
                 for k in ("active", "superseded", "forgotten")}

    checksum = hashlib.sha256(json.dumps(
        [[e["turn"], e["step"], e["action"], e["observation"]] for e in trace],
        ensure_ascii=False).encode("utf-8")).hexdigest()[:12]

    escalations = [{
        "record_id": r["record_id"], "item": r["item"], "value": num(r["value"]),
        "message": warn_message,
    } for r in out_rows]

    fig_path = plot_trace(trace, case["dialogue"], fig_dir)

    out = {
        "harness": {
            "turns": len(case["dialogue"]),
            "max_steps": max_steps,
            "steps_total": len(trace),
            "terminated": terminated,
        },
        "trace": trace,
        "tool_calls": tool_calls_out,
        "memory": {
            "working": working,
            "short": short,
            "long": long_term,
            "applied": applied,
        },
        "retrieval": retrieval,
        "answers": answers,
        "safety": {"escalations": escalations, "refusals": refusals},
        "metrics": {
            "top3_diff_turns": [r["turn"] for r in retrieval if r["bm25_top3"] != r["cosine_top3"]],
            "tool_executed": n_executed,
            "tool_rejected": n_rejected,
            "trace_checksum": checksum,
        },
        "figures": [{
            "path": str(Path(fig_dir.name) / FIG_NAME).replace("\\", "/"),
            "takeaway": f"每轮循环步数最多 {max(1, max(s['step'] for s in trace))} 步，"
                        f"共 {len(trace)} 步；第 {terminated.index('max_steps') + 1} 轮触到上限被截断"
                        if "max_steps" in terminated else
                        f"每轮循环步数最多 {max(1, max(s['step'] for s in trace))} 步，"
                        f"共 {len(trace)} 步，全部按终止条件正常收尾。",
        }],
        "notes": (
            "harness 只负责循环与状态，判断留给规则与模型：loop 每步都要落 observation，"
            "否则出错时无法定位是哪一步偏离；max_steps 是防失控的硬边界，触到就必须停并如实记 max_steps。"
            "记忆分三层是因为代价不同：working 留最近对话（省 token、会忘），short 压成一行摘要（丢细节），"
            "long 是可检索的条目表（要维护 superseded/forgotten 两种状态，否则会拿旧结论回答新问题）。"
            "工具调用必须先校验参数再执行，非法请求要如实记 rejected —— 假装成功比失败更危险；"
            "错误码分 -32601（未知工具）与 -32602（参数类）是为了让调用方知道该改什么。"
            "检索采用字符 2-gram + BM25，与 TF 余弦对照可以看出：不做长度归一化时短精准文档会被长综述压过去。"
            "安全边界上，越界读数只升级不解释、诊断式提问直接拒答：读数可能是测错的，"
            "而诊断必须由医生结合完整病史作出。局限：模型是桩（不是真 LLM）、工具是本地 mock（不是真 MCP 服务）、"
            "检索只做字面匹配、记忆是本地条目表而非记忆服务。"
        ),
    }
    return out


def plot_trace(trace: list[dict], dialogue: list[dict], fig_dir: Path) -> Path:
    fig_dir.mkdir(parents=True, exist_ok=True)
    turns = [int(t["turn"]) for t in dialogue]
    steps = [sum(1 for s in trace if s["turn"] == t) for t in turns]
    plt.figure(figsize=(6, 3.2))
    plt.bar([f"T{t}" for t in turns], steps, color="#4c72b0")
    plt.title("Steps per turn (harness loop)")
    plt.xlabel("turn")
    plt.ylabel("steps")
    plt.tight_layout()
    path = fig_dir / FIG_NAME
    plt.savefig(path, dpi=110)
    plt.close()
    return path


def run_case_to_file(case_dir: Path, out_path: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        out = run_case(case_dir, Path(tmp))
    out["figures"][0]["path"] = f"{FIG_DIR.name}/{FIG_NAME}"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def regen_expected() -> None:
    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            out = run_case(case_dir, Path(tmp))
        expected = {
            "harness": out["harness"],
            "trace": out["trace"],
            "tool_calls": out["tool_calls"],
            "memory": out["memory"],
            "retrieval": out["retrieval"],
            "answers": [{"turn": a["turn"], "citations": a["citations"]} for a in out["answers"]],
            "safety": out["safety"],
            "metrics": out["metrics"],
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
    run_case_to_file(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
