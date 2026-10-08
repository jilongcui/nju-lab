#!/usr/bin/env python3
"""销售数据汇总：input.csv → output.json（**骨架，核心逻辑由学生补全**）。

平台复验会把这份 Skill 交给 agent 使用，所以：
  - 这里的函数签名与命令行约定保持稳定；
  - TODO 处要真正实现，不要在脚本里写死测试用例的答案。
"""
import csv
import json
import sys


def summarize(rows):
    """入参：csv.DictReader 读出的行列表。返回报告 dict。

    TODO：实现下面的口径（与 SKILL.md「汇总规则」保持一致）
      total_revenue  revenue = units × unit_price 的合计，四舍五入 2 位小数
      by_region      按 region 分组的 revenue 合计，各自四舍五入 2 位小数
      top_product    revenue 合计最大的 product；并列时取名字 Unicode 码点序最小者
      row_count      数据行数（不含表头）
    """
    raise NotImplementedError("TODO: 实现汇总逻辑（见 SKILL.md「汇总规则」）")


def main(argv):
    if len(argv) != 3:
        print("usage: report.py <input.csv> <output.json>", file=sys.stderr)
        return 2
    with open(argv[1], newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    report = summarize(rows)
    with open(argv[2], "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
