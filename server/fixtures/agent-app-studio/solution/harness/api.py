"""第 20 章（从 Harness 到可分享的智能体应用）的**教师侧解答样例 core**。

> ⚠️ **不随题目包下发**：`solution/` 与 `problem/` 平级，`(cd problem && zip …)` 永远带不上它。
> 两个用途：① 跑复验证明"题目可解"；② 算 `expected.json` 证明"判据不误杀"。

与 `skill-template/harness/api.py` 的函数签名完全一致 —— 学生写的那份替换它即可。

解析口径（见 task.md §一）：

- **PDF**：未压缩内容流 + `Tj` 文本操作符 → 正则抽文本行（**零依赖**）；
- **DOCX**：标准 OOXML（`zipfile` + `re`）→ 取 `word/document.xml` 里每个 `<w:p>` 的 `<w:t>`（**零依赖**）；
- **图片**：走**视觉模型**（`deepseek-flash` 支持 `image_url`）把图里的三段式数据行读出来，
  再用同一套 `ROW_PATTERN` 抽成结构化行 —— 图片没有文本层，靠 OCR/视觉才读得到。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import struct
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import bm25_rank, flag_of, tf_cosine_rank, validate_call  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app_host import vision_extract as host_vision  # noqa: E402  （视觉调用由宿主统一走平台代理）

ROW_PATTERN = re.compile(r"^([A-Za-z][A-Za-z0-9_]*)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(\S+)$")
TEXT_PATTERN = re.compile(r"\(((?:\\.|[^\\)])*)\)\s*Tj")
PARA_PATTERN = re.compile(r"<w:p[ >].*?</w:p>", re.S)
TEXT_NODE_PATTERN = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.S)


# ---------------------------------------------------------------- load

def load(app_dir: Path) -> dict:
    meta = json.loads((Path(app_dir) / "app.json").read_text(encoding="utf-8"))
    meta.setdefault("title", "随访助手")
    meta.setdefault("theme", {"mode": "light", "accent": "#2f6feb"})
    meta.setdefault("attachments", ["pdf", "docx", "image"])
    meta.setdefault("visibility", "owner")
    meta["_app_dir"] = str(app_dir)
    return meta


# ---------------------------------------------------------------- 解析

def _unescape_pdf(text: str) -> str:
    return text.replace(r"\(", "(").replace(r"\)", ")").replace(r"\\", "\\")


def parse_pdf(path: Path) -> list[str]:
    raw = path.read_bytes()
    streams = re.findall(rb"stream\r?\n(.*?)\r?\nendstream", raw, re.S)
    lines: list[str] = []
    for stream in streams:
        try:
            text = stream.decode("latin-1")
        except UnicodeDecodeError:
            continue
        for match in TEXT_PATTERN.findall(text):
            lines.append(_unescape_pdf(match))
    return lines


def parse_docx(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as zf:
        xml = zf.read("word/document.xml").decode("utf-8")
    lines = []
    for para in PARA_PATTERN.findall(xml):
        text = "".join(TEXT_NODE_PATTERN.findall(para))
        text = (text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"))
        if text.strip():
            lines.append(text)
    return lines


def text_checksum(lines: list[str]) -> str:
    """解析文本的校验和（口径见 task.md §一）：每行去首尾空白、按 `\\n` 连接，取 sha256 前 12 位。"""
    joined = "\n".join(line.strip() for line in lines)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:12]


def parse_attachment(info: dict) -> dict:
    path = Path(info["path"])
    kind = info["kind"]
    usage: dict = {}
    if kind == "pdf":
        lines, via = parse_pdf(path), "text"
    elif kind == "docx":
        lines, via = parse_docx(path), "text"
    elif kind == "image":
        lines, usage = host_vision(path)         # ← 视觉通道：宿主统一走平台代理（或直连回退）
        via = "vision"
    else:
        lines, via = [], "other"
    rows = []
    for line in lines:
        match = ROW_PATTERN.match(line.strip())
        if match:
            rows.append([match.group(1), float(match.group(2)), match.group(3)])
    if via == "vision":
        # 视觉输出格式会漂（空格差异），所以 checksum 只对**结构化行**算，跨次稳定
        canonical = "\n".join(f"{item},{value:g},{unit}" for item, value, unit in rows)
        checksum = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]
        chars = 0
    else:
        checksum = text_checksum(lines)
        chars = sum(len(line) for line in lines)
    return {
        "name": info["name"], "kind": kind, "via": via, "chars": chars,
        "lines": lines, "rows": rows, "checksum": checksum, "usage": usage,
    }


# ---------------------------------------------------------------- 工具

def flag_of(item: str, value: float, thresholds: dict) -> str:
    th = thresholds.get(item)
    if not th:
        return "unknown"
    if value < th["low"]:
        return "low"
    if value > th["high"]:
        return "high"
    return "normal"


def validate_call(call: dict, tools: dict, thresholds: dict):
    spec = tools.get(call.get("tool"))
    if spec is None:
        return False, "unknown_tool", -32601
    args = call.get("args")
    if not isinstance(args, dict):
        return False, "invalid_args", -32602
    for name, decl in spec["parameters"].items():
        if decl.get("required") and name not in args:
            return False, "missing_required", -32602
    for name, decl in spec["parameters"].items():
        if name not in args:
            continue
        value = args[name]
        if decl["type"] == "string" and not isinstance(value, str):
            return False, "type_mismatch", -32602
        if decl["type"] == "number" and (isinstance(value, bool) or not isinstance(value, (int, float))):
            return False, "type_mismatch", -32602
    if call["tool"] == "flag_metric" and args["item"] not in thresholds:
        return False, "unknown_item", -32602
    return True, "", 0


def num(value: float):
    return int(value) if float(value) == int(value) else value


# ---------------------------------------------------------------- 一步

def plan_step(state: dict, step: dict, ctx: dict) -> str:
    action = step["action"]
    if action == "recall":
        ids = ctx.get("preference_ids") or []
        return "记忆命中：" + (",".join(ids) if ids else "-")

    if action == "parse":
        name = step["file"]
        parsed = ctx["parsed"]
        if name not in parsed:
            info = {"name": name, "kind": _kind_of(name),
                    "path": str(Path(ctx["attachments_dir"]) / name)}
            info["size"] = Path(info["path"]).stat().st_size
            info.update(parse_attachment(info))
            parsed[name] = info
            for row in info["rows"]:
                ctx["rows"].append({
                    "item": row[0], "value": row[1], "unit": row[2],
                    "flag": flag_of(row[0], row[1], ctx["thresholds"]),
                })
        item = parsed[name]
        if item["via"] == "vision":
            state["_vision_calls"] = int(state.get("_vision_calls", 0)) + 1
            return f"解析 {name}：图片抽取 {len(item['rows'])} 行（视觉通道）"
        return f"解析 {name}：{len(item['rows'])} 行（{item['chars']} 字）"

    if action == "tool":
        call = ctx["calls_by_id"][step["call_id"]]
        ok, reason, _code = validate_call(call, ctx["tools"], ctx["thresholds"])
        if not ok:
            return f"rejected:{reason}"
        item = call["args"]["item"]
        value = call["args"]["value"]
        ctx["executed"].append(call["tool"])
        return f"{item}={num(value)} flag={flag_of(item, value, ctx['thresholds'])}"

    if action == "kb":
        return "检索命中：" + ",".join(ctx["kb_top"])

    return "完成"


def _kind_of(name: str) -> str:
    suffix = Path(name).suffix.lower().lstrip(".")
    if suffix == "pdf":
        return "pdf"
    if suffix == "docx":
        return "docx"
    if suffix in ("png", "jpg", "jpeg"):
        return "image"
    return "other"


# ---------------------------------------------------------------- 报告

def build_report(state: dict, ctx: dict) -> dict:
    fmt = ctx["formats"]
    rows = ctx["rows"]
    prefs = ctx.get("preferences") or []
    only_abnormal = any("只列异常" in fact for fact in prefs)
    listed = [r for r in rows if r["flag"] != "normal"] if only_abnormal else list(rows)
    abnormal = [r for r in rows if r["flag"] != "normal"]
    detail = "，".join(f"{r['item']}={num(r['value'])}({r['flag']})" for r in listed) or "无"
    top = ctx["kb_top"][0] if ctx["kb_top"] else "无"
    texts = {
        "目的": f"汇总本次上传的 {len(ctx['parsed'])} 份附件中的检验指标，形成一份可复核的报告。",
        "方法": ("按活动报告口径：指标表逐行登记 item / value / unit / flag；flag 由参考区间判定；"
                 f"只列异常项={'是' if only_abnormal else '否'}。"),
        "结果": f"共登记 {len(rows)} 行，其中异常 {len(abnormal)} 行，报告列出 {len(listed)} 行：{detail}。",
        "讨论": ("超出参考区间的指标需要临床复核；本报告只汇总数值与出处，不下诊断结论。"
                 f"口径依据见 {top}。"),
    }
    sections = []
    for spec in fmt["sections"]:
        name = spec["name"]
        content = texts.get(name, f"{name}：{detail}")
        while len(content) < spec["min_chars"]:
            content += "（补充说明见指标表与附件原文。）"
        sections.append({"name": name, "content": content})
    return {
        "template_used": "report_format.json",
        "sections": sections,
        "metric_rows": listed,
        "counts": {"total": len(rows), "abnormal": len(abnormal), "listed": len(listed)},
    }


# ---------------------------------------------------------------- 回复 / 拒答 / 越界

def build_answer(state: dict, turn: int, message: str, ctx: dict) -> dict:
    top = ctx["kb_top"][0] if ctx["kb_top"] else "无"
    rows = ctx["rows"]
    abnormal = [r for r in rows if r["flag"] != "normal"]
    reply = (f"第 {turn} 轮已整理：共 {len(rows)} 行指标，{len(abnormal)} 行超出参考区间；"
             f"报告已按口径生成，依据见 {top}。")
    return {"reply": reply,
            "citations": [{"kind": "kb", "ref": top}] if ctx["kb_top"] else []}


def refusal(state: dict, turn: int, message: str) -> dict:
    return {
        "turn": turn,
        "reply": "这个结论我不能替你下：只能汇总数值与出处，诊断必须由临床医生结合完整病史作出。",
        "reason": "是否感染/控制好不好属于诊断结论，助手只提供读数与出处，判断必须由临床医生作出。",
    }


def scan_safety(state: dict, rows: list[dict], fmt: dict) -> list[dict]:
    warn = fmt["messages"]["warn"]
    return [{"record_id": f"ROW{index:02d}", "item": row["item"], "value": num(row["value"]),
             "message": warn}
            for index, row in enumerate(rows, start=1) if row["flag"] != "normal"]


# ---------------------------------------------------------------- Web 入口（app_host 调用）

DEFAULT_FORMAT = {
    "sections": [
        {"name": "目的", "min_chars": 20},
        {"name": "方法", "min_chars": 20},
        {"name": "结果", "min_chars": 30},
        {"name": "讨论", "min_chars": 30},
    ],
    "metric_columns": ["item", "value", "unit", "flag"],
    "thresholds": {},
    "messages": {"warn": "该指标超出参考范围，请尽快由临床医生复核。"},
}


def _formats(state: dict) -> dict:
    """报告口径：优先用 `app.json` 的 `report`，没有就用默认四节（无阈值 ⇒ 全部 normal）。"""
    merged = json.loads(json.dumps(DEFAULT_FORMAT))
    merged.update(state.get("report") or {})
    return merged


def _kb(state: dict) -> dict[str, str]:
    kb_dir = Path(state.get("_app_dir") or ".") / "kb"
    if not kb_dir.is_dir():
        return {}
    return {p.stem: p.read_text(encoding="utf-8") for p in sorted(kb_dir.glob("*.md"))}


def handle(state: dict, message: str, attachments: list[dict], session: dict) -> dict:
    """Web 的一轮：`recall → 逐个 parse → kb → finish`（没有模型桩，动作序列固定）。

    与 case 判分用的是**同一套 core**（`plan_step` / `build_report` / `build_answer` / `scan_safety`），
    区别只在"决策序列"由宿主给定而不是 `plan_stub.json`。
    """
    session.setdefault("rows", [])
    session.setdefault("parsed", {})
    session.setdefault("preferences", [])
    if "报告只列异常指标" in message and not session["preferences"]:
        session["preferences"] = ["报告只列异常指标"]

    fmt = _formats(state)
    kb = _kb(state)
    ctx = {
        "turn": int(session.get("turn", 1)), "message": message, "state": state,
        "tools": {}, "calls_by_id": {}, "thresholds": fmt["thresholds"], "formats": fmt,
        "kb_top": bm25_rank(message, kb, 3) if kb else [],
        "attachments_dir": ".", "parsed": session["parsed"], "rows": session["rows"],
        "preferences": session["preferences"],
        "preference_ids": ["MEM01"] if session["preferences"] else [],
        "max_steps": 8, "executed": [],
    }
    trace = []
    steps = [{"action": "recall"}] + [{"action": "parse", "file": a["name"]} for a in attachments] + \
            [{"action": "kb"}, {"action": "finish"}]
    for index, step in enumerate(steps, start=1):
        if step["action"] == "parse":
            info = next((a for a in attachments if a["name"] == step["file"]), None)
            if info is None:
                continue
            ctx["attachments_dir"] = str(Path(info["path"]).parent)
        trace.append({"turn": ctx["turn"], "step": index, "action": step["action"],
                      "observation": plan_step(state, step, ctx)})

    if any(marker in message for marker in ("直接告诉我", "你直接说")):
        no = refusal(state, ctx["turn"], message)
        return {"reply": no["reply"], "report": build_report(state, ctx), "citations": [],
                "safety": {"escalations": [], "refusals": [no]}, "trace": trace}

    answer = build_answer(state, ctx["turn"], message, ctx)
    return {
        "reply": answer["reply"],
        "report": build_report(state, ctx),
        "citations": answer["citations"],
        "safety": {"escalations": scan_safety(state, ctx["rows"], fmt), "refusals": []},
        "trace": trace,
    }
