#!/usr/bin/env python3
"""CSV 数据清洗：input.csv → output.csv（**满配参考实现**，即本题的标准答案）。

用法：
  python3 scripts/clean.py <input.csv> <output.csv>     # 与 task/题面同构的 CLI
  python3 scripts/clean.py --regen-cases                # 重算 problem/cases/*/expected.csv

清洗口径见 problem/README.md（5 条规则）。三份事实源要一起改：
problem/README.md、problem/cases/*/expected.csv、本文件。

⚠️ 本目录（skill-solution/）**不打包、不下发**：problem 包会下发给学生，放进去等于泄题。
   学生拿到的是 skill-template/ 里的 TODO 骨架。
"""
import csv
import re
import sys
from pathlib import Path

# 日期可能出现的三种写法：YYYY-MM-DD / YYYY/M/D / YYYY.MM.DD，以及 DD-MM-YYYY
ISO_DATE = re.compile(r"^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$")
DMY_DATE = re.compile(r"^(\d{1,2})-(\d{1,2})-(\d{4})$")


def normalize_date(value: str) -> str:
    """把三种日期写法统一成 YYYY-MM-DD；无法识别的原样返回（口径只覆盖这三种）。"""
    m = ISO_DATE.match(value)
    if m:
        year, month, day = m.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"
    m = DMY_DATE.match(value)
    if m:
        day, month, year = m.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"
    return value


def clean_rows(header: list[str], body: list[list[str]]) -> list[list[str]]:
    """按 problem/README.md 的 5 条规则清洗数据行（表头由调用方透传）。"""
    date_col = header.index("date") if "date" in header else None
    seen: set[tuple[str, ...]] = set()
    out: list[list[str]] = []
    for row in body:
        # 1) 所有字段去除首尾空白；列数不足的按缺失处理（等同空字段）
        cells = [c.strip() for c in row]
        if len(cells) < len(header):
            cells += [""] * (len(header) - len(cells))
        # 4) 含空字段的行直接删除
        if any(c == "" for c in cells):
            continue
        # 2) 日期列统一为 YYYY-MM-DD
        if date_col is not None:
            cells[date_col] = normalize_date(cells[date_col])
        # 3) 规范化后完全重复的行只保留首次出现（行顺序即首次出现顺序）
        key = tuple(cells)
        if key in seen:
            continue
        seen.add(key)
        out.append(cells)
    return out


def clean_file(src: str, dst: str) -> int:
    with open(src, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    if not rows:
        print("empty input", file=sys.stderr)
        return 1
    # 5) 表头原样保留
    header, body = rows[0], rows[1:]
    cleaned = clean_rows(header, body)
    with open(dst, "w", newline="", encoding="utf-8") as f:
        # lineterminator="\n"：csv 模块默认写 CRLF，而 expected.csv 是 LF ——
        # 统一成 LF，学生才能用 diff 逐字节自测（判分本身不计较行尾差异）。
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(cleaned)
    print(f"cleaned {len(body)} -> {len(cleaned)} rows")
    return 0


def regen_cases() -> None:
    cases_dir = Path(__file__).resolve().parent.parent.parent / "problem" / "cases"
    for case_dir in sorted(p for p in cases_dir.iterdir() if p.is_dir()):
        expected = case_dir / "expected.csv"
        rc = clean_file(str(case_dir / "input.csv"), str(expected))
        if rc != 0:
            raise SystemExit(f"[regen] {case_dir} 清洗失败")
        print(f"[regen] {expected}")


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[1] == "--regen-cases":
        regen_cases()
        return 0
    if len(argv) != 3:
        print("usage: clean.py <input.csv> <output.csv> | --regen-cases", file=sys.stderr)
        return 2
    return clean_file(argv[1], argv[2])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
