---
name: ml-basics
description: 按 params.json 指定的口径（回归/分类、模型与超参、切分随机种子）训练并评估 sklearn 模型，输出统一结构的指标 JSON。当用户要求"训练/评估模型""复现某个建模结果""跑一遍基线模型"时使用。
---

# 机器学习基础建模 Skill

> **本实验的四份材料**（都在题目包 `problem/` 里，领取后有）：
>
> | 材料 | 作用 |
> |---|---|
> | `task.md` | **要按什么做**（口径：切分、指标、输出结构） |
> | `judge.md` | **怎么算对**（判据与容差） |
> | `reference/` | **一份完整的示范实现** —— 先读它，再写你自己的那版 |
> | `cases/case0N/` | 5 个用例（`input.csv` + `params.json` + `expected.json`），本地自测用 |
>
> 建议节奏：① 读 `task.md` 弄清要做什么 → ② 读 `reference/scripts/train.py` 看一遍怎么做的
> → ③ 回 `skill/` 自己敲一遍（可以对照，但别直接复制）→ ④ 用 `cases/` 自测 → ⑤ 写下面的
> 「能力边界」和「实测档案」→ ⑥ 提交、看平台复验反馈。

## 能力边界（TODO：学生补全）

> 说明：这一节是平台会扫描的评分信号之一，也是**给你自己**梳理"这个 Skill 到底能干什么"。
> 请如实填写本 Skill **能做什么、不能做什么**，并用 `cases/` 自测后把结论补进来。

- 能处理：数值型特征 + 单标签的 CSV（表头 + 数据行，最后一列是 `target`）
- 能处理：`LinearRegression` / `LogisticRegression` 两类模型与它们的构造参数
- 能处理：二分类与多分类（混淆矩阵按类别数 K 给 K×K）
- TODO：本 Skill 不处理哪些情况？（例如：类别型特征编码？缺失值？非数值列？其他模型族？）

## 使用方法

```sh
python3 scripts/train.py <case_dir> <output.json>
```

`<case_dir>` 里要有 `input.csv` 与 `params.json`。
平台复验时工作目录里就是这两份文件，此时 `<case_dir>` 传 `.` 即可。

## 建模口径（怎么做 —— 对照 `problem/reference/scripts/train.py` 的对应函数）

> 每条给"**为什么** + 最小示例"。卡住的时候，看示范实现里同名函数是怎么写的。

**1. 取特征与标签** —— CSV 第一行是表头，**最后一列是标签**，其余列按表头顺序是特征。

```python
rows = list(csv.DictReader(f))
names = list(rows[0].keys())
X = np.array([[float(r[c]) for c in names[:-1]] for r in rows])   # 特征
y = np.array([float(r[names[-1]]) for r in rows])                 # 标签
```

**2. 分类任务要把标签转成整数** —— `LogisticRegression` 不接受"连续的"标签当类别。

```python
if params["task"] == "classification":
    y = y.astype(int)
```

**3. 切分口径必须照抄 `params.json`** —— `test_size` / `random_state` 每个 case 都不同；
`stratify` **只在为真时**才传（分层切分让训练/测试集里各类别比例接近原始分布，这就是它存在的理由）。

```python
strat = y if (params["task"] == "classification" and params.get("stratify", True)) else None
X_tr, X_te, y_tr, y_te = train_test_split(
    X, y, test_size=params["test_size"], random_state=params["random_state"], stratify=strat)
```

**4. `model_params` 原样透传给构造函数** —— 它就是模型构造函数的参数，`**` 解包即可。

```python
model = MODELS[params["model"]](**params.get("model_params", {}))
```

> 🔍 **值得亲手跑一遍的观察点**：`case05` 指定了 `model_params={"fit_intercept": false}`
> （强制拟合过原点），期望 `R²=0.4907`；如果你漏传这个参数，`R²` 会变成 ≈0.98。
> 自己跑两次对比一下，就明白这个参数在做什么了。

**5. 指标按任务给，保留 4 位小数** —— 回归 `r2`/`mae`；分类 `accuracy`/`confusion_matrix`
（K 个类别就是 K×K 矩阵，不是固定的 2×2）。

```python
metrics = {"r2": round(float(r2_score(y_te, pred)), 4),
           "mae": round(float(mean_absolute_error(y_te, pred)), 4)}
```

## 自测

用题目包里的 `cases/` 跑本 Skill，把 `output.json` 与 `expected.json` 逐字段比对
（数值差 ≤ 0.001）。**逐 case 的自测命令**见 `problem/README.md`（有一段可直接粘贴的循环脚本）。

把通过率与踩坑记录写到下面的实测档案。

## 实测档案（TODO：学生填写，dossier）

- 自测时间：
- 用例通过率：/5
- 踩坑记录（pitfalls）：
  （每条写成一行 —— 平台按行计数，带续行的条目只算 1 条，会少拿过程分）
