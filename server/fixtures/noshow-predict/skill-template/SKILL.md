---
name: noshow-predict
description: 门诊预约失约预测（二分类 · 类别不平衡）：读 data.csv、处理类别不平衡、与"一律认为会来"的现有做法对比，产出含 recall/precision 与选型理由的 output.json。当用户要求"预测失约 / no-show""找出高风险预约""类别不平衡的分类任务"时使用。
---

# 预约失约预测 Skill（你的方案）

> **本实验是应用任务**：给你一个真实需求（提前找出会失约的预约，好打电话提醒）。
> **模型、特征、概率阈值都由你自己决定** —— 达标看的是"**是否真的抓住了失约者** +
> 能不能说清你的选择"。

## 实验材料（都在题目包 `problem/` 里，领取后工作区就有）

| 材料 | 作用 |
|---|---|
| `task.md` | 业务背景 + 四条要求 + 数据字典 + 交付格式 |
| `judge.md` | 判据：达标线（recall / precision）、防退化项、会被核对的项 |
| `reference/` | 一份**示范实现** —— 先读它（尤其"怎么处理不平衡"），再写你自己的 |
| `cases/case01`、`case02` | 两家医院 / 两个季度的数据，自测用 |

**建议节奏**：① 读 `task.md` 弄清需求 → ② 读 `reference/scripts/train.py` 看一遍做法
→ ③ **想清楚你的选择**（哪些特征？怎么处理不平衡？）→ ④ 在 `scripts/train.py` 里填两个 TODO
→ ⑤ 两个 case 都自测 → ⑥ 补全下面的能力边界与实测档案 → ⑦ 提交，看平台反馈。

## 能力边界（TODO：学生补全）

> 平台会扫描这一节；它也是给你自己梳理"这个方案能用在哪、不能用在哪儿"的机会。

- 能处理：数值特征 + 0/1 二分类标签（`noshow`）的表格数据
- 能处理：类别不平衡（会明确说明用了哪种处理方式）
- TODO：**不处理**哪些情况？（例如：缺失值？类别型特征？多分类？失约率极端低（1%）时？）

## 要做的决策（本实验的重点）

1. **指标**：为什么先看 `recall`？为什么"准确率 0.72"的现有做法其实毫无用处？
2. **不平衡的处理**：类别权重 / 概率阈值 / 重采样 —— 你选哪种？为什么？（可以都试一下再决定）
3. **特征**：哪几列真的有用？想想每列的业务含义（数据字典见 `task.md`）。
4. **权衡**：业务上更怕"漏掉失约者"还是更怕"名单太长"？你的 `precision` 底线是多少？

## 交付

按 `task.md` 的「交付格式」产出 `output.json`：
`model` / `n_train` / `n_test` / `metrics{recall,precision[,accuracy]}` /
`baseline{name,recall,accuracy}` / `notes`（可选 `threshold`）。

## 自测

两个 case 都要跑，看 recall 与 precision 是否达标（`recall ≥ 0.65` 且 `precision ≥ 0.40`）：

```sh
for c in cases/*/; do
  python3 scripts/train.py "$c" /tmp/out.json
done
```

> 卡住了怎么办：先看 `reference/scripts/train.py` 里对应的那一段，再回来改自己的实现。

## 实测档案（TODO：学生填写，dossier）

- 自测时间：
- 达标情况：case01 ？ / case02 ？（填 recall / precision，以及现有做法的 accuracy 作对照）
- 踩坑记录（pitfalls）：
  （每条写成一行 —— 平台按行计数，带续行的条目只算 1 条，会少拿过程分）
