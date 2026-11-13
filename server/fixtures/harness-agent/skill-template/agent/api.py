"""**发布成应用时的入口**（写完后就能在平台上"一键发布"）。

平台会调这个 `handle()`：附件已解析好、知识库已给、会话由平台存。
你在这里复用 `scripts/harness.py` 的部件（校验 / mock 执行 / 检索 / 越界扫描），
**不要**重新写一套。

    handle(state, message, attachments, session) -> {"reply", "report", "citations", "safety"}

TODO（四步，参考 `solution/agent/api.py`）：
1. 把 `attachments[].rows` 转成 agent 内部的记录（每条 `{record_id, patient_id, item, value, unit}`）；
2. **路由 skill**：用 `scripts/harness.py` 的 `route_skill()` 决定"这一轮该用哪个 skill"，
   不命中就走 agent 自己的部件（检索 + 越界扫描）；
3. 命中 skill 时调用它的 `scripts/api.py` 的 `handle()`，把结果原样交回；
4. 没命中时，用 `bm25_rank()` 给出处、用 `scan_safety()` 给越界提示，拼一条答复。
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
import harness  # noqa: E402


def handle(state, message, attachments, session):
    raise NotImplementedError("TODO: 实现平台入口（参考 solution/agent/api.py）")
