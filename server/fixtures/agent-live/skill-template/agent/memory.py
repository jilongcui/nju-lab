"""跨轮记忆：条目表 + 三种状态。**存储层已给好，`write` / `correct` 要你写。**

一条记忆 = 一个事实（key → value），状态只有三种：

- `active`：现在成立的；
- `superseded`：被更正过（旧值，保留可追溯，但**不能再参与回答**）；
- `forgotten`：用户要求忘掉的。

为什么不用"每轮把全部历史塞给模型"：上下文会一直涨，而且更正过的东西
如果不改状态，模型还会按旧值回答 —— 记忆的价值就在"状态"这两个字上。
"""
from __future__ import annotations


class Memory:
    """条目表。每条是 `{"key", "value", "state", "updated_turn"}`。"""

    def __init__(self) -> None:
        self.entries: list[dict] = []

    # ------------------------------------------------------------------ 写入
    def write(self, key: str, value: str, turn: int) -> None:
        """写入一条事实。

        要求：
        - 同 `key` 已有 `active` 条目时，**把旧值替换掉**（旧条目置 `superseded`，而不是删掉）；
        - 新条目的 `state` 是 `active`，`updated_turn` 记当前轮。
        """
        raise NotImplementedError("TODO: 实现 Memory.write")

    def correct(self, key: str, value: str, turn: int) -> None:
        """更正：用户说"其实不是 X，是 Y"时调用。

        要求：把该 key 下所有 `active` 条目置 `superseded`，再写入新值。
        """
        raise NotImplementedError("TODO: 实现 Memory.correct")

    # ------------------------------------------------------------------ 读
    def active(self) -> dict[str, str]:
        """当前成立的事实（已给好）。"""
        return {e["key"]: e["value"] for e in self.entries if e["state"] == "active"}

    def has(self, key: str) -> bool:
        return key in self.active()

    def snapshot(self, applied: list[dict]) -> dict:
        """交给 output.json 的形态（已给好）。"""
        return {"entries": list(self.entries), "applied": list(applied)}
