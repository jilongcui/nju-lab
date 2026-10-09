---
name: noshow-predict
description: 门诊预约失约预测（二分类 · 类别不平衡）：读 data.csv、处理类别不平衡、与"一律认为会来"的现有做法对比，产出含 recall/precision 与选型理由的 output.json。当用户要求"预测失约 / no-show""找出高风险预约""类别不平衡的分类任务"时使用。
---

# 预约失约预测 Skill（参考实现 · 学习示范）

> 📖 这份实现**随题目包一起下发**（`problem/reference/`），是给你的**示范** —— 不是标准答案。
> 达标只要求"**recall ≥ 0.65 且 precision ≥ 0.40** + 说清选择"，换模型、换特征、调阈值都能通过。
>
> 它与你的起点 `skill-template/` 形态一致（同样的 `load_data` / `build_baseline` /
> `train_and_evaluate` / `main`），方便逐段对照。

## 能力边界

- 能处理：数值特征 + 0/1 二分类标签（`noshow`）的表格数据，列名与 `data.csv` 一致
- 能处理：**类别不平衡**（`class_weight="balanced"` + 分层切分 `stratify=y`）
- 能处理：与"不做预测"基线的对比（recall、precision、accuracy）
- 不处理：缺失值填充、类别型特征编码、多分类、按业务代价自定义阈值的场景（可自行扩展）

## 方法（四步）

1. **读数据** —— 看清有哪些列（数据字典见 `task.md`）
2. **先算现有做法的成绩** —— 不做预测、一律认为"会来"：**recall 必然是 0**，但 accuracy 有 7 成
3. **训练时处理不平衡** —— 这是本实验的核心；默认训练下模型会学成"全判会来"
4. **报告** —— 给出 recall / precision / accuracy，并说明怎么处理的不平衡

产出结构见 `task.md`，判据见 `judge.md`。

## 关键点：为什么必须看 recall

失约的人只占约 1/4。若用 accuracy 评价，"全判会来"能拿 0.72 —— 看起来不错，
但它**一个失约者都没抓到**（recall = 0），运营团队根本没法用。

| 方案 | accuracy | recall | precision |
|---|---|---|---|
| 一律认为会来（现有做法） | 0.72 | **0.00** | — |
| 全判失约（另一个极端） | 0.28 | 1.00 | **0.28** |
| 本实现：逻辑回归 + `class_weight="balanced"` | 0.70 | **0.73** | 0.47 |

> 所以判据同时卡 recall **和** precision：前者防"什么都不抓"，后者防"全判失约"。

## 实测档案

- 自测时间：
- 达标情况：case01 ✅ / case02 ✅（recall 0.73 / 0.76，precision 0.47 / 0.55）
- 踩坑记录（每条写成一行）：
  - 不加 `class_weight` 时 recall 只有 0.17 —— 模型学会了"全判会来"这条捷径
  - 切分要 `stratify=y`，否则测试集里的失约比例可能偏得离谱，指标忽高忽低
