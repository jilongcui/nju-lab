#!/usr/bin/env python3
"""第 16 章（记忆系统 Memory）参考实现：记忆四操作 + 三种上下文组织策略的对照。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：代码怎么组织随你；判据只看"口径一致 + 更新/遗忘真的生效 + 说得清取舍"。

它把本章的"四操作 + 三策略"落成了可量的一件东西：

- **写入（Store）**：按钉死的规则把随访对话沉淀成**记忆条目**
  `{entry_id, patient_id, fact, category, time, importance, status, superseded_by}`；
- **检索（Retrieve）**：两种取用方式各实现一遍 ——
  *窗口*（只留最近 N 轮原文）、*摘要*（按 category 聚合、只留最新一条）、
  *检索*（按提问算字符 2-gram 余弦，取 top-k 且**只保留相似度 > 0 的**）；
- **更新（Update）**：`kind=correction` 的轮（`更正：<旧说法> → <新说法>`）会把**更早且 fact 里含旧说法**
  的 `active` 条目标成 `superseded`，并**新增**一条；旧条目从此不再被检索命中；
- **遗忘（Forget）**：把 `active` 且 `importance <= 阈值` 且 `time < 截止日` 的条目标成 `forgotten` ——
  注意它**只处理 active**：已经被更正（superseded）的条目不会顺带被遗忘（本实验的一处边界口径）。

顺序**钉死**：① 抽条目 → ② 应用更新 → ③ 应用遗忘 → ④ 在最终 `active` 条目上做窗口 / 摘要 / 检索。
`before_after` 就是"更新与遗忘之前 vs 之后"的检索结果对照（它是"更新真的生效、遗忘真的丢信息"的证据）。

流程（与 task.md 的六步一致）：

  ① 看清需求   —— 追问助手要"记得住、找得到、错了能改、该忘要忘"
  ② 看懂口径   —— 条目格式、category 规则、重要性、更新/遗忘阈值、检索口径**都不许改**
  ③ 写入记忆   —— 抽条目（哪些轮产生条目、编号怎么排）
  ④ 更新与遗忘 —— 一次更正 + 一轮按重要性与时效的丢弃
  ⑤ 三种策略   —— 窗口 / 摘要 / 检索各算 recall@k，画一张对照图，并给出 before/after
  ⑥ 写结论     —— 三种策略各解决什么、遗忘的代价与合规意义、"错误记忆 = 错误病史"

用法：

  python3 scripts/memory_assistant.py <case目录> <output.json>   # 单个 case（图写到当前目录的 figures/）
  python3 scripts/memory_assistant.py --regen-expected           # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/memory_assistant.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"
FIG_DIR = Path("figures")
FIG_NAME = "strategy_recall.png"

ENTRY_KINDS = {"fact_statement", "correction"}

# category 判定：**按顺序**命中即停（口径写死在 task.md）
CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("allergy", ("过敏",)),
    ("medication_change", ("停用", "换用", "改为", "加用")),
    ("lab_result", ("血糖", "血压", "化验", "检验", "肌酐", "血红蛋白", "脂蛋白")),
    ("lifestyle", ("抽烟", "戒烟", "饮酒", "喝酒", "白酒", "戒了", "散步", "运动", "游泳", "饮食")),
)
CATEGORY_ORDER = ("allergy", "lab_result", "lifestyle", "medication_change", "other")  # ASCII 升序
IMPORTANCE = {"allergy": 3, "medication_change": 3, "lab_result": 2}
DEFAULT_IMPORTANCE = 1
CORRECTION_PREFIX = "更正："
CORRECTION_ARROW = "→"


# ---------- ② 口径：category 与重要性 ----------


def classify(row: dict) -> str:
    """口径：按 `CATEGORY_RULES` 的顺序命中即停；都没命中时，`correction` 轮算 `medication_change`。"""
    text = row["text"]
    for category, keywords in CATEGORY_RULES:
        if any(k in text for k in keywords):
            return category
    if row["kind"] == "correction":
        return "medication_change"
    return "other"


def importance_of(category: str) -> int:
    return IMPORTANCE.get(category, DEFAULT_IMPORTANCE)


# ---------- ③ 写入：抽取记忆条目 ----------


def build_entries(dialogue: list[dict], patient_id: str) -> list[dict]:
    """口径：只有 `fact_statement` / `correction` 的轮产生条目；按 `(date, turn_id)` 升序编号 `M01…`；
    `fact` = 该轮 `text` 原文（去首尾空白）；`status` 起初都是 `active`，`superseded_by` 起初为空串。"""
    rows = [r for r in dialogue if r["kind"] in ENTRY_KINDS]
    rows.sort(key=lambda r: (r["date"], r["turn_id"]))
    entries = []
    for i, row in enumerate(rows, start=1):
        category = classify(row)
        entries.append(
            {
                "entry_id": f"M{i:02d}",
                "patient_id": patient_id,
                "fact": row["text"].strip(),
                "category": category,
                "time": row["date"],
                "importance": importance_of(category),
                "status": "active",
                "superseded_by": "",
                "_turn_id": row["turn_id"],  # 内部用，写报告前删掉
            }
        )
    return entries


def strip_internal(entries: list[dict]) -> list[dict]:
    return [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]


# ---------- ④ 更新与遗忘 ----------


def apply_updates(dialogue: list[dict], entries: list[dict]) -> list[dict]:
    """口径：按 `(date, turn_id)` 升序处理 `correction` 轮，编号 `U01…`。

    `更正：<旧说法> → <新说法>` 的文本会被切成 `<旧说法>` / `<新说法>`；
    找到**更早**（`time < 本轮 date`）且 `status=active`、`fact` 里**包含 `<旧说法>`** 的条目，
    把它们标成 `superseded`（`superseded_by` = 本轮新条目），并记录这次更新。
    """
    by_turn = {e["_turn_id"]: e for e in entries}
    corrections = sorted(
        (r for r in dialogue if r["kind"] == "correction"), key=lambda r: (r["date"], r["turn_id"])
    )
    applied = []
    for i, row in enumerate(corrections, start=1):
        text = row["text"].strip()
        body = text[len(CORRECTION_PREFIX):] if text.startswith(CORRECTION_PREFIX) else text
        old, _, _new = body.partition(CORRECTION_ARROW)
        old = old.strip()
        new_entry = by_turn[row["turn_id"]]
        targets = sorted(
            e["entry_id"]
            for e in entries
            if e["status"] == "active" and e["time"] < row["date"] and old and old in e["fact"]
        )
        for entry_id in targets:
            entry = next(e for e in entries if e["entry_id"] == entry_id)
            entry["status"] = "superseded"
            entry["superseded_by"] = new_entry["entry_id"]
        applied.append(
            {"update_id": f"U{i:02d}", "old_entry_ids": targets, "new_entry_id": new_entry["entry_id"]}
        )
    return applied


def apply_forgetting(entries: list[dict], config: dict) -> list[str]:
    """口径：**只处理 `active`** 条目 —— `importance <= forget_importance_max` 且 `time < forget_before`
    的标成 `forgotten`。返回被遗忘的 entry_id（升序）。"""
    max_importance = int(config["forget_importance_max"])
    before = str(config["forget_before"])
    forgotten = []
    for entry in entries:
        if entry["status"] == "active" and entry["importance"] <= max_importance and entry["time"] < before:
            entry["status"] = "forgotten"
            forgotten.append(entry["entry_id"])
    return sorted(forgotten)


# ---------- ⑤ 三种上下文组织策略 ----------


def window_turns(dialogue: list[dict], window_size: int) -> list[str]:
    """窗口策略：按 `(date, turn_id)` 升序取**最后 `window_size` 轮**，按时间正序报 turn_id。"""
    rows = sorted(dialogue, key=lambda r: (r["date"], r["turn_id"]))
    return [r["turn_id"] for r in rows[-int(window_size):]]


def window_visible_entry_ids(turns: list[str], entries: list[dict]) -> list[str]:
    """窗口里能提供的条目 = 这些轮产生的条目里**最终仍 active** 的那些（遗忘后窗口也看不到它）。"""
    turn_set = set(turns)
    return sorted(
        e["entry_id"] for e in entries if e["_turn_id"] in turn_set and e["status"] == "active"
    )


def build_summary(entries: list[dict]) -> tuple[str, list[str]]:
    """摘要策略：对**最终 active** 条目按 category 聚合，每个 category 只留 `(time, entry_id)` 最大的那条，
    再按 category 的 ASCII 升序拼成 `"{category}: {fact}"`、用 `；` 连接、末尾不加标点。"""
    latest: dict[str, dict] = {}
    for entry in entries:
        if entry["status"] != "active":
            continue
        current = latest.get(entry["category"])
        if current is None or (entry["time"], entry["entry_id"]) > (current["time"], current["entry_id"]):
            latest[entry["category"]] = entry
    categories = sorted(latest)
    text = "；".join(f"{c}: {latest[c]['fact']}" for c in categories)
    return text, [latest[c]["entry_id"] for c in categories]


def bigrams(text: str) -> Counter:
    """口径：NFKC + 转小写 → **只保留字母与数字**（`str.isalnum()`，标点与空格全删）→ 相邻两字符一个 2-gram。"""
    compact = "".join(ch for ch in unicodedata.normalize("NFKC", text).lower() if ch.isalnum())
    return Counter(compact[i : i + 2] for i in range(len(compact) - 1))


def cosine(query_grams: Counter, entry_grams: Counter) -> float:
    if not query_grams or not entry_grams:
        return 0.0
    dot = sum(count * entry_grams.get(gram, 0) for gram, count in query_grams.items())
    if dot == 0.0:
        return 0.0
    norm_q = math.sqrt(sum(c * c for c in query_grams.values()))
    norm_e = math.sqrt(sum(c * c for c in entry_grams.values()))
    return dot / (norm_q * norm_e)


def retrieve(entries: list[dict], queries: list[dict], top_k: int, active_only: bool = True) -> list[dict]:
    """检索策略：对每个提问算字符 2-gram 余弦，取 top-`top_k`；**只保留相似度 > 0 的条目**；
    并列按 `entry_id` 升序。`active_only=False` 用于算"更新/遗忘之前"的对照。"""
    pool = [e for e in entries if (e["status"] == "active" or not active_only)]
    grams = {e["entry_id"]: bigrams(e["fact"]) for e in pool}
    out = []
    for query in queries:
        q_grams = bigrams(query["query"])
        scored = [
            (e["entry_id"], cosine(q_grams, grams[e["entry_id"]]))
            for e in pool
        ]
        hits = sorted(((-score, entry_id) for entry_id, score in scored if score > 0.0))
        out.append({"query_id": query["query_id"], "entry_ids": [entry_id for _, entry_id in hits[: int(top_k)]]})
    return out


def recall_at_k(hit_ids: list[str], relevant: list[str]) -> float:
    """`|命中 ∩ 相关| / |相关|`（相关来自 `queries.csv` 的 `relevant_entry_ids`）。"""
    if not relevant:
        return 0.0
    return len(set(hit_ids) & set(relevant)) / len(relevant)


def mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 6) if values else 0.0


# ---------- ⑤ 画图 ----------


def plot_strategies(metrics: dict, fig_root: Path) -> dict:
    fig_dir = fig_root / FIG_DIR
    fig_dir.mkdir(parents=True, exist_ok=True)
    names = ["window", "summary", "retrieval"]
    values = [metrics["recall_at_k_window"], metrics["recall_at_k_summary"], metrics["recall_at_k_retrieval"]]

    fig, ax = plt.subplots(figsize=(6.2, 4.2))
    bars = ax.bar(names, values, color=["#1565c0", "#ef6c00", "#2e7d32"], width=0.55)
    for bar, value in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, value + 0.02, f"{value:.3f}", ha="center", fontsize=9)
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("recall@k (mean over questions)")
    ax.set_title("Context strategy: how much of the needed memory is available")
    fig.tight_layout()
    fig.savefig(fig_dir / FIG_NAME, dpi=110)
    plt.close(fig)

    takeaway = (
        f"三种策略的 recall@k：窗口 {values[0]:.3f}、摘要 {values[1]:.3f}、检索 {values[2]:.3f}。"
        "窗口只留最近几轮，久远的事实（过敏史）一定丢；摘要把同一类压成一条，会丢细节；"
        "检索命中率最高，但它的前提是「提问与条目的用词能对上」，而且被遗忘的信息谁都拿不回来。"
    )
    return {"path": f"{FIG_DIR}/{FIG_NAME}", "takeaway": takeaway}


# ---------- ⑥ 结论 ----------


def compose_notes(metrics: dict, summary: str, updates: dict, entries: list[dict], n_queries: int) -> str:
    n_active = sum(1 for e in entries if e["status"] == "active")
    return (
        "口径与做法：只有 patient 的「陈述/更正」轮才沉淀成记忆条目（question 与闲聊不产生条目），"
        f"category 按钉死的关键词顺序判定（命中即停）、importance 由 category 决定；最终 {n_active} 条 active、"
        f"{len(updates['forgotten'])} 条被遗忘、{len(updates['applied'])} 次更新生效。"
        f"三种上下文策略的取舍一目了然（{n_queries} 个提问的平均 recall）：窗口 {metrics['recall_at_k_window']}"
        f"—— 它省 token，但只留最近几轮，久远的事实（过敏史）必然丢；摘要 {metrics['recall_at_k_summary']}"
        f"—— 它把同类事实压成一条（本用例的摘要是「{summary[:40]}…」），压缩率最高，但细节被抹平"
        "（同类里只留最新一条，旧的化验值就查不到了）；检索 "
        f"{metrics['recall_at_k_retrieval']} —— 它按提问去取相关条目、命中率最高，但前提是"
        "「提问与条目的用词能对上」，换一种问法就可能漏（这正是关键词检索的天花板，第 5 章量过）。"
        "更新与遗忘是**行为性**的：一次更正（旧药 → 新药）让「现在用什么药」从答错变答对，"
        "一次按重要性/时效的遗忘让「以前的日常习惯」从检得到变检不到 —— 这也是遗忘的代价："
        "它不是把信息藏起来，而是真的不再参与任何一次检索。合规上它对应「数据最小化 / 留存期限」，"
        "但医学场景里要小心：被遗忘的可能是随访真正需要的信息，所以阈值必须有人复核。"
        "最后一条风险最要记住：错误记忆 = 错误病史。记忆条目是「抄」下来的原文，一旦记错、或更正没有生效，"
        "后面每一次检索都会把错的当成事实用；所以更新要有「旧条目失效」这一步，而不是简单再写一条新的。"
        "下一步可以补三件事：① 写入前把重要事实（过敏史、当前用药）让患者确认一遍；"
        "② 这类关键条目走人工复核，而不是全自动落库；③ 每条记忆都记下**来源轮次**，"
        "这样答错时能回溯到是哪一句话写错了、也能定位该更正哪一条。"
    )


# ---------- 单 case ----------


def run_case(case_dir: Path, fig_root: Path | None = None) -> tuple[dict, dict]:
    with (case_dir / "dialogue.csv").open(encoding="utf-8", newline="") as fh:
        dialogue = [dict(r) for r in csv.DictReader(fh)]
    with (case_dir / "queries.csv").open(encoding="utf-8", newline="") as fh:
        queries = [dict(r) for r in csv.DictReader(fh)]
    for query in queries:
        query["relevant"] = [x for x in query["relevant_entry_ids"].split(";") if x]
    config = json.loads((case_dir / "memory_config.json").read_text(encoding="utf-8"))
    fig_root = fig_root or Path(".")

    entries = build_entries(dialogue, config["patient_id"])
    # 更新/遗忘**之前**的检索结果（对照）
    before = retrieve(entries, queries, config["top_k"])

    applied = apply_updates(dialogue, entries)
    forgotten = apply_forgetting(entries, config)

    turns = window_turns(dialogue, config["window_size"])
    window_ids = window_visible_entry_ids(turns, entries)
    summary_text, summary_ids = build_summary(entries)
    retrieved = retrieve(entries, queries, config["top_k"])

    metrics = {
        "recall_at_k_window": mean([recall_at_k(window_ids, q["relevant"]) for q in queries]),
        "recall_at_k_summary": mean([recall_at_k(summary_ids, q["relevant"]) for q in queries]),
        "recall_at_k_retrieval": mean(
            [recall_at_k(r["entry_ids"], q["relevant"]) for q, r in zip(queries, retrieved)]
        ),
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
                "query_id": query["query_id"],
                "before": before_by_query.get(query["query_id"], []),
                "after": after_by_query.get(query["query_id"], []),
            }
            for query in queries
        ],
    }
    out = {
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

    expected = {
        "note": (
            "参考水平（不是标准答案）：条目抽取、category、重要性、更新/遗忘阈值、三种策略与检索口径都已在 "
            "task.md 里钉死，所以条目编号、校验和、窗口、摘要、检索名单、三个 recall 与 before/after 都是确定的 —— "
            "用于核对学生的口径，以及「更新后旧条目不再命中、遗忘后谁都拿不到」这两条行为性条件。"
            "硬性判据见 manifest.json 的 assertions，语义判据见 judge.md。"
        ),
        "memory": {
            "n_entries": len(clean_entries),
            "entries_checksum": out["memory"]["entries_checksum"],
            "entries": [
                [e["entry_id"], e["category"], e["time"], e["importance"], e["status"], e["superseded_by"]]
                for e in clean_entries
            ],
            "window": turns,
            "window_entry_ids": window_ids,
            "summary": summary_text,
            "summary_entry_ids": summary_ids,
            "retrieved": retrieved,
        },
        "answers": [
            {"query_id": a["query_id"], "used_entry_ids": a["used_entry_ids"], "answer_min_len": 10}
            for a in answers
        ],
        "updates": updates,
        "metrics": metrics,
    }
    return out, expected


def entries_checksum(entries: list[dict]) -> str:
    """口径写死在 task.md：按 `entry_id` 升序，每行
    `entry_id|category|time|importance|status|superseded_by|fact`，行间 `\\n`、末尾不加换行，
    UTF-8 → sha256 十六进制**前 12 位**。"""
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


def run_case_to_file(case_dir: Path, out_path: Path) -> None:
    out, _ = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def regen_expected() -> None:
    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            _, expected = run_case(case_dir, Path(tmp))
        path = case_dir / "expected.json"
        path.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[regen] {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()

    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>，或用 --regen-expected")
    run_case_to_file(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
