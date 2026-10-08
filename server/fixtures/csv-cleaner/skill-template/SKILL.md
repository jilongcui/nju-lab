---
name: csv-cleaner
description: 清洗 CSV 数据（去重、空值处理、日期与空白规范化），输出干净的 CSV。当用户要求清洗、规范化或修复 CSV 数据时使用。
---

# CSV 数据清洗 Skill

## 能力边界（TODO：学生补全）

> 说明：能力边界是评分维度之一（权重 25%）。请如实填写本 Skill **能做什么、不能做什么**，
> 并用标准测试数据集自测后，把实测结论也记录在这里。

- 能处理：UTF-8 编码、逗号分隔的 CSV 文件
- TODO：本 Skill 不处理哪些情况？（例如：嵌套引号的极端格式？超过 N 行的大文件？）

## 使用方法

```sh
python3 scripts/clean.py <input.csv> <output.csv>
```

## 清洗规则（TODO：学生实现并在自测中验证）

1. 去除完全重复的行（保留首次出现）
2. 日期列统一为 `YYYY-MM-DD` 格式
3. 去除字段首尾空白
4. TODO：空值行如何处理？删除还是填充？把决策写清楚

## 自测

用平台下发的标准测试数据集（`problem/cases/`）运行本 Skill，
对每个 case 比较输出与 `expected.csv`，把成功率与踩坑记录到下面的实测档案。

## 实测档案（TODO：学生填写，dossier）

- 自测时间：
- 用例通过率：/3
- 踩坑记录（pitfalls）：
  1.
