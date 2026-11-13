#!/usr/bin/env python3
"""平台自带的**应用宿主**（学生不用写、也改不到）。

它把「平台 harness + 学生 Skill」跑成一个能用的 Web 应用：

    /work/app/
    ├── app.json            ← 平台生成（标题、场景、主题）
    ├── app_host.py         ← 本文件（静态页 + 上传 + 会话）
    ├── platform_core.py    ← 平台 harness：解析附件 / 记忆 / 安全兜底 / 调模型
    ├── web/                ← 平台通用前端
    └── skill/              ← **学生提交的 Skill**（SKILL.md + scripts/）
        ├── SKILL.md
        └── scripts/api.py  ← 学生的 handle(state, message, attachments, session)
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
SKILL_DIR = APP_DIR / "skill"
SKILL_API = SKILL_DIR / "scripts" / "api.py"
APP_JSON = APP_DIR / "app.json"

sys.path.insert(0, str(APP_DIR))
import platform_core  # noqa: E402

STATE: dict = {}


# ---------------------------------------------------------------- 装载

def load_skill():
    """学生的 Skill 入口：`skill/scripts/api.py` 的 `handle()`。"""
    if not SKILL_API.exists():
        raise RuntimeError(f"这个应用没有 Skill 入口（缺 {SKILL_API}）")
    spec = importlib.util.spec_from_file_location("student_skill_api", SKILL_API)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    if not hasattr(module, "handle"):
        raise RuntimeError("Skill 里没有 handle()：入口约定是 handle(state, message, attachments, session)")
    return module


def build_state() -> dict:
    """平台交给 Skill 的上下文：报告口径、知识库、限额（有就用，没有就空）。"""
    state: dict = {"report": None, "kb": {}, "limits": {}}
    for name in ("report_format.json", "limits.json"):
        path = SKILL_DIR / name
        if path.exists():
            key = "report" if name.startswith("report") else "limits"
            state[key] = json.loads(path.read_text(encoding="utf-8"))
    kb_dir = SKILL_DIR / "kb"
    if kb_dir.is_dir():
        state["kb"] = {p.stem: p.read_text(encoding="utf-8") for p in sorted(kb_dir.glob("*.md"))}
    return state


def app_meta() -> dict:
    meta = {
        "title": "我的智能体应用",
        "subtitle": "",
        "theme": {"mode": "light", "accent": "#2f6feb"},
        "attachments": ["pdf", "docx", "image"],
        "skill": "",
    }
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
    return uuid.uuid4().hex[:12], {"turn": 0, "memory": [], "history": []}


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


def parse_multipart(content_type: str, body: bytes) -> tuple[dict[str, str], list[tuple[str, str, bytes]]]:
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
    server_version = "AgentAppHost/2.0"

    def log_message(self, fmt: str, *args) -> None:
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
        uploads = [save_upload(session_id, filename, payload) for _, filename, payload in files]
        message = fields.get("message", "")

        try:
            skill = load_skill()
            if "state" not in STATE:
                STATE["state"] = build_state()
            session["turn"] = int(session.get("turn", 0)) + 1
            result = platform_core.run_turn(skill, STATE["state"], message, uploads, session)
        except Exception as exc:  # 学生代码出错时要看得见，而不是 500 空白
            return self._json(200, {
                "session": session_id,
                "reply": f"[Skill 出错] {type(exc).__name__}: {exc}",
                "report": None,
                "citations": [],
                "safety": {"escalations": [], "refusals": []},
                "attachments": [{"name": a["name"], "kind": a["kind"]} for a in uploads],
            })

        session.setdefault("history", []).append({
            "turn": session["turn"], "user": message,
            "attachments": [a["name"] for a in uploads],
        })
        save_session(session_id, session)

        return self._json(200, {
            "session": session_id,
            "reply": result.get("reply", ""),
            "report": result.get("report"),
            "citations": result.get("citations", []),
            "safety": result.get("safety", {"escalations": [], "refusals": []}),
            "attachments": [{"name": a["name"], "kind": a["kind"]} for a in uploads],
        })


def main() -> None:
    port = int(os.environ.get("APP_PORT") or 9200)
    host = os.environ.get("APP_HOST") or "127.0.0.1"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"[platform-host] listening on http://{host}:{port}  (skill={SKILL_API})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
