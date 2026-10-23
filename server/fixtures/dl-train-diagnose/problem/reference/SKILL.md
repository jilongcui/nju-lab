---
name: dl-train-diagnose
description: 来料自动分检（二分类 · 训练过程诊断）：读 data.csv、与"单特征固定阈值"的现有做法对比、训练一个多轮模型并记录逐轮训练历史，产出达标报告 output.json。当用户要求"自动分检来料/判断缺陷""训练并诊断训练过程（过拟合/早停）""给出比现有做法更可靠的方案"时使用。
---

# 自动分检 Skill（参考实现 · 学习示范）

> 📖 这份实现**随题目包一起下发**（`problem/reference/`），是给你的**示范** —— 不是标准答案。
> 判据只要求"**recall / precision 达标 + 逐轮训练历史齐全 + 说清训练过程**"，
> 所以换结构（更宽/更深）、换优化器、换早停策略、调判定阈值都能通过，你甚至可以做得更好。
>
> 它与你的起点 `skill-template/` 形态一致（同样的 `load_data` / `build_baseline` /
> `train_mlp` / `train_and_evaluate` / `main`），方便逐段对照。

## 能力边界

- 能处理：30 列数值特征 + 二分类标签（`defect`）的表格数据，列名与 `data.csv` 一致
- 能处理：与"单特征固定阈值"（现有做法）在**同一测试集**上的对比评估（recall / precision / accuracy）
- 能处理：逐轮训练历史的记录与训练曲线绘制（判断过拟合、取最优轮次、早停）
- 不处理：缺失值填充、类别特征编码、多分类
- 不处理：目标列名不同的数据（`defect` 写死在 `TARGET`）；也不处理与"参考上限 15（测量仪读数）"量纲差异过大的数据 —— 那是基线失效的边界，不是模型的问题

## 方法（六步 —— 与 `task.md` 的流程一致）

1. **看清需求** —— 筛查要"宁可多报，不能漏检"，所以主指标是 recall，precision 用来防止退化
2. **看一眼数据** —— 类别占比、量纲差异（`mean_radius` ~10 而 `mean_area` ~1000）、最区分的特征
3. **定基线** —— 现有做法：`mean_radius ≥ 15` 判缺陷，在同一测试集上算 recall / precision
4. **训练模型** —— `StandardScaler`（只用训练集拟合）→ 32-16 隐层 MLP + dropout → Adam →
   逐轮记录 `loss` / `val_loss` → 早停并**回退到最优轮次的权重**
5. **评估** —— 测试集 recall / precision / accuracy + 混淆矩阵（漏检 FN / 误报 FP）
6. **写结论** —— `compose_notes` 把"看过什么 → 怎么处理 → 与基线比如何 → 还有什么不足"写成一段话

产出结构（`output.json`）见 `task.md`；判据见 `judge.md`。

