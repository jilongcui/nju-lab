#!/usr/bin/env python3
"""销售数据汇总的**参考实现**（教师自用，用于生成/复核 cases/*/expected.json）。

⚠️ 这个文件**不随任何包分发**：template/ 与 dataset/ 里都不含它，
   而 dataset 包会下发给学生（claim 时下载解压），参考实现放进去等于泄题。

用法：
  python3 reference/report.py <input.csv> <output.json>      # 与题面同构的 CLI
  python3 reference/report.py --regen-cases                  # 重算全部 expected.json

口径与 dataset/task.md、dataset/judge.md 保持一致（改口径要三处一起改）。
"""
import csv
import json
import sys
from pathlib import Path


def summarize(rows):
    """rows: csv.DictReader 读出的行列表（units 整数、unit_price 两位小数）。"""
    per_product = {}
    per_region = {}
    total = 0.0
    for row in rows:
        revenue = float(row["units"]) * float(row["unit_price"])
        total += revenue
        per_region[row["region"]] = per_region.get(row["region"], 0.0) + revenue
        per_product[row["product"]] = per_product.get(row["product"], 0.0) + revenue
    # 并列时取名字 Unicode 码点序最小者：sorted() 的默认比较即码点序
    top = sorted(per_product.items(), key=lambda kv: (-round(kv[1], 2), kv[0]))[0][0]
    return {
        "total_revenue": round(total, 2),
        "by_region": {k: round(v, 2) for k, v in per_region.items()},
        "top_product": top,
        "row_count": len(rows),
    }


def regen_cases():
    cases_dir = Path(__file__).resolve().parent.parent / "dataset" / "cases"
    for case_dir in sorted(p for p in cases_dir.iterdir() if p.is_dir()):
        with (case_dir / "input.csv").open(newline="", encoding="utf-8") as f:
            report = summarize(list(csv.DictReader(f)))
        out = case_dir / "expected.json"
        with out.open("w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"[regen] {out} -> {json.dumps(report, ensure_ascii=False)}")


def main(argv):
    if len(argv) == 2 and argv[1] == "--regen-cases":
        regen_cases()
        return 0
    if len(argv) != 3:
        print("usage: report.py <input.csv> <output.json> | --regen-cases", file=sys.stderr)
        return 2
    with open(argv[1], newline="", encoding="utf-8") as f:
        report = summarize(list(csv.DictReader(f)))
    with open(argv[2], "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
