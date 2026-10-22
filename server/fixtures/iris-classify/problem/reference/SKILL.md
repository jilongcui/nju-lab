---
name: iris-classify
description: 按花瓣尺寸判断鸢尾花品种（入门三分类）：读 data.csv、与"一律猜最多"的基线对比、产出含判断理由的 output.json。当用户要求"判断鸢尾花品种""按尺寸分品种""做一个简单的分类实验"时使用。
---

# 鸢尾花品种识别 Skill（参考实现）

> 这是**示范实现**（随题目包下发）：把六步完整走了一遍。**它不是唯一正确答案** ——
> 换模型（决策树 / KNN / 随机森林）同样能达标。

## 这份实现做了什么

| 步 | 做法 |
|---|---|
| ① 看清需求 | 三个品种都要认出来；基线是"一律猜训练集里最多的品种" |
| ② 看一眼数据 + 画图 | `data_overview.png`：两特征散点（按品种上色）+ 各类样本数 |
| ③ 定基线 | `build_baseline`：多数类预测，在同一个测试集上算 accuracy |
| ④ 训练模型 | `train_model`：逻辑回归（两个花瓣特征都用上） |
| ⑤ 评估 + 画图 | `evaluation.png`：3×3 混淆矩阵 |
| ⑥ 写结论 | `compose_notes` + 每张图一句 `takeaway` |

## 能力边界（示范填写）

- 能处理：与 `data.csv` 同结构的两个数值特征 + 三个类别的数据
- 能处理：与多数类基线的对比评估，给出 accuracy / macro F1
- 不处理：只有一两个类别的数据（macro F1 的分母会变）
- 不处理：缺测值（本实现直接读 CSV，没有做缺失填补）
- 不处理：特征列名不同或品种名不在 `setosa/versicolor/virginica` 里的数据

## 使用方法

```sh
python3 scripts/train.py <case目录> <output.json>   # 单个 case（图写到 ./figures/）
python3 scripts/train.py --regen-expected           # 重算 cases/*/expected.json（教师用）
```

## 训练口径

1. 两个特征都用；标签直接用字符串（sklearn 支持）。
2. 切分：`test_size=0.25`、`random_state=42`、`stratify=y`（三类在训练/测试集里比例一致）。
3. 模型：`LogisticRegression(max_iter=1000)`。
4. 指标：`accuracy` 与 `macro_f1`（都取 0~1，保留 4 位）。
5. 图：标题与轴标签用英文（镜像无中文字体），中文解释写进 `takeaway` / `notes`。
