#!/usr/bin/env python3
"""CSV 清洗脚本骨架。

用法: python3 clean.py <input.csv> <output.csv>

TODO（学生）：按 SKILL.md 中的清洗规则实现。当前骨架只完成读写与表头透传。
"""
import csv
import sys


def clean_rows(rows: list[list[str]]) -> list[list[str]]:
    # TODO: 去重 / 日期规范化 / 空白处理 / 空值策略
    return rows


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    if not rows:
        print("empty input", file=sys.stderr)
        return 1
    header, body = rows[0], rows[1:]
    cleaned = clean_rows(body)
    with open(dst, "w", newline="", encoding="utf-8") as f:
        # lineterminator="\n"：csv 模块默认写 CRLF，而 expected.csv 是 LF ——
        # 保持 LF，才能直接 diff 自测（判分不计较行尾差异，但自测会误报）。
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(cleaned)
    print(f"cleaned {len(body)} -> {len(cleaned)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
