"""跨轮记忆：条目表 + 三种状态（参考实现）。"""
from __future__ import annotations


class Memory:
    def __init__(self) -> None:
        self.entries: list[dict] = []

    def write(self, key: str, value: str, turn: int) -> None:
        for entry in self.entries:
            if entry["key"] == key and entry["state"] == "active":
                entry["state"] = "superseded"
                entry["updated_turn"] = turn
        self.entries.append({"key": key, "value": value, "state": "active", "updated_turn": turn})

    def correct(self, key: str, value: str, turn: int) -> None:
        self.write(key, value, turn)

    def active(self) -> dict[str, str]:
        return {e["key"]: e["value"] for e in self.entries if e["state"] == "active"}

    def has(self, key: str) -> bool:
        return key in self.active()

    def snapshot(self, applied: list[dict]) -> dict:
        return {"entries": list(self.entries), "applied": list(applied)}
