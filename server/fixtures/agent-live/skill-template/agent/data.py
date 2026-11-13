"""读题目包里的材料。**这个文件不用改。**

工具要"真读文件"，所以把读文件的部分统一放在这里：学生的工具只负责
过滤/计算/排版，数据来源始终是题目包里的真实文件（不是写死的常量）。
"""
from __future__ import annotations

import csv
import json
from pathlib import Path


def load_assets(problem_dir: Path) -> list[dict]:
    with (problem_dir / "assets.csv").open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def load_kb(problem_dir: Path) -> dict[str, str]:
    """返回 {段落编号: 正文}，编号是文件名去掉 `.md`。"""
    return {p.stem: p.read_text(encoding="utf-8") for p in sorted((problem_dir / "kb").glob("*.md"))}


def load_limits(problem_dir: Path) -> dict:
    return json.loads((problem_dir / "limits.json").read_text(encoding="utf-8"))


def load_tools(problem_dir: Path) -> list[dict]:
    return json.loads((problem_dir / "tools.json").read_text(encoding="utf-8"))["tools"]


def load_tasks(problem_dir: Path, only: str | None = None) -> list[tuple[str, list[dict]]]:
    """返回 [(任务名, [{'turn': 1, 'user': '...'}, ...]), ...]，按文件名排序。"""
    out: list[tuple[str, list[dict]]] = []
    for path in sorted((problem_dir / "tasks").glob("*.jsonl")):
        if only and only not in path.stem:
            continue
        turns = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        out.append((path.stem, turns))
    return out


class Packet:
    """一份题目包（材料 + 名册 + 限额），工具与循环共用。"""

    def __init__(self, problem_dir: Path):
        self.dir = problem_dir
        self.assets = load_assets(problem_dir)
        self.kb = load_kb(problem_dir)
        self.limits = load_limits(problem_dir)
        self.tool_specs = load_tools(problem_dir)

    def kb_ids(self) -> list[str]:
        return sorted(self.kb)
