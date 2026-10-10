#!/usr/bin/env python3
"""第 18 章（技能 Skill）实验的造题工具：生成两份「检验报告单 + 参考区间表」用例。

**不下发给学生**（`tools/` 是造题工具）。

设计要点：

- 每份用例的值都是**显式写死**的（不用随机数），所以重跑逐字节相同 —— 判据里的
  `expected.json` 才能稳定；
- 脏行（前导/尾随空白、全角数字与小数点、空值、重复行、表外项目）都是**刻意安排**的，
  与 `problem/task.md` 的清洗口径一一对应；
- 每份用例都刻意放进：**恰好等于参考上限**的项（应判正常）、**恰好等于危急阈值**的项
  （应判危急）、**两条同一项目的行**（第二条要丢弃）、**不在参考区间表里的项目**
  （口径要求判 `unknown`，不许瞎猜）。

用法：

  python3 tools/gen_data.py            # 重新生成 problem/cases/case01|case02 的输入文件
  python3 tools/gen_data.py --print    # 只打印将要写出的内容，不落盘
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

# 参考区间表：item, unit, ref_low, ref_high, critical_low, critical_high
# 空字符串 = 这一侧不给（口径：不给就不判）；危急值与参考区间一样是**临床设定**，
# 所以「等于参考上限」算正常、「等于危急阈值」就要报警 —— 这两条口径都写死在 task.md。
RANGES = [
    ("ALT", "U/L", "7", "40", "", "500"),
    ("AST", "U/L", "13", "35", "", "500"),
    ("CRP", "mg/L", "0", "8", "", "100"),
    ("CREA", "umol/L", "44", "106", "", "530"),
    ("GLU", "mmol/L", "3.9", "6.1", "2.8", "22.2"),
    ("HBA1C", "%", "4.0", "6.0", "", ""),
    ("HGB", "g/L", "115", "150", "70", ""),
    ("K", "mmol/L", "3.5", "5.3", "2.8", "6.2"),
    ("LDL", "mmol/L", "", "3.4", "", ""),
    ("PLT", "10^9/L", "125", "350", "30", "1000"),
    ("TSH", "mIU/L", "0.35", "4.94", "", ""),
    ("WBC", "10^9/L", "3.5", "9.5", "1.5", "30"),
]

CASE02_EXTRA_RANGES = [
    ("AMY", "U/L", "28", "100", "", "300"),
    ("CA", "mmol/L", "2.11", "2.52", "1.6", "3.5"),
    ("TBIL", "umol/L", "5", "21", "", "340"),
]

# 报告单：item, 原始值（**故意带全角 / 空白 / 空值**）, unit
CASES = {
    "case01": {
        "note": "常规门诊生化 + 血常规：12 个可判定项目 + 1 个表外项目；含 3 个危急值、2 个恰好等于边界值",
        "patient": {
            "report_id": "LR-2026-0117",
            "name": "张某某",
            "sex": "女",
            "age": 58,
            "collected_at": "2026-03-11 07:20",
            "complaint": "多饮多尿 2 周，既往 2 型糖尿病史",
        },
        "ranges": RANGES,
        "rows": [
            ("ALT", "38", "U/L"),
            ("AST", "52", "U/L"),                      # high（> 35）
            ("CRP", " 6.2 ", "mg/L"),                  # 前后空白 → normal
            ("CREA", "118", "umol/L"),                 # high（> 106）
            ("GLU", "６．４", "mmol/L"),                # 全角 → 6.4 → high
            (" HBA1C ", "8.2", "%"),                   # item 带空白 → high
            ("HGB", "108", "g/L"),                     # low（< 115）
            ("K", "6.2", "mmol/L"),                    # high + 危急（等于 critical_high 6.2）
            ("LDL", "3.4", "mmol/L"),                  # 等于 ref_high → normal（边界）
            ("PLT", "28", "10^9/L"),                   # low + 危急（<= 30）
            ("TSH", "4.94", "mIU/L"),                  # 等于 ref_high → normal（边界）
            ("WBC", "1.2", "10^9/L"),                  # low + 危急（<= 1.5）
            ("BIL-T", "12.0", "umol/L"),               # 参考区间表里没有 → unknown
            ("ALT", "41", "U/L"),                      # 重复项：丢弃（保留首次的 38）
            ("TSH", "", "mIU/L"),                      # 空值：丢弃
        ],
    },
    "case02": {
        "note": "急诊 + 复查：15 个可判定项目 + 1 个表外项目；含 3 个危急值、4 个恰好等于边界值",
        "patient": {
            "report_id": "LR-2026-0203",
            "name": "李某某",
            "sex": "男",
            "age": 71,
            "collected_at": "2026-03-19 22:05",
            "complaint": "腹痛 6 小时，少尿，糖尿病肾病维持透析",
        },
        "ranges": RANGES + CASE02_EXTRA_RANGES,
        "rows": [
            ("ALT", "55", "U/L"),                      # high
            ("AMY", "128", "U/L"),                     # high（> 100）
            ("AST", "31", "U/L"),                      # normal
            ("CA", "1.55", "mmol/L"),                  # low + 危急（<= 1.6）
            ("CRP", "0.8", "mg/L"),                    # normal
            ("CREA", "560", "umol/L"),                 # high + 危急（>= 530）
            ("GLU", "26.0", "mmol/L"),                 # high + 危急（>= 22.2）
            ("HBA1C", "６.9", "%"),                     # 全角小数点 → 6.9 → high
            ("HGB", "143", "g/L"),                     # normal
            ("K", "3.5", "mmol/L"),                    # 等于 ref_low → normal（边界）
            ("LDL", "4.8", "mmol/L"),                  # high
            ("PLT", "380", "10^9/L"),                  # high
            ("TBIL", "19", "umol/L"),                  # normal
            ("TSH", "0.35", "mIU/L"),                  # 等于 ref_low → normal（边界）
            ("WBC", "9.5", "10^9/L"),                  # 等于 ref_high → normal（边界）
            ("CRP", " 1.1 ", "mg/L"),                  # 重复项：丢弃（保留首次的 0.8）
            ("K", "7.1", "mmol/L"),                    # 重复项：丢弃（**危急值也不能顶掉首次**）
            ("HDL", "", "mmol/L"),                     # 空值：丢弃
            ("FERR", " 210 ", "ng/mL"),                # 参考区间表里没有 → unknown
        ],
    },
}


def write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    lines = [",".join(header)]
    lines += [",".join(r) for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build(case_name: str, spec: dict) -> dict[str, str]:
    """返回 {相对路径: 文件内容}。"""
    files: dict[str, str] = {}
    files["lab_report.csv"] = (
        "item,value,unit\n" + "\n".join(f"{i},{v},{u}" for i, v, u in spec["rows"]) + "\n"
    )
    files["reference_ranges.csv"] = (
        "item,unit,ref_low,ref_high,critical_low,critical_high\n"
        + "\n".join(",".join(r) for r in spec["ranges"])
        + "\n"
    )
    files["patient.json"] = json.dumps(spec["patient"], ensure_ascii=False, indent=2) + "\n"
    return files


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", dest="dry", action="store_true", help="只打印，不写盘")
    args = ap.parse_args()

    for case_name in sorted(CASES):
        spec = CASES[case_name]
        files = build(case_name, spec)
        case_dir = CASES_DIR / case_name
        if not args.dry:
            case_dir.mkdir(parents=True, exist_ok=True)
        n_rows = len(spec["rows"])
        n_ranges = len(spec["ranges"])
        print(f"[{case_name}] {spec['note']}")
        print(f"  lab_report.csv       {n_rows} 行（含脏行）")
        print(f"  reference_ranges.csv {n_ranges} 个项目")
        print(f"  patient.json         {spec['patient']['name']} / {spec['patient']['sex']} / {spec['patient']['age']} 岁")
        for rel, text in files.items():
            if args.dry:
                print(f"--- {case_name}/{rel}\n{text}")
            else:
                (case_dir / rel).write_text(text, encoding="utf-8")

    if not args.dry:
        print(f"\n已写入 {CASES_DIR}")
        print("下一步：用参考实现重算期望值（必须在复验同一镜像内）——")
        print("  docker run --rm --user \"$(id -u):$(id -g)\" -v \"$PWD:/w\" --entrypoint python3 \\")
        print("    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/read_report.py --regen-expected")


if __name__ == "__main__":
    main()
