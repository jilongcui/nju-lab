#!/usr/bin/env python3
"""第 16 章（记忆系统 Memory）的**起点骨架**：把你的实现写在标了 TODO 的地方。

结构已经搭好，与 `problem/reference/scripts/memory_assistant.py` 的函数划分**完全一致** ——
先跑通参考实现、读懂它的输出，再回来把自己的 TODO 填掉。

要填的六处：
  ① `classify` / `importance_of`  —— category 判定顺序与重要性取值
  ② `build_entries`                —— 哪些轮产生条目、编号怎么排、字段怎么填
  ③ `apply_updates`                —— 更正：旧条目失效并挂到新条目上
  ④ `apply_forgetting`             —— 只处理 active，按重要性 / 时效阈值丢弃
  ⑤ `window_turns` / `window_visible_entry_ids` / `build_summary` / `retrieve` —— 三种策略
  ⑥ `plot_strategies` / `compose_notes` —— 图与结论

已经给出的部分（最小示例）：读三份输入文件、字符 2-gram 余弦（检索要用的工具）、
`recall_at_k` 与 `mean`（指标要用的工具）、以及 `output.json` 的整体组装与命令行入口。

用法：
  python3 scripts/memory_assistant.py <case目录> <output.json>   # 单个 case（图写到当前目录的 figures/）
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import unicodedata
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "problem" / "cases"
FIG_DIR = Path("figures")
FIG_NAME = "strategy_recall.png"

ENTRY_KINDS = {"fact_statement", "correction"}
CORRECTION_PREFIX = "更正："
CORRECTION_ARROW = "→"

# TODO ①：把 task.md 里的 category 规则与重要性表抄过来（顺序不能改）
CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = ()
IMPORTANCE: dict[str, int] = {}
DEFAULT_IMPORTANCE = 1


# ---------------------------------------------------------------- 已给出：读数据与工具


def load_case(case_dir: Path) -> tuple[list[dict], list[dict], dict]:
    with (case_dir / "dialogue.csv").open(encoding="utf-8", newline="") as fh:
        dialogue = [dict(r) for r in csv.DictReader(fh)]
    with (case_dir / "queries.csv").open(encoding="utf-8", newline="") as fh:
        queries = [dict(r) for r in csv.DictReader(fh)]
    for query in queries:
        query["relevant"] = [x for x in query["relevant_entry_ids"].split(";") if x]
    config = json.loads((case_dir / "memory_config.json").read_text(encoding="utf-8"))
    return dialogue, queries, config


def bigrams(text: str) -> Counter:
    """已给出：NFKC + 转小写 → 只留字母数字 → 相邻两字符一个 2-gram。"""
    compact = "".join(ch for ch in unicodedata.normalize("NFKC", text).lower() if ch.isalnum())
    return Counter(compact[i : i + 2] for i in range(len(compact) - 1))


def cosine(query_grams: Counter, entry_grams: Counter) -> float:
    """已给出：两个 2-gram 计数向量的余弦；任一边为空或点积为 0 就返回 0。"""
    if not query_grams or not entry_grams:
        return 0.0
    dot = sum(count * entry_grams.get(gram, 0) for gram, count in query_grams.items())
    if dot == 0.0:
        return 0.0
    norm_q = math.sqrt(sum(c * c for c in query_grams.values()))
    norm_e = math.sqrt(sum(c * c for c in entry_grams.values()))
    return dot / (norm_q * norm_e)


def recall_at_k(hit_ids: list[str], relevant: list[str]) -> float:
    """已给出：`|命中 ∩ 相关| / |相关|`。"""
    if not relevant:
        return 0.0
    return len(set(hit_ids) & set(relevant)) / len(relevant)


def mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 6) if values else 0.0


def entries_checksum(entries: list[dict]) -> str:
    """已给出：按 `entry_id` 升序拼 `entry_id|category|time|importance|status|superseded_by|fact`，
    行间 `\\n`、末尾不加换行，取 sha256 前 12 位。"""
    lines = [
        "|".join(
            [
                e["entry_id"],
                e["category"],
                e["time"],
                str(e["importance"]),
                e["status"],
                e["superseded_by"],
                e["fact"],
            ]
        )
        for e in sorted(entries, key=lambda x: x["entry_id"])
    ]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------- ① TODO：category 与重要性


def classify(row: dict) -> str:
    """TODO：按 `CATEGORY_RULES` 顺序命中即停；都没命中时 `correction` 轮算 `medication_change`，
    其余算 `other`。"""
    raise NotImplementedError("TODO ①：category 判定")


def importance_of(category: str) -> int:
    """TODO：`allergy` / `medication_change` 3、`lab_result` 2、其余 1。"""
    raise NotImplementedError("TODO ①：重要性")


# ---------------------------------------------------------------- ② TODO：写入


def build_entries(dialogue: list[dict], patient_id: str) -> list[dict]:
    """TODO：只有 `fact_statement` / `correction` 的轮产生条目；按 `(date, turn_id)` 升序编号 `M01…`。

    每条给出 `entry_id` / `patient_id` / `fact`（原文去首尾空白）/ `category` / `time` /
    `importance` / `status`（起初 `active`）/ `superseded_by`（起初 `""`）。
    另外把 `turn_id` 存进一个**内部字段**（例如 `_turn_id`），后面更新要用；写报告前删掉。
    """
    raise NotImplementedError("TODO ②：抽取条目")


def strip_internal(entries: list[dict]) -> list[dict]:
    """已给出：把 `_` 开头的内部字段去掉（写报告用）。"""
    return [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]


# ---------------------------------------------------------------- ③④ TODO：更新与遗忘


def apply_updates(dialogue: list[dict], entries: list[dict]) -> list[dict]:
    """TODO：按 `(date, turn_id)` 升序处理 `correction` 轮，编号 `U01…`。

    `更正：<旧说法> → <新说法>`：找**更早**（`time < 本轮 date`）、`status == "active"`、
    `fact` 含 `<旧说法>` 的条目，标成 `superseded`（`superseded_by` = 本轮新条目），
    返回 `[{"update_id", "old_entry_ids", "new_entry_id"}]`（`old_entry_ids` 升序）。
    """
    raise NotImplementedError("TODO ③：应用更新")


def apply_forgetting(entries: list[dict], config: dict) -> list[str]:
    """TODO：**只处理 `active`** —— `importance <= forget_importance_max` 且 `time < forget_before`
    的标成 `forgotten`，返回被遗忘的 `entry_id`（升序）。

    注意：已经被更正成 `superseded` 的条目不会被顺带遗忘（这是本实验的一处边界口径）。
    """
    raise NotImplementedError("TODO ④：应用遗忘")


# ---------------------------------------------------------------- ⑤ TODO：三种策略


def window_turns(dialogue: list[dict], window_size: int) -> list[str]:
    """TODO：按 `(date, turn_id)` 升序取最后 `window_size` 轮的 `turn_id`（时间正序）。"""
    raise NotImplementedError("TODO ⑤：窗口轮次")


def window_visible_entry_ids(turns: list[str], entries: list[dict]) -> list[str]:
    """TODO：窗口里能提供的条目 = 这些轮产生的条目里**最终仍 active** 的那些（升序）。"""
    raise NotImplementedError("TODO ⑤：窗口可见条目")


def build_summary(entries: list[dict]) -> tuple[str, list[str]]:
    """TODO：对最终 `active` 条目按 category 聚合，每类只留 `(time, entry_id)` 最大的那条；
    按 category 的 ASCII 升序拼成 `"{category}: {fact}"`、用 `；` 连接、末尾不加标点。
    返回 `(文本, 保留的 entry_id 升序数组)`。
    """
    raise NotImplementedError("TODO ⑤：摘要")


def retrieve(entries: list[dict], queries: list[dict], top_k: int, active_only: bool = True) -> list[dict]:
    """TODO：每个提问算字符 2-gram 余弦，取 top-`top_k`；**只保留相似度 > 0 的**；并列按 `entry_id` 升序。
    返回 `[{"query_id", "entry_ids"}]`。`active_only=False` 用于算"更新/遗忘之前"的对照。
    """
    raise NotImplementedError("TODO ⑤：检索")


# ---------------------------------------------------------------- ⑥ TODO：图与结论


def plot_strategies(metrics: dict, fig_root: Path) -> dict:
    """TODO：画三种策略的 `recall@k` 柱状图（存 `figures/strategy_recall.png`），
    返回 `{"path", "takeaway"}`。标题与轴标签用**英文**；`takeaway` 的数字要与 `metrics` 自洽。"""
    raise NotImplementedError("TODO ⑥：策略对照图")


def compose_notes(metrics: dict, summary: str, updates: dict, entries: list[dict], n_queries: int) -> str:
    """TODO：写 ≥60 字的结论。要点（见 task.md 与 judge.md）：

      - 窗口 / 摘要 / 检索**各解决什么问题**、各自的死角在哪
      - 更新为什么要让旧条目失效；遗忘的**代价**与合规意义
      - "错误记忆 = 错误病史"这条风险，以及下一步该怎么补
    """
    raise NotImplementedError("TODO ⑥：结论")


# ---------------------------------------------------------------- 已给出：组装与入口


def run_case(case_dir: Path, fig_root: Path | None = None) -> dict:
    dialogue, queries, config = load_case(case_dir)
    fig_root = fig_root or Path(".")

    entries = build_entries(dialogue, config["patient_id"])
    before = retrieve(entries, queries, config["top_k"])  # 更新/遗忘之前的对照
    applied = apply_updates(dialogue, entries)
    forgotten = apply_forgetting(entries, config)

    turns = window_turns(dialogue, config["window_size"])
    window_ids = window_visible_entry_ids(turns, entries)
    summary_text, summary_ids = build_summary(entries)
    retrieved = retrieve(entries, queries, config["top_k"])

    metrics = {
        "recall_at_k_window": mean([recall_at_k(window_ids, q["relevant"]) for q in queries]),
        "recall_at_k_summary": mean([recall_at_k(summary_ids, q["relevant"]) for q in queries]),
        "recall_at_k_retrieval": mean([recall_at_k(r["entry_ids"], q["relevant"]) for q, r in zip(queries, retrieved)]),
    }

    after_by_query = {r["query_id"]: r["entry_ids"] for r in retrieved}
    before_by_query = {r["query_id"]: r["entry_ids"] for r in before}
    facts = {e["entry_id"]: e["fact"] for e in entries}
    answers = []
    for query in queries:
        ids = after_by_query.get(query["query_id"], [])
        if ids:
            body = "；".join(facts[i].rstrip("。；") for i in ids)
            answer = f"根据随访记录：{body}。以上为记录内容，请以医生判断为准。"
        else:
            answer = "随访记录里没有与这个问题直接相关的内容，无法据此回答。"
        answers.append({"query_id": query["query_id"], "answer": answer, "used_entry_ids": sorted(ids)})

    clean_entries = strip_internal(entries)
    updates = {
        "applied": applied,
        "forgotten": forgotten,
        "before_after": [
            {
                "query_id": q["query_id"],
                "before": before_by_query.get(q["query_id"], []),
                "after": after_by_query.get(q["query_id"], []),
            }
            for q in queries
        ],
    }
    return {
        "memory": {
            "n_entries": len(clean_entries),
            "entries_checksum": entries_checksum(clean_entries),
            "entries": clean_entries,
            "window": turns,
            "window_entry_ids": window_ids,
            "summary": summary_text,
            "summary_entry_ids": summary_ids,
            "retrieved": retrieved,
        },
        "answers": answers,
        "updates": updates,
        "metrics": metrics,
        "figures": [plot_strategies(metrics, fig_root)],
        "notes": compose_notes(metrics, summary_text, updates, clean_entries, len(queries)),
    }


def run_case_to_file(case_dir: Path, out_path: Path) -> None:
    out = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    args = ap.parse_args()
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>")
    run_case_to_file(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
