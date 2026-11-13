"""平台自带的 **agent harness**（学生不用写这一层）。

分工（第 20 章的口径）：

| 谁 | 负责什么 |
|---|---|
| **平台（本文件 + `app_host.py`）** | 解析附件、维护会话与记忆、调模型代理、渲染报告、安全兜底、托管与分享 |
| **学生的 Skill（`skill/scripts/api.py`）** | 只写"具体实验流程"：拿到已解析的会议与附件 → 决定怎么判断/怎么写报告/什么时候该拒答 |

所以学生交付物只有两样：`SKILL.md` + `scripts/`（实现 `handle()`）。
入口约定（与平台契约一致）：

```python
def handle(state: dict, message: str, attachments: list[dict], session: dict) -> dict:
    # attachments: [{"name","kind","via","text","rows":[{"item","value","unit"}]}]
    # session:    跨轮状态（平台会给一个 memory 列表）
    return {"reply": "...", "report": {...} 或 None, "citations": [{"kind","ref"}]}
```

`state` 里平台会放：`thresholds`（参考区间，来自 `SKILL.md` 的同级 `report_format.json`，可选）、
`kb`（知识库条目，可选）、`limits`（`top_k` 等）。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import struct
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROW_PATTERN = re.compile(r"^([A-Za-z][A-Za-z0-9_]*)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(\S+)$")
TEXT_PATTERN = re.compile(r"\(((?:\\.|[^\\)])*)\)\s*Tj")
PARA_PATTERN = re.compile(r"<w:p[ >].*?</w:p>", re.S)
TEXT_NODE_PATTERN = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.S)

VISION_PROMPT = (
    "读出图中每一行检验数据，按「指标,数值,单位」输出，一行一条，不要解释、不要代码块。"
    "若某行不是三段式数据就跳过。"
)

CLINICAL_MARKERS = ("直接告诉我", "你直接说", "是不是", "能不能确诊")


# ---------------------------------------------------------------- 模型调用

def call_llm(messages: list[dict], max_tokens: int = 800, **options) -> dict:
    """调模型：优先平台代理（容器里没有 key），没配代理时回退直连。"""
    base = (os.environ.get("APP_LLM_BASE_URL") or "").rstrip("/")
    token = os.environ.get("APP_LLM_TOKEN")
    if base and token:
        payload = {"messages": messages, "max_tokens": max_tokens, **options}
        req = urllib.request.Request(
            f"{base}/chat", data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "X-App-Token": token},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.loads(resp.read().decode())
        except urllib.error.URLError as exc:
            raise RuntimeError(f"平台 LLM 代理不可用（{base}）：{exc}") from exc
        # 平台 HTTP 响应被统一包成 {code,data,message}
        if isinstance(body, dict) and isinstance(body.get("data"), dict) and "choices" in body["data"]:
            body = body["data"]
        return body

    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("既没有平台代理（APP_LLM_BASE_URL/APP_LLM_TOKEN），也没有 DEEPSEEK_API_KEY")
    url = (os.environ.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")
    payload = {
        "model": os.environ.get("DEEPSEEK_MODEL") or "deepseek-flash",
        "messages": messages, "max_tokens": max_tokens, **options,
    }
    req = urllib.request.Request(
        f"{url}/chat/completions", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError as exc:
        raise RuntimeError(f"模型直连失败（{url}）：{exc}") from exc


# ---------------------------------------------------------------- 附件解析（平台能力）

def _unescape_pdf(text: str) -> str:
    return text.replace(r"\(", "(").replace(r"\)", ")").replace(r"\\", "\\")


def parse_pdf(path: Path) -> list[str]:
    raw = path.read_bytes()
    lines: list[str] = []
    for stream in re.findall(rb"stream\r?\n(.*?)\r?\nendstream", raw, re.S):
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
        text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        if text.strip():
            lines.append(text)
    return lines


def _png_size(path: Path) -> tuple[int, int]:
    head = path.read_bytes()[:33]
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return 0, 0
    return struct.unpack(">II", head[16:24])


def parse_attachment(info: dict) -> dict:
    """把一份附件读成 {name, kind, via, text, rows, chars, checksum}。

    PDF / DOCX 用标准库自己解；**图片没有文本层** → 走视觉模型。
    这些都是平台能力，学生的 Skill 拿到的已经是解析好的结果。
    """
    path = Path(info["path"])
    kind = info["kind"]
    usage: dict = {}
    if kind == "pdf":
        lines, via = parse_pdf(path), "text"
    elif kind == "docx":
        lines, via = parse_docx(path), "text"
    elif kind == "image":
        encoded = base64.b64encode(path.read_bytes()).decode()
        data = call_llm(
            [{"role": "user", "content": [
                {"type": "text", "text": VISION_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}},
            ]}],
            max_tokens=800, temperature=0, reasoning_effort="none",
        )
        usage = data.get("usage") or {}
        text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        lines, via = [line for line in text.splitlines() if line.strip()], "vision"
    else:
        lines, via = [], "text"

    rows = []
    for line in lines:
        m = ROW_PATTERN.match(line.strip())
        if m:
            rows.append({"item": m.group(1), "value": float(m.group(2)), "unit": m.group(3)})
    if via == "vision":
        canonical = "\n".join(f"{r['item']},{r['value']:g},{r['unit']}" for r in rows)
        checksum = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]
        chars = 0
    else:
        canonical = "\n".join(line.strip() for line in lines)
        checksum = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]
        chars = sum(len(line) for line in lines)
    width, height = _png_size(path) if kind == "image" else (0, 0)
    return {
        "name": info["name"], "kind": kind, "via": via, "chars": chars,
        "text": "\n".join(lines), "rows": rows, "checksum": checksum,
        "width": width, "height": height, "usage": usage,
    }


# ---------------------------------------------------------------- 记忆（平台能力）

def remember(session: dict, fact: str, category: str = "preference") -> dict:
    """写一条记忆（同 fact 只留一条 active）。"""
    entries = session.setdefault("memory", [])
    for entry in entries:
        if entry.get("state") == "active" and entry.get("fact") == fact:
            return entry
    entry = {"entry_id": f"MEM{len(entries) + 1:02d}", "fact": fact,
             "category": category, "state": "active"}
    entries.append(entry)
    return entry


def forget(session: dict, entry_id: str) -> None:
    for entry in session.get("memory", []):
        if entry.get("entry_id") == entry_id and entry.get("state") == "active":
            entry["state"] = "forgotten"


def active_memory(session: dict) -> list[dict]:
    return [e for e in session.get("memory", []) if e.get("state") == "active"]


# ---------------------------------------------------------------- 安全兜底（平台能力）

def safety_guard(message: str) -> dict | None:
    """诊断式提问的平台兜底：Skill 也可以自己判，但这一层保证"不会被绕过"。"""
    if any(marker in message for marker in CLINICAL_MARKERS):
        return {
            "turn": None,
            "reply": "这个结论我不能替你下：我只能汇总数值与出处，诊断必须由临床医生结合完整病史作出。",
            "reason": "诊断式提问：助手只提供读数与出处，结论必须由医生作出。",
        }
    return None


# ---------------------------------------------------------------- 一轮编排

def run_turn(skill, state: dict, message: str, files: list[dict], session: dict) -> dict:
    """解析附件 → 记忆 → 调学生 skill → 兜底安全 → 返回宿主需要的结构。"""
    attachments = [parse_attachment(info) for info in files]

    # 平台侧的记忆：把用户提到的"报告只列异常指标"之类偏好记下来（Skill 也可以自己写）
    if "报告只列异常指标" in message:
        remember(session, "报告只列异常指标")

    ctx = {
        "turn": int(session.get("turn", 1)),
        "memory": active_memory(session),
        "formats": state.get("report") or {},
        "kb": state.get("kb") or {},
        "limits": state.get("limits") or {},
    }

    result = skill.handle(ctx, message, attachments, session) or {}
    if not isinstance(result, dict):
        result = {"reply": str(result)}

    guard = safety_guard(message)
    if guard:
        result = {**result, "reply": guard["reply"], "citations": [], "safety": {"refusals": [guard]}}

    result.setdefault("reply", "")
    result.setdefault("report", None)
    result.setdefault("citations", [])
    result.setdefault("safety", {"escalations": [], "refusals": []})
    return result
