---
name: dl-mlp-digits
description: 分拣手写数字（入门神经网络三分类）：读 8×8 像素 CSV、训练小 MLP、与"一律猜最多"基线对比，产出含训练历史的 output.json。当用户要求"识别手写数字""训练一个小神经网络""做一个简单的分类实验"时使用。
---

# 手写数字分拣 Skill（参考实现）

> 这是**示范实现**（随题目包下发）：把六步完整走了一遍。**它不是唯一正确答案** ——
> 换隐藏层大小、换优化器、换轮数同样能达标。

## 这份实现做了什么

| 步 | 做法 |
|---|---|
| ① 看清需求 | 3/8/9 三个数字都要认；比"一律猜最多"好得多；要有训练过程证据 |
| ② 看一眼数据 + 画图 | `data_overview.png`：每类一张 8×8 样例图 + 类别计数 |
| ③ 定基线 | `build_baseline`：一律猜训练集里最多的数字 |
| ④ 训练模型 | `train_model`：两层 MLP（64→32→3，ReLU + Adam），**逐轮记录训练损失** |
| ⑤ 评估 + 画图 | `training_curve.png`（损失怎么降）+ `evaluation.png`（3×3 混淆矩阵） |
| ⑥ 写结论 | `compose_notes` + 每张图一句 `takeaway` |

## 能力边界（示范填写）

- 能处理：与 `data.csv` 同结构的 8×8 像素（`p00`~`p77`）+ 三个类别（3/8/9）的数据
- 能处理：与"一律猜最多"基线的对比评估，给出 accuracy / macro F1 与训练历史
- 不处理：其它数字或更多类别（输出层要改成对应的类别数）
- 不处理：比 8×8 更大的图片（`PIXELS` 是写死的 64 列）
- 不处理：缺测像素、像素取值范围不是 0~16 的数据（归一化按除以 16 写死）

## 使用方法

```sh
python3 scripts/train.py <case目录> <output.json>   # 单个 case（图写到 ./figures/）
python3 scripts/train.py --regen-expected           # 重算 cases/*/expected.json（教师用）
```

## 训练口径

1. 输入：64 个像素 / 16.0（归一到 0~1）；标签映射成 0/1/2（`CrossEntropyLoss` 要的下标）。
2. 网络：`Linear(64,32) → ReLU → Linear(32,3)`。
3. 训练：Adam(lr=0.05)、全批量、30 轮，`torch.manual_seed(42)` 固定初始权重。
4. 切分：`test_size=0.25`、`random_state=42`、`stratify=y`。
5. 指标：`accuracy`、`macro_f1`；训练历史逐轮记 `train_loss`。
6. 图：标题与轴标签用英文（镜像无中文字体），中文解释写进 `takeaway` / `notes`。
