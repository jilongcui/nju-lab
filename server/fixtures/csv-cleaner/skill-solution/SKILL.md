---
name: csv-cleaner
description: 清洗 CSV 数据（去重、空值处理、日期与空白规范化），输出干净的 CSV。当用户要求清洗、规范化或修复 CSV 数据时使用。
---

# CSV 数据清洗 Skill

> **本文件是本题的「满配参考实现」（标准答案）**，位于 `skill-solution/`，**不打包、不下发**。
> 学生拿到的是 `skill-template/` 里的同构骨架（关键处留 TODO）。两者形态一致，
> 差别只在完成度 —— 这正是"Skill 三态"（骨架 / 满配 / 学生版）的具体呈现。

## 能力边界

- **能处理**：UTF-8 编码、逗号分隔的 CSV；字段值含首尾空白；日期列的三种写法
  （`YYYY-MM-DD`、`YYYY/M/D`、`YYYY.MM.DD`）与 `DD-MM-YYYY`。
- **能处理**：规范化后完全重复的行（保留首次出现）、含空字段的行（整行删除）。
- **不处理**：GBK/GB18030 等非 UTF-8 编码（会先按 UTF-8 解码失败）；
  带嵌套引号、内嵌换行的极端 CSV；非逗号分隔（如制表符、分号）；
  列名不是 `name,date,amount` 的表（日期列按列名 `date` 定位，找不到就跳过日期规范化）；
  `DD-MM-YYYY` 与 `MM-DD-YYYY` 的歧义（本题口径按前者，即"日-月-年"）。

## 使用方法

```sh
python3 scripts/clean.py <input.csv> <output.csv>
```

## 清洗规则（已实现）

1. 所有字段去除首尾空白。
2. 日期列统一为 `YYYY-MM-DD`：
   - `YYYY[-./]M[-./]D` → 补零成 `YYYY-MM-DD`；
   - `DD-MM-YYYY` → `YYYY-MM-DD`（**日在前**，见能力边界里的歧义说明）。
3. 规范化后完全重复的行只保留首次出现（行顺序 = 首次出现顺序）。
4. 含空字段的行整行删除（列数不足按缺失列处理，同样删除）。
5. 表头原样保留；输出用 LF 行尾（`csv.writer(..., lineterminator="\n")`）。

## 自测

```sh
# 单个 case（与 expected.csv 逐字节比对）
python3 scripts/clean.py ../problem/cases/case01/input.csv /tmp/out.csv
diff /tmp/out.csv ../problem/cases/case01/expected.csv

# 重算全部 expected.csv（教师侧，口径改动后使用）
python3 scripts/clean.py --regen-cases
```

## 实测档案（dossier）

- 自测时间：2026-10-08
- 用例通过率：3/3（case01/02/03 输出与 `expected.csv` **逐字节一致**）
- 踩坑记录（pitfalls）：
  1. `csv.writer` 默认写 CRLF，而 `expected.csv` 是 LF —— 逐字节自测会"看起来一样却 diff 不通过"，
     必须显式 `lineterminator="\n"`。
  2. `02-03-2026` 这类值不能按"先试 ISO 再试 DMY"的顺序随便套正则：必须先锚定形态
     （4 位年开头 vs 2 位日开头），否则 `DD-MM-YYYY` 会被误判。
