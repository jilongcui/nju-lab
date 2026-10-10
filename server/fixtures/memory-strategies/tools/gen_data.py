#!/usr/bin/env python3
"""第 16 章（记忆系统 Memory）实验的造题工具：生成「多次随访对话 + 后续提问 + 记忆配置」。

**不下发给学生**（`tools/` 是造题工具）。

语料是**虚构的中文随访对话**（没有真实患者）。用中文是刻意的：这一章练的是"把对话沉淀成记忆条目、
再按提问取用"，中文分不了词（镜像里没有分词器），所以检索口径用**字符 2-gram 余弦** ——
与第 5 / 9 章实验里的字符 2-gram 口径一致。

用例的结构是按**教学对照**刻意设计的（这才是这份用例的价值）：

- **两处"边界口径方向相反"**（照批次 1 的做法）：
  1. 被**更正**的旧条目（`status=superseded`）**不会**被遗忘规则顺带删掉 —— 因为它已经不是 `active`，
     遗忘只处理 `active` 条目；
  2. 被**遗忘**的条目在**三种策略里都拿不回来**（窗口看不到、摘要没有、检索也检不到）——
     "遗忘的代价"就是这条：它不是"藏起来"，而是真的没了。
- **每种策略各有一个"死角"**：窗口记不住久远的（过敏史在很早的轮次里）、
  摘要会丢细节（同一 category 只留最新一条化验）、检索依赖提问与条目的字面相关性；
- **一次更新 + 一次遗忘都必须"看得见"**：更新让"当前用什么药"从答错变答对，
  遗忘让"以前的日常习惯"从检得到变检不到 —— `before_after` 就是这两件事的证据。

用法：

  python3 tools/gen_data.py            # 重新生成 problem/cases/case01|case02 的输入文件
  python3 tools/gen_data.py --print    # 只打印统计，不落盘
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

CASES: dict[str, dict] = {
    "case01": {
        "patient_id": "P-001",
        "dialogue": [
            ("T01", "2025-11-03", "assistant", "question", "最近血糖控制得怎么样？"),
            ("T02", "2025-11-03", "patient", "fact_statement", "我两年前查出对青霉素过敏，打针后起过疹子。"),
            ("T03", "2025-11-03", "patient", "chitchat", "今天路上堵了好久。"),
            ("T04", "2025-12-15", "patient", "fact_statement", "我每天晚饭后都去散步四十分钟。"),
            ("T05", "2025-12-15", "patient", "fact_statement", "我一直在吃二甲双胍，早晚各一片。"),
            ("T06", "2025-12-15", "patient", "fact_statement", "上个月化验的空腹血糖是 8.6。"),
            ("T07", "2026-01-20", "assistant", "question", "最近血压怎么样？"),
            ("T08", "2026-01-20", "patient", "fact_statement", "我每个月都复查一次肌酐，最近一次是 92。"),
            ("T09", "2026-02-10", "patient", "fact_statement", "我最近戒烟了，已经两个月没抽烟。"),
            ("T10", "2026-02-10", "patient", "chitchat", "天气冷，出门少了。"),
            ("T11", "2026-03-08", "patient", "correction", "更正：二甲双胍 → 达格列净"),
            ("T12", "2026-03-08", "patient", "chitchat", "谢谢医生。"),
        ],
        "queries": [
            ("Q01", "这个病人对什么药物过敏？", ["M01"]),
            ("Q02", "他现在还在用二甲双胍吗？", ["M07"]),
            ("Q03", "他最近的化验结果怎么样？", ["M04", "M05"]),
            ("Q04", "他平时散步和抽烟的情况怎么样？", ["M02", "M06"]),
            ("Q05", "他过敏的药和二甲双胍能一起用吗？", ["M01", "M07"]),
        ],
        "config": {
            "window_size": 4,
            "top_k": 3,
            "forget_importance_max": 1,
            "forget_before": "2026-03-01",
        },
    },
    "case02": {
        "patient_id": "P-207",
        "dialogue": [
            ("T01", "2025-09-12", "assistant", "question", "今天想聊点什么？"),
            ("T02", "2025-09-12", "patient", "fact_statement", "我对磺胺类药物过敏，上次用完全身发痒。"),
            ("T03", "2025-09-12", "patient", "chitchat", "我女儿上个月来看我。"),
            ("T04", "2025-10-05", "patient", "fact_statement", "我每天喝一点白酒，大概一两。"),
            ("T05", "2025-10-05", "patient", "fact_statement", "医生给我开了阿托伐他汀，我每天都吃。"),
            ("T06", "2025-10-05", "patient", "fact_statement", "上周检验的低密度脂蛋白是 3.8。"),
            ("T07", "2025-11-18", "patient", "fact_statement", "我每周去游泳两次，每次半小时。"),
            ("T08", "2025-11-18", "assistant", "question", "血脂复查了吗？"),
            ("T09", "2025-12-22", "patient", "fact_statement", "我每个月都化验一次血红蛋白，上次是 128。"),
            ("T10", "2026-01-30", "patient", "chitchat", "过年家里人多，有点累。"),
            ("T11", "2026-01-30", "patient", "fact_statement", "我每天早上出去运动二十分钟。"),
            ("T12", "2026-02-14", "patient", "fact_statement", "我已经把酒戒了，一滴也不喝。"),
            ("T13", "2026-02-14", "patient", "fact_statement", "我每天晚饭后散步半小时，人精神多了。"),
            ("T14", "2026-04-02", "patient", "correction", "更正：阿托伐他汀 → 瑞舒伐他汀"),
            ("T15", "2026-04-02", "patient", "chitchat", "谢谢，下个月再来。"),
            ("T16", "2026-04-02", "assistant", "question", "还有别的不舒服吗？"),
        ],
        "queries": [
            ("Q01", "他对哪一类药物过敏？", ["M01"]),
            ("Q02", "他现在还吃阿托伐他汀吗？", ["M10"]),
            ("Q03", "他最近的脂蛋白和血红蛋白各是多少？", ["M04", "M06"]),
            ("Q04", "他以前喝白酒的量是多少？", ["M02"]),
            ("Q05", "他平时游泳和散步的情况怎么样？", ["M05", "M09"]),
            ("Q06", "他过敏的药和瑞舒伐他汀能一起用吗？", ["M01", "M10"]),
        ],
        "config": {
            "window_size": 5,
            "top_k": 3,
            "forget_importance_max": 1,
            "forget_before": "2026-03-15",
        },
    },
}

# 条目编号要按 (date, turn_id) 升序 —— 这里先按原顺序数出"哪几轮会产生条目"，
# 学生侧的口径写在 task.md 里；工具侧只用来打印标定信息。
ENTRY_KINDS = {"fact_statement", "correction"}

CATEGORY_RULES = (
    ("allergy", ("过敏",)),
    ("medication_change", ("停用", "换用", "改为", "加用")),
    ("lab_result", ("血糖", "血压", "化验", "检验", "肌酐", "血红蛋白", "脂蛋白")),
    ("lifestyle", ("抽烟", "戒烟", "饮酒", "喝酒", "白酒", "戒了", "散步", "运动", "游泳", "饮食")),
)


def classify(row: dict) -> str:
    text = row["text"]
    for category, keywords in CATEGORY_RULES:
        if any(k in text for k in keywords):
            return category
    if row["kind"] == "correction":
        return "medication_change"
    return "other"


def importance_of(category: str) -> int:
    return {"allergy": 3, "medication_change": 3, "lab_result": 2}.get(category, 1)


def print_stats(name: str, case: dict) -> None:
    rows = [{"turn_id": t, "date": d, "role": r, "kind": k, "text": x} for t, d, r, k, x in case["dialogue"]]
    entries = [r for r in rows if r["kind"] in ENTRY_KINDS]
    print(f"\n=== {name}（{case['patient_id']}）===")
    print(f"轮次 {len(rows)} / 产生条目的轮 {len(entries)} / 提问 {len(case['queries'])}")
    for i, r in enumerate(entries, start=1):
        cat = classify(r)
        print(f"  M{i:02d} {r['turn_id']} {r['date']} {cat:18s} imp={importance_of(cat)}  {r['text'][:28]}")
    window = rows[-int(case["config"]["window_size"]):]
    print(f"  窗口（最后 {case['config']['window_size']} 轮）: {[r['turn_id'] for r in window]}")
    print(f"  遗忘线: importance <= {case['config']['forget_importance_max']} 且 date < {case['config']['forget_before']}")


def write_case(case_dir: Path, case: dict) -> None:
    case_dir.mkdir(parents=True, exist_ok=True)
    with (case_dir / "dialogue.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["turn_id", "date", "role", "kind", "text"])
        writer.writerows(case["dialogue"])
    with (case_dir / "queries.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["query_id", "query", "relevant_entry_ids"])
        for query_id, query, ids in case["queries"]:
            writer.writerow([query_id, query, ";".join(ids)])
    config = {"patient_id": case["patient_id"], **case["config"]}
    (case_dir / "memory_config.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", action="store_true", dest="only_print")
    args = ap.parse_args()

    for name, case in CASES.items():
        print_stats(name, case)
        if args.only_print:
            continue
        case_dir = CASES_DIR / name
        write_case(case_dir, case)
        print(f"  → {case_dir}")


if __name__ == "__main__":
    main()
