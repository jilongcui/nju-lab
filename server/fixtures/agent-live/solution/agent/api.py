"""**平台入口**：把第 19 章写的 agent 接到平台的对话请求上。**这个文件不用改。**

平台（`app_host.py`）会调：

    handle(state, message, attachments, session) -> {"reply", "report", "citations"}

它做的事很薄 —— 复用你自己写的 `loop.run_dialogue()`，一次只喂一条用户消息：

- **记忆跨轮**：条目表存在 `session` 里，平台负责保存会话，所以第 2 句还认得第 1 句说的事；
- **模型**：应用容器里没有 key，`agent/llm.py` 会自动改走平台模型代理（工作台里仍直连）；
- **附件**：这个 agent 只读台账与手册，**不解析附件**，所以附件只把文件名念一句，避免让人误解。

发布成应用需要把题目包的数据一起带上（Skill 根下要有
`assets.csv` / `kb/` / `limits.json` / `tools.json`）—— `task.md` 里有一条拷贝命令。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.data import Packet  # noqa: E402
from agent.llm import LlmClient  # noqa: E402
from agent.loop import Ctx, run_dialogue  # noqa: E402
from agent.memory import Memory  # noqa: E402

REQUIRED_FILES = ("assets.csv", "limits.json", "tools.json")


def _packet() -> Packet:
    missing = [name for name in REQUIRED_FILES if not (ROOT / name).exists()]
    if not (ROOT / "kb").is_dir():
        missing.append("kb/")
    if missing:
        raise RuntimeError(
            "应用缺少数据文件：" + "、".join(missing) +
            "（发布成应用前，把题目包里的 assets.csv / kb/ / limits.json / tools.json 拷到 Skill 根）"
        )
    return Packet(ROOT)


def _profile() -> dict:
    path = ROOT / "agent" / "profile.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def handle(state, message, attachments, session):
    """一条消息 → 你自己的 agent 跑一轮 → 答复。"""
    packet = _packet()

    # 记忆跟着会话走：平台存 session，我们只负责把条目表放进去 / 取出来
    memory = Memory()
    memory.entries = list(session.get("memory_entries") or [])

    client = LlmClient()
    client.current["dialogue"] = "app"
    turn = int(session.get("turn") or 0) + 1

    text = (message or "").strip()
    if attachments:
        names = "、".join(str(a.get("name") or "附件") for a in attachments)
        text = f"{text}\n（收到附件：{names}。我只读设备台账与维护手册，不解析附件内容。）"

    ctx = Ctx(client=client, packet=packet, memory=memory, profile=_profile())
    result = run_dialogue([{"turn": turn, "user": text}], ctx)

    session["turn"] = turn
    session["memory_entries"] = memory.entries

    last = (result.get("turns") or [{}])[-1]
    return {
        "reply": last.get("answer") or "（这一轮没有产出答复，请换个问法试试）",
        "report": None,
        "citations": [{"kind": "kb", "ref": ref} for ref in (last.get("citations") or [])],
    }
