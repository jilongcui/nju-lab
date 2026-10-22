---
name: dl-score-regression
description: 按练习情况估算期末成绩（入门神经网络回归）：读 data.csv、训练小 MLP、与"一律报平均分"基线对比，产出含训练历史的 output.json。当用户要求"估算学生成绩""训练一个小回归网络""做一个简单的回归实验"时使用。
---

# 成绩估算 Skill（参考实现）

> 这是**示范实现**（随题目包下发）：把六步完整走了一遍。**它不是唯一正确答案** ——
> 换隐藏层大小、换优化器、换激活函数同样能达标。

## 这份实现做了什么

| 步 | 做法 |
|---|---|
| ① 看清需求 | 提前发现要补课的学生；比"一律报平均分"准得多 |
| ② 看一眼数据 + 画图 | `data_overview.png`：练习时长/出勤率分别与成绩的散点 |
| ③ 定基线 | `build_baseline`：一律报训练集的平均分 |
| ④ 训练模型 | `train_model`：输入与目标都标准化 + 两层 MLP（2→16→1），**逐轮记录损失** |
| ⑤ 评估 + 画图 | `training_curve.png`（损失怎么降）+ `evaluation.png`（预测-实际 + 残差） |
| ⑥ 写结论 | `compose_notes` + 每张图一句 `takeaway` |

## 能力边界（示范填写）

- 能处理：与 `data.csv` 同结构的两个数值特征 + 一个数值目标（0~100 分）
- 能处理：与"一律报平均分"基线的对比评估，给出 MAE / R² 与训练历史
- 不处理：特征列名不同、或目标不是分数（量纲变了要重新标准化）
- 不处理：缺测值、出勤率越界（<0.5 或 >1.0）的数据
- 不处理：样本极少（<50 行）时的稳定训练 —— 网络容易过拟合

## 使用方法

```sh
python3 scripts/train.py <case目录> <output.json>   # 单个 case（图写到 ./figures/）
python3 scripts/train.py --regen-expected           # 重算 cases/*/expected.json（教师用）
```

## 训练口径

1. 特征：`weekly_hours`、`attendance_rate`；目标：`final_score`。
2. **输入与目标都标准化**（用训练集的 mean/std）—— 目标不标准化时，MSE 的量级太大、
   优化器要很久才挪到正确偏置，本实验实测会直接不收敛。
3. 网络：`Linear(2,16) → ReLU → Linear(16,1)`；损失 `MSELoss`；Adam(lr=0.05)、全批量、200 轮。
4. 切分：`test_size=0.25`、`random_state=42`（不 stratify —— 回归没有类别）。
5. 预测：网络输出乘回 `y_std` 再加 `y_mean`，得到分数。
6. 指标：`mae`、`r2`；训练历史逐轮记 `train_loss`。
7. 图：标题与轴标签用英文（镜像无中文字体），中文解释写进 `takeaway` / `notes`。
