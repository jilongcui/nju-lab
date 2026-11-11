#!/usr/bin/env python3
"""应用宿主（**教师提供，学生不要改**）。

它把"学生的 harness core"包成一个能跑的 Web 应用：静态前端 + 上传 + 会话 + 报告渲染。
平台侧的应用运行容器跑的就是这份文件（与题目包下发的这份**逐字节相同**）。

```
python3 app_host.py            # 默认 127.0.0.1:9200
APP_PORT=9300 python3 app_host.py
```

约定（`task.md` §一）：
- 你只需要实现 `harness/api.py` 的 `load()` 与 `handle()`；
- 宿主负责：静态文件、`multipart/form-data` 解析、附件落盘、会话（跨轮）持久化；
- 平台侧会把 `APP_LLM_BASE_URL` 指到**平台代理**（容器里没有大模型 key）；
  没有这个环境变量时，`call_llm()` 会抛错 —— 题目给的 case 用 `plan_stub.json`，不需要真模型。

接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/` `/theme.css` `/app.js` | 静态前端（`web/`） |
| GET  | `/api/app` | `app.json` 的元信息（标题、主题、支持的附件类型） |
| GET  | `/api/health` | 健康检查（平台拉起容器后探活用） |
| POST | `/api/chat` | `multipart/form-data`：`message` + `session?` + `attachments*` |
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import uuid
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(os.environ.get("APP_DIR") or Path(__file__).resolve().parent)
DATA_DIR = Path(os.environ.get("APP_DATA_DIR") or "/tmp/app-data")
WEB_DIR = APP_DIR / "web"
API_FILE = APP_DIR / "harness" / "api.py"
APP_JSON = APP_DIR / "app.json"

STATE: dict = {}
SESSIONS: dict[str, dict] = {}


# ---------------------------------------------------------------- core 装载

def load_core():
    if not API_FILE.exists():
        raise RuntimeError(f"缺少 harness/api.py：{API_FILE}")
    spec = importlib.util.spec_from_file_location("app_harness_api", API_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def app_meta() -> dict:
    meta = {"title": "随访助手", "subtitle": "", "theme": {"mode": "light", "accent": "#2f6feb"},
            "attachments": ["pdf", "docx", "image"]}
    if APP_JSON.exists():
        meta.update(json.loads(APP_JSON.read_text(encoding="utf-8")))
    return meta


# ---------------------------------------------------------------- 会话与附件

def session_path(session_id: str) -> Path:
    return DATA_DIR / "sessions" / f"{session_id}.json"


def load_session(session_id: str | None) -> tuple[str, dict]:
    if session_id:
        path = session_path(session_id)
        if path.exists():
            return session_id, json.loads(path.read_text(encoding="utf-8"))
    new_id = uuid.uuid4().hex[:12]
    return new_id, {"turn": 0, "memory": [], "history": []}


def save_session(session_id: str, session: dict) -> None:
    path = session_path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session, ensure_ascii=False, indent=2), encoding="utf-8")


def kind_of(name: str) -> str:
    suffix = Path(name).suffix.lower().lstrip(".")
    if suffix == "pdf":
        return "pdf"
    if suffix in ("docx", "doc"):
        return "docx"
    if suffix in ("png", "jpg", "jpeg", "gif", "webp"):
        return "image"
    return "other"


def save_upload(session_id: str, name: str, payload: bytes) -> dict:
    safe = Path(name).name or "upload.bin"
    target = DATA_DIR / "uploads" / session_id / safe
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return {"name": safe, "kind": kind_of(safe), "size": len(payload), "path": str(target)}


# ---------------------------------------------------------------- multipart

def parse_multipart(content_type: str, body: bytes) -> tuple[dict[str, str], list[tuple[str, str, bytes]]]:
    """返回 (文本字段, [(字段名, 文件名, 字节)])。用标准库 email 解析，零依赖。"""
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
    msg = BytesParser(policy=email_policy).parsebytes(header + body)
    fields: dict[str, str] = {}
    files: list[tuple[str, str, bytes]] = []
    if not msg.is_multipart():
        return fields, files
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""
        if filename:
            files.append((name or "attachments", filename, payload))
        else:
            fields[name or ""] = payload.decode("utf-8", "replace")
    return fields, files


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "AgentAppHost/1.0"

    def log_message(self, fmt: str, *args) -> None:  # 安静一点
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, payload: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, status: int, data: dict) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/api/health":
            return self._json(200, {"ok": True})
        if path == "/api/app":
            return self._json(200, app_meta())
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (WEB_DIR / rel).resolve()
        if not str(target).startswith(str(WEB_DIR.resolve())) or not target.is_file():
            return self._json(404, {"error": "not found"})
        types = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8", ".png": "image/png",
                 ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8"}
        return self._send(200, target.read_bytes(), types.get(target.suffix, "application/octet-stream"))

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/api/chat":
            return self._json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        content_type = self.headers.get("Content-Type") or ""
        if "multipart/form-data" not in content_type:
            return self._json(400, {"error": "需要 multipart/form-data"})
        fields, files = parse_multipart(content_type, body)
        session_id, session = load_session(fields.get("session") or None)
        attachments = [save_upload(session_id, filename, payload) for _, filename, payload in files]
        message = fields.get("message", "")

        try:
            core = load_core()
            if "state" not in STATE:
                STATE["state"] = core.load(APP_DIR)
            session["turn"] = int(session.get("turn", 0)) + 1
            result = core.handle(STATE["state"], message, attachments, session) or {}
        except Exception as exc:  # 学生代码出错时要看得见，而不是 500 空白
            return self._json(200, {
                "session": session_id,
                "reply": f"[harness 出错] {type(exc).__name__}: {exc}",
                "report": None,
                "safety": {"escalations": [], "refusals": []},
                "attachments": [{"name": a["name"], "kind": a["kind"]} for a in attachments],
            })

        session.setdefault("history", []).append({"turn": session["turn"], "user": message,
                                                  "attachments": [a["name"] for a in attachments]})
        save_session(session_id, session)

        return self._json(200, {
            "session": session_id,
            "reply": result.get("reply", ""),
            "report": result.get("report"),
            "citations": result.get("citations", []),
            "safety": result.get("safety", {"escalations": [], "refusals": []}),
            "attachments": [{"name": a["name"], "kind": a["kind"]} for a in attachments],
        })


def call_llm(messages: list[dict], max_tokens: int = 512) -> str:
    """调**平台代理**（容器里没有大模型 key）。没配 `APP_LLM_BASE_URL` 时直接报错。

    学生想接真模型时用它；题目给的 case 走 `plan_stub.json`（不需要模型）。
    """
    import urllib.error
    import urllib.request

    base = os.environ.get("APP_LLM_BASE_URL")
    if not base:
        raise RuntimeError("未配置 APP_LLM_BASE_URL：本环境不直连大模型，请用 plan_stub.json 或平台代理")
    payload = json.dumps({"messages": messages, "max_tokens": max_tokens}).encode()
    req = urllib.request.Request(base.rstrip("/") + "/chat", data=payload,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.URLError as exc:
        raise RuntimeError(f"平台 LLM 代理不可用：{exc}") from exc
    return data.get("reply") or data.get("content") or ""


def main() -> None:
    port = int(os.environ.get("APP_PORT") or 9200)
    host = os.environ.get("APP_HOST") or "127.0.0.1"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"[app_host] listening on http://{host}:{port}  (APP_DIR={APP_DIR})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
