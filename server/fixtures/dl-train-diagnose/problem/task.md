# 深度学习实验一：来料自动分检（二分类 · 训练过程诊断）

## 业务背景

你是某产线质检组的算法同学。来料检验岗用测量仪逐件读出 30 个**形态量**（尺寸、形状、表面特征等），
需要把**有缺陷**的来料自动挑出来，交人工复检。

**现有做法**：只看最基础的一个测量 —— 平均半径，**达到出厂参考上限 15（测量仪读数）就报缺陷**。
它不需要模型，也不需要训练 —— 所以你的任务不是"跑个神经网络"，而是
**比这个现有做法明显更可靠地解决问题**，并且**说清你的训练过程是怎么控制的**。

## 你的任务

用工作目录里的 `data.csv` 训练一个**多轮训练的模型（神经网络）**，产出 `output.json` 与你的图，
达到三条要求：

1. **把该查出来的都查出来**：在测试集上，缺陷件的**召回率（recall）**要达到达标线，
   同时**精确率（precision）**不能塌 —— 见下表的达标线。
2. **训练过程可诊断**：把**逐轮训练历史**（每轮的训练损失与验证损失）写进报告，
   并用**训练曲线**说明：什么时候开始过拟合、你是怎么处理的（早停 / dropout / 正则化 / 调学习率…）。
3. **用图把分析讲清楚**：看数据时画图、训练过程画图、评估结果画图，**每张图写一句结论**
   （写进 `output.json` 的 `figures` 字段）。

| case | 数据 | 达标线 |
|---|---|---|
| `cases/case01` | 569 条，原始设备 | recall ≥ **0.90**，precision ≥ **0.80** |
| `cases/case02` | 320 条，**另一台仪器**送来的数据（量程不同、有测量噪声、缺陷件更少） | recall ≥ **0.85**，precision ≥ **0.80** |

> 网络结构、优化器、学习率、批大小、epoch 数、早停策略、判定阈值都由**你自己决定**
> （选一个你能讲清楚的即可，不必做多个方案的对比）。达标与否看上面三条是否真的做到
> （判据见 `judge.md`）。**必须真的训练**：报告里没有逐轮训练历史 = 直接不通过。

## 实验流程（六步，每一步都要走完）

这是一个**完整的小项目**。按下面六步走，②④⑤都要产图（共至少 3 张）：

| 步 | 做什么 | 产出/落点 |
|---|---|---|
| ① **看清需求** | 解决什么问题、什么算成功（recall 优先，且 precision 不能塌） | 心里有数 |
| ② **看一眼数据 + 画图** | 多少行、多少列、两类各占多少、**各列量纲差多少**、哪列最区分两类；**画一张总览图** | `figures/` 里第 1 张图 |
| ③ **定基线** | 不做模型能做到多少（现有做法：`mean_radius ≥ 15` 判缺陷），在**同一个测试集**上算它的 recall / precision | 报告的 `baseline` |
| ④ **训练模型 + 画图** | 标准化 → 划分训练/验证 → 多轮训练，**记录每轮的训练损失与验证损失**；画训练曲线 | 报告的 `training`、`figures/` 里第 2 张图 |
| ⑤ **评估 + 画图** | 在测试集上算 recall / precision，并**画混淆矩阵**看漏检与误报各多少 | 报告的 `metrics`、`figures/` 里第 3 张图 |
| ⑥ **写结论** | 每张图一句结论 + 整体判断（`notes`：怎么处理过拟合、和基线比如何、还有什么不足） | 报告的 `figures` / `notes` |

> 图用 `matplotlib` 画（镜像已预装），存到工作目录的 `figures/` 下，例如
> `plt.savefig("figures/training_curve.png", dpi=110)`。**图是给你自己看的** ——
> 但请把"从图里看到了什么"写进 `takeaway`，否则没人知道你看了。
>
> ⚠️ 图里的**标题与坐标轴标签建议用英文**（如 `Training curves`）：运行环境里没有中文字体，
> 中文会渲染成方框。中文解释写在 `takeaway` 和 `notes` 里（那些是给人读的）。

## 数据字典（`data.csv`）

每行是**一件来料**的 30 个形态量读数（**30 个数值特征 + 1 个标签**）。

| 组 | 说明 |
|---|---|
| 10 个测量量 | `radius` 半径、`texture` 纹理、`perimeter` 周长、`area` 面积、`smoothness` 平滑度、`compactness` 紧致度、`concavity` 凹陷度、`concave_points` 凹陷点数、`symmetry` 对称性、`fractal_dimension` 分形维数 |
| 3 个版本（前缀/后缀） | `mean_*` 均值、`*_error` 标准误、`worst_*` 最差值 |

例：`mean_radius`（平均半径）、`radius_error`（半径的标准误）、`worst_radius`（最差半径）。

| 列 | 含义 |
|---|---|
| `defect` | **目标**：1 = 缺陷（要检出的那一类），0 = 正常 |

> 数据来自公开数据集 **UCI Breast Cancer Wisconsin**（569 条真实测量，sklearn 自带），
> 按 case 做了可复现的改造。**case02 是"另一台仪器"的量程**：某些列比 case01 大两个数量级
> （先看一眼量纲，否则你会白训很久）。

## 交付格式

**`output.json`**（写在工作目录下）：

```json
{
  "model": "你最终使用的模型名称（例如 MLP(32,16)+dropout+Adam+early stop）",
  "n_train": 426,
  "n_test": 143,
  "metrics": { "recall": 0.96, "precision": 0.98, "accuracy": 0.97 },
  "baseline": { "name": "radius_threshold_15", "recall": 0.72, "precision": 0.86, "accuracy": 0.85 },
  "training": {
    "epochs_planned": 200,
    "epochs_run": 36,
    "best_epoch": 16,
    "early_stopped": true,
    "hidden_layers": [32, 16],
    "history": [
      { "epoch": 1, "loss": 0.61, "val_loss": 0.55 },
      { "epoch": 2, "loss": 0.42, "val_loss": 0.4 }
    ]
  },
  "figures": [
    { "path": "figures/data_overview.png", "takeaway": "缺陷占 37%，worst_concave_points 在两类间分得最开，但仍有重叠区，单看一列会漏检。" },
    { "path": "figures/training_curve.png", "takeaway": "验证损失第 16 轮最低后回升，训练损失还在降 —— 从那里开始过拟合，所以取最优轮次。" },
    { "path": "figures/evaluation.png", "takeaway": "漏检 2 例、误报 1 例；漏检是本任务最贵的错误。" }
  ],
  "notes": "先看图确认两类不均衡、各列量纲差几个数量级，所以只用训练集拟合了标准化。现有做法（只看 mean_radius ≥ 15）在测试集上 recall 只有 0.72；改用 30 列特征训练 MLP（32-16 隐层 + dropout 0.2 + Adam + 早停），recall 0.96、precision 0.98。不足：漏检仍有 2 例，若更在意漏检可以把判定阈值下调。"
}
```

- `metrics` 必须有 `recall` 与 `precision`（`accuracy` 可选，但推荐一并给出）。
- `training` 必须有 `history`（**每轮一条**，含 `loss` 与 `val_loss`）、`epochs_run`、
  `best_epoch`、`early_stopped`；`epochs_planned` / `hidden_layers` 可选。轮数很多（`epochs_run` > 60）时可按等间隔抽样到约 60 条 —— 完整曲线以训练曲线图为准，别把报告撑得过大。
- `baseline` 必须是你**自己算出来的**现有做法成绩：`mean_radius ≥ 15` 判缺陷时，
  在**同一个测试集**上的 `recall` / `precision` / `accuracy`。（判据会核对它是否可信。）
- `n_train` 指"除测试集以外的全部样本"（含你内部划出的验证集），保证 `n_train + n_test` = 全部行数。
- `figures` 至少三张：看数据（②）、训练曲线（④）、评估（⑤，建议混淆矩阵），每张都要有 `path` 与一句 `takeaway`。
- 数值不需要和任何"标准答案"一致 —— 达标看的是"是否真的达到 recall / precision 线"。

## 怎么算完成

1. 写一个能跑的方案（推荐做成 Skill 里的一段脚本），能对任意一份同结构 `data.csv`
   产出 `output.json` 与三张图。
2. 在 `cases/case01` 与 `cases/case02`（不同仪器/不同规模）上都达标 —— 判据对两个 case 各判一次。
3. 把结论与踩过的坑写进 `SKILL.md` 的「实测档案」。

判据全文见 `judge.md`；怎么自测、包内还有什么，见 `README.md`。
