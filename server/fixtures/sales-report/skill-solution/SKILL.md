---
name: sales-report
description: 从销售明细 CSV 汇总出统计报告 JSON（总额、分地区、冠军产品、行数）。当用户要求汇总、统计或生成销售报表时使用。
---

# 销售数据汇总 Skill

> **本文件是本题的「满配参考实现」（标准答案）**，位于 `skill-solution/`，**不打包、不下发**。
> 学生拿到的是 `skill-template/` 里的同构骨架（关键处留 TODO）：形态契约相同，
> 差别只在完成度 —— 这就是"Skill 三态"（骨架 / 满配 / 学生版）。

## 能力边界

- **能处理**：UTF-8、逗号分隔、表头恰为 `date,region,product,units,unit_price` 的销售明细；
  `units` 为非负整数、`unit_price` 为两位小数。
- **不处理**：缺列或列名不同（`region`/`product` 取不到即报错，不做列名猜测）；
  `units`/`unit_price` 非数值（`float()` 直接抛错，不做容错）；
  空文件（无数据行）；货币符号、千分位、负数退款等业务变体；
  多文件合并（只读 `{{input}}` 指定的那一份）。
- **不负责**：跨期对比、图表渲染、写入数据库 —— 本题只产出这一个 JSON。

## 使用方法

```sh
python3 scripts/report.py <input.csv> <output.json>
```

## 汇总规则（已实现）

1. 逐行 `revenue = units × unit_price`，用 `float` 累加；
   **精度取舍**：数据是两位小数、用例规模在几十行量级，`float` 的舍入误差远小于判分容差
   （`|差| ≤ 0.01`），故不引入 `Decimal`（若换到大额/高精度场景应改 `Decimal`）。
2. `total_revenue`：全部 `revenue` 之和，四舍五入 **2 位小数**。
3. `by_region`：按 `region` 分组求和，每项各自四舍五入 2 位小数；键集合 = 输入里出现过的地区。
4. `top_product`：`revenue` 合计最大的 `product`；**并列时取名字 Unicode 码点序最小者**
   （等价于 Python 默认字符串排序的最小者）——实现用
   `sorted(items, key=lambda kv: (-round(kv[1], 2), kv[0]))[0]`，先按金额降序、再按名字升序。
5. `row_count`：**数据行数**（不含表头）。
6. 输出只含这四个键；数值用 JSON 数值类型。

## 自测

```sh
# 单个 case（逐字段比对期望值）
python3 scripts/report.py ../problem/cases/case01/input.csv /tmp/out.json
diff /tmp/out.json ../problem/cases/case01/expected.json

# 重算全部 expected.json（教师侧，口径改动后使用）
python3 scripts/report.py --regen-cases
```

## 实测档案（dossier）

- 自测时间：2026-10-08
- 用例通过率：3/3（case01 基础汇总 / case02 冠军产品并列 / case03 `units=0` 与小金额）
- 踩坑记录（pitfalls）：
  1. `top_product` 并列时若直接 `max(items, key=金额)`，结果取决于字典插入顺序而不是码点序 ——
     必须显式二级排序键，否则 case02 会偶发不通过。
  2. 把表头当数据行读（用 `csv.reader` 而非 `DictReader`）会让 `row_count` 多 1，
     这是最容易被漏掉的差一错误。
