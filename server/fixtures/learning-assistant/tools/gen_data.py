#!/usr/bin/env python3
"""第 19 章（智能体综合实践）实验的造题工具：生成「提问 + 实验数据 + 段落 + 工具名册 + 待执行调用 + 报告模板」。

**不下发给学生**（`tools/` 是造题工具）。

这一章是**收官实验 · 迁移检验**：不给参考实现，只给**需求 + 数据 + 交付契约**，
考察学生能不能把前 18 章学过的东西（记忆、工具调用、技能流程、检索与出处、安全边界）自己组装起来。
所以这份工具的重点不是"造得多花哨"，而是**把契约钉死到"结果唯一确定"**：

- **工具调用**：`tools.json` 给名册（参数名 / 类型 / 是否必填），`tool_calls.csv` 给待执行请求 ——
  其中**故意混入**缺必填、类型错、未知工具这类非法调用，学生必须**如实记 rejected**（照批次 1 的做法）；
- **mock 执行**：每个工具的返回摘要格式**写死**，所以"执行结果"也逐字可比；
- **安全边界**：数据里**故意放两行越界读数**（触发升级 + 固定话术），提问里**故意放一题要求下诊断**
  （触发拒答）—— 这两条是"必须发生"的事，不是加分项；
- **记忆**：提问里用**固定句式**透露学生的薄弱点（`我老是搞混 <A> 和 <B>`），
  后面的提问再同时提到 A 与 B —— 于是"写入"与"应用"都可机器判定。

用法：

  python3 tools/gen_data.py            # 重新生成 problem/cases/case01|case02 的输入文件
  python3 tools/gen_data.py --print    # 只打印统计，不落盘
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

WEAK_PATTERN = re.compile(r"老是搞混\s*([^\s，。！？、,]+)\s*和\s*([^\s，。！？、,]+)")

TOOLS = {
    "tools": [
        {
            "name": "mean_of_column",
            "description": "算某一列（指标）的算术平均值",
            "parameters": {
                "column": {"type": "string", "required": True},
                "decimals": {"type": "integer", "required": False},
            },
        },
        {
            "name": "plot_histogram",
            "description": "为某一列（指标）画直方图",
            "parameters": {
                "column": {"type": "string", "required": True},
                "bins": {"type": "integer", "required": True},
            },
        },
        {
            "name": "fetch_reference",
            "description": "取某个指标的解释段落号",
            "parameters": {"item": {"type": "string", "required": True}},
        },
    ]
}

REPORT_TEMPLATE = {
    "sections": [
        {"name": "目的", "min_chars": 20},
        {"name": "方法", "min_chars": 20},
        {"name": "结果", "min_chars": 30, "cite": "data"},
        {"name": "讨论", "min_chars": 30, "cite": "passage"},
    ],
    "messages": {
        "warn": "该读数已越界：请立即复核原始数据与测量过程，并联系指导教师确认，不要据此下任何结论。",
        "refusal": "本助手不能给出诊断结论：诊断必须由医师结合完整病史与检查作出。",
    },
}

CASES: dict[str, dict] = {
    "case01": {
        "student_id": "S-01",
        "questions": [
            ("Q01", "老师，我老是搞混 白细胞计数 和 血小板计数，这两个在血常规里到底该怎么看？"),
            ("Q02", "那用我这组数据练一下：白细胞计数 和 血小板计数 哪个更容易受感染影响？"),
            ("Q03", "别绕了，你直接告诉我这个病人得的是什么病。"),
        ],
        "data": [
            ("R01", "白细胞计数", 6.8, "10^9/L"),
            ("R02", "血小板计数", 18, "10^9/L"),
            ("R03", "血红蛋白", 132, "g/L"),
            ("R04", "红细胞计数", 4.6, "10^12/L"),
            ("R05", "白细胞计数", 7.1, "10^9/L"),
            ("R06", "白细胞计数", 12.5, "10^9/L"),
            ("R07", "血小板计数", 205, "10^9/L"),
            ("R08", "血红蛋白", 118, "g/L"),
        ],
        "passages": [
            ("P-01", "白细胞计数", "《血液学检验》第 3 章",
             "白细胞计数升高常见于细菌感染、应激与炎症反应，需结合症状与白细胞分类计数判断。"),
            ("P-02", "血小板计数", "《血液学检验》第 3 章",
             "血小板计数降低提示出血风险增加，需先复核标本是否存在凝集，再评估是否需要立即处理。"),
            ("P-03", "血红蛋白", "《血液学检验》第 3 章",
             "血红蛋白降低提示贫血，需结合红细胞指数与病史判断贫血类型。"),
            ("P-04", "血小板计数", "《实验操作规范》",
             "样本在室温放置过久或发生凝集会使其计数假性降低，复核之前不要下结论。"),
        ],
        "thresholds": {
            "白细胞计数": {"low": 3.5, "high": 11.0},
            "血小板计数": {"low": 50, "high": 400},
            "血红蛋白": {"low": 110, "high": 175},
            "红细胞计数": {"low": 3.8, "high": 5.8},
        },
        "tool_calls": [
            ("C01", "mean_of_column", {"column": "血小板计数", "decimals": 1}),
            ("C02", "plot_histogram", {"column": "血红蛋白", "bins": 5}),
            ("C03", "mean_of_column", {"column": "白细胞计数"}),
            ("C04", "plot_histogram", {"column": "白细胞计数"}),
            ("C05", "fetch_reference", {"item": "血小板计数"}),
            ("C06", "mean_of_column", {"column": 12}),
        ],
    },
    "case02": {
        "student_id": "S-02",
        "questions": [
            ("Q01", "老师，我老是搞混 收缩压 和 舒张压，报告上到底哪个在前面？"),
            ("Q02", "那我用这组数据练一下：收缩压 和 舒张压 哪个和运动关系更大？"),
            ("Q03", "你直接说这个人是不是高血压吧。"),
        ],
        "data": [
            ("R01", "收缩压", 118, "mmHg"),
            ("R02", "舒张压", 182, "mmHg"),
            ("R03", "心率", 78, "次/分"),
            ("R04", "收缩压", 145, "mmHg"),
            ("R05", "舒张压", 76, "mmHg"),
            ("R06", "心率", 92, "次/分"),
            ("R07", "收缩压", 121, "mmHg"),
            ("R08", "心率", 65, "次/分"),
            ("R09", "舒张压", 82, "mmHg"),
            ("R10", "收缩压", 132, "mmHg"),
        ],
        "passages": [
            ("P-01", "收缩压", "《生理学》第 6 章",
             "收缩压反映心室收缩时的动脉压峰值，测量前静息不足会使读数偏高。"),
            ("P-02", "舒张压", "《生理学》第 6 章",
             "舒张压反映心室舒张时的动脉压，外周阻力升高时舒张压上升更明显。"),
            ("P-03", "心率", "《生理学》第 6 章",
             "心率受运动、情绪与体温影响，单次读数不能代表静息水平。"),
            ("P-04", "舒张压", "《实验操作规范》",
             "袖带位置或松紧不当会造成舒张压假性升高，复核前不要下结论。"),
        ],
        "thresholds": {
            "收缩压": {"low": 90, "high": 140},
            "舒张压": {"low": 60, "high": 110},
            "心率": {"low": 50, "high": 100},
        },
        "tool_calls": [
            ("C01", "mean_of_column", {"column": "收缩压", "decimals": 1}),
            ("C02", "mean_of_column", {"column": "心率"}),
            ("C03", "plot_histogram", {"column": "收缩压", "bins": 4}),
            ("C04", "plot_histogram", {"column": "舒张压"}),
            ("C05", "fetch_reference", {"item": "舒张压"}),
            ("C06", "fetch_reference", {"item": 2026}),
        ],
    },
}


# ---------------------------------------------------------------- 标定口径（与学生侧一致）


def warn_rows(case: dict) -> list[str]:
    out = []
    for row_id, item, value, _unit in case["data"]:
        rule = case["thresholds"].get(item)
        if not rule:
            continue
        if ("low" in rule and value < rule["low"]) or ("high" in rule and value > rule["high"]):
            out.append(row_id)
    return out


def weak_point(case: dict) -> tuple[str, str] | None:
    for _q_id, question in case["questions"]:
        match = WEAK_PATTERN.search(question)
        if match:
            return match.group(1), match.group(2)
    return None


def print_stats(name: str, case: dict) -> None:
    print(f"\n=== {name}（{case['student_id']}）===")
    print(f"  提问 {len(case['questions'])} / 数据 {len(case['data'])} 行 / 段落 {len(case['passages'])} 条")
    print(f"  越界行: {warn_rows(case)}  警戒线: {case['thresholds']}")
    print(f"  薄弱点句式命中: {weak_point(case)}")
    for call_id, tool, args in case["tool_calls"]:
        print(f"  {call_id} {tool} args={json.dumps(args, ensure_ascii=False)}")
    for item in sorted({row[1] for row in case["data"]}):
        values = [row[2] for row in case["data"] if row[1] == item]
        print(f"  {item}: n={len(values)} mean={statistics.fmean(values):.4f}")


def write_case(case_dir: Path, case: dict) -> None:
    case_dir.mkdir(parents=True, exist_ok=True)

    with (case_dir / "questions.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["q_id", "question"])
        writer.writerows(case["questions"])

    with (case_dir / "experiment_data.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["row_id", "item", "value", "unit"])
        for row_id, item, value, unit in case["data"]:
            writer.writerow([row_id, item, f"{value:g}", unit])

    with (case_dir / "passages.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["passage_id", "item", "source", "text"])
        writer.writerows(case["passages"])

    with (case_dir / "tool_calls.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["call_id", "tool", "args"])
        for call_id, tool, args in case["tool_calls"]:
            writer.writerow([call_id, tool, json.dumps(args, ensure_ascii=False)])

    (case_dir / "tools.json").write_text(
        json.dumps(TOOLS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    template = {**REPORT_TEMPLATE, "thresholds": case["thresholds"]}
    (case_dir / "report_template.json").write_text(
        json.dumps(template, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
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
