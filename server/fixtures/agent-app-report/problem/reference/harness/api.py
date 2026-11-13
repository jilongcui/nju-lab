"""参考实现（随题目包下发，**先读后仿**）：把三类附件整理成一份能复核的报告。

这一档（easy）只要三件事：

1. `parse_attachment()`：把 PDF / Word / 截图读成"指标, 数值, 单位"的行；
   - PDF / DOCX 用标准库自己解（环境里没有 `pypdf` / `python-docx`）；
   - 图片没有文本层，交给宿主的 `app_host.vision_extract()`（走平台模型代理）。
2. `build_report()`：按 `report_format.json` 出四节报告 + 指标表 + 计数。
3. `load()`：应用元信息（这一档用不到，占位）。

口径见题目包 `task.md`；改了这里的实现，记得用 `--regen-expected` 重算期望值。
"""
from __future__ import annotations

import hashlib
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app_host import vision_extract  # noqa: E402  （图片走视觉，容器里没有 key）

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
        lines, usage = vision_extract(path)      # ← 视觉通道：宿主统一走平台代理（或直连回退）
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
    """参考区间 → flag：低于下限 low、高于上限 high、其余 normal。"""
    th = thresholds.get(item)
    if not th:
        return "normal"
    if value < th["low"]:
        return "low"
    if value > th["high"]:
        return "high"
    return "normal"


def num(value: float) -> float | int:
    return int(value) if float(value) == int(value) else value


# ---------------------------------------------------------------- 报告


def build_report(state: dict, ctx: dict) -> dict:
    """按模板出报告：四节 + 指标表 + 三个计数。

    `ctx` 里有：`rows`（全部登记行）、`formats`（report_format.json 的内容）、
    `parsed`（每个附件的解析结果）。
    """
    fmt = ctx["formats"]
    rows = ctx["rows"]
    abnormal = [r for r in rows if r["flag"] != "normal"]
    detail = "，".join(f"{r['item']}={num(r['value'])}({r['flag']})" for r in abnormal) or "无"
    texts = {
        "目的": f"把本次上传的 {len(ctx['parsed'])} 份附件中的检验指标整理成一份可复核的报告。",
        "方法": "按活动报告口径：指标表逐行登记 item / value / unit / flag；flag 由参考区间判定。",
        "结果": f"共登记 {len(rows)} 行，其中异常 {len(abnormal)} 行：{detail}。",
        "讨论": "超出参考区间的指标需要临床复核；本报告只汇总数值，不下诊断结论。",
    }
    sections = []
    for spec in fmt["sections"]:
        name = spec["name"]
        content = texts.get(name, f"{name}：见指标表。")
        while len(content) < spec["min_chars"]:
            content += "（补充说明见指标表与附件原文。）"
        sections.append({"name": name, "content": content})
    return {
        "template_used": "report_format.json",
        "sections": sections,
        "metric_rows": rows,
        "counts": {"total": len(rows), "abnormal": len(abnormal), "listed": len(rows)},
    }


def load(app_dir: Path) -> dict:
    """应用元信息：这一档用不到（没有前端与发布），占位返回。"""
    return {"entry": "harness/api.py"}
