---
name: sales-report
description: 从销售明细 CSV 汇总出统计报告 JSON（总额、分地区、冠军产品、行数）。当用户要求汇总、统计或生成销售报表时使用。
---

# 销售数据汇总 Skill

## 能力边界（TODO：学生补全）

> 说明：能力边界是评分维度之一（权重 25%）。请如实填写本 Skill **能做什么、不能做什么**，
> 并用标准测试数据集自测后，把实测结论也记录在这里。

- 能处理：UTF-8 编码、逗号分隔、表头为 `date,region,product,units,unit_price` 的销售明细
- TODO：本 Skill 不处理哪些情况？（例如：缺失列？非数值的 units？空文件？）

## 使用方法

```sh
python3 scripts/report.py <input.csv> <output.json>
```

## 汇总规则（TODO：学生实现并在自测中验证）

1. TODO：逐行 `revenue = units × unit_price` 怎么算？用 Decimal 还是 float？
2. TODO：`total_revenue` 与 `by_region` 的精度怎么定？（提示：四舍五入到 2 位小数）
3. TODO：`top_product` 并列时取谁？（提示：按名字的 Unicode 码点序取最小）
4. TODO：`row_count` 的口径是数据行还是含表头？

## 自测

用平台下发的标准测试数据集（`cases/`）运行本 Skill，
对每个 case 把 `output.json` 与 `expected.json` 逐字段比对，
把成功率与踩坑记录写到下面的实测档案。

## 实测档案（TODO：学生填写，dossier）

- 自测时间：
- 用例通过率：/3
- 踩坑记录（pitfalls）：
  1.
