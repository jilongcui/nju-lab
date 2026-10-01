---
name: ml-basics
description: 按 params.json 指定的口径（回归/分类、模型与超参、切分随机种子）训练并评估 sklearn 模型，输出统一结构的指标 JSON。当用户要求"训练/评估模型""复现某个建模结果""跑一遍基线模型"时使用。
---

# 机器学习基础建模 Skill

## 能力边界（TODO：学生补全）

> 说明：能力边界是评分维度之一。请如实填写本 Skill **能做什么、不能做什么**，
> 并用标准测试数据集自测后，把实测结论也记录在这里。

- 能处理：数值型特征 + 单标签的 CSV（表头 + 数据行，最后一列是 `target`）
- 能处理：`LinearRegression` / `LogisticRegression` 两类模型与它们的构造参数
- TODO：本 Skill 不处理哪些情况？（例如：类别型特征编码？多分类？缺失值？非数值列？）

## 使用方法

```sh
python3 scripts/train.py <case_dir> <output.json>
```

`<case_dir>` 里要有 `input.csv` 与 `params.json`。
平台复验时工作目录里就是这两份文件，此时 `<case_dir>` 传 `.` 即可。

## 建模口径（TODO：学生实现并在自测中验证）

> 口径写错不会崩，但指标对不上 —— `n_train`/`n_test` 往往最先暴露问题。

1. TODO：特征与标签怎么取？（提示：最后一列是标签，其余列是特征）
2. TODO：分类任务怎么切分才与期望一致？（提示：`stratify` 要按 `params.json` 决定传不传）
3. TODO：`model_params` 怎么用？（提示：直接透传给模型构造函数）
4. TODO：指标算完怎么处理？（提示：4 位小数；混淆矩阵保持整数）

## 自测

用平台下发的标准测试数据集（`cases/`）运行本 Skill，
对每个 case 把 `output.json` 与 `expected.json` 逐字段比对（数值差 ≤ 0.001），
把成功率与踩坑记录写到下面的实测档案。

## 实测档案（TODO：学生填写，dossier）

- 自测时间：
- 用例通过率：/3
- 踩坑记录（pitfalls）：
  1.
