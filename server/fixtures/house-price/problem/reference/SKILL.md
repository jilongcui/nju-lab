---
name: house-price
description: 按面积估算房子总价（入门回归）：读 data.csv、与"平均单价 × 面积"的基线对比、产出含判断理由的 output.json。当用户要求"按面积估价""估算房价""做一个简单的回归实验"时使用。
---

# 房价估算 Skill（参考实现）

> 这是**示范实现**（随题目包下发）：把六步完整走了一遍。**它不是唯一正确答案** ——
> 换模型（KNN 回归 / 决策树 / 随机森林）同样能达标。

## 这份实现做了什么

| 步 | 做法 |
|---|---|
| ① 看清需求 | 比"平均单价 × 面积"更准；现有做法会高估小户型、低估大户型 |
| ② 看一眼数据 + 画图 | `data_overview.png`：面积-总价散点 + 总价分布 |
| ③ 定基线 | `build_baseline`：平均单价（**只用训练集估计**）× 面积，在同一测试集上算 MAE |
| ④ 训练模型 | `train_model`：一元线性回归（面积 + 截距） |
| ⑤ 评估 + 画图 | `evaluation.png`：预测 vs 实际 + 残差 |
| ⑥ 写结论 | `compose_notes` + 每张图一句 `takeaway` |

## 能力边界（示范填写）

- 能处理：与 `data.csv` 同结构的**一个数值特征 + 一个数值目标**的数据
- 能处理：与"平均单价 × 面积"基线的对比评估，给出 MAE / R²
- 不处理：面积之外的强相关因素（地段、楼层、装修）—— 只用面积时，同面积的价差消不掉
- 不处理：缺测值、面积单位不是 m²、或目标不是万元的数据
- 不处理：面积与总价明显非线性（如豪宅的边际单价反而上升）的情形

## 使用方法

```sh
python3 scripts/train.py <case目录> <output.json>   # 单个 case（图写到 ./figures/）
python3 scripts/train.py --regen-expected           # 重算 cases/*/expected.json（教师用）
```

## 估算口径

1. 特征：`area_m2`；目标：`total_price_wan`。
2. 切分：`test_size=0.25`、`random_state=42`。
3. 基线：`unit_price = mean(y_train / x_train)`，预测 `unit_price * x_test`。
   **平均单价只用训练集估计**，否则等于偷看答案。
4. 模型：`LinearRegression()`（会拟合出截距 —— 它对应"与面积无关的固定价值"）。
5. 指标：`mae`、`r2`（保留 4 位）。
6. 图：标题与轴标签用英文（镜像无中文字体），中文解释写进 `takeaway` / `notes`。
