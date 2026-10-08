你是机器学习工程师。当前目录下有两份输入：`input.csv`（数据）与 `params.json`（本次建模的参数）。
请按 `params.json` 指定的口径训练并评估模型，把结果写到 `output.json`。

## 输入格式

- `input.csv`：第一行是表头，**最后一列是标签 `target`**，其余列都是特征；所有值都是数值。
- `params.json` 字段：
  - `task`：`regression` 或 `classification`
  - `model`：`LinearRegression` 或 `LogisticRegression`（sklearn 同名类）
  - `model_params`：直接透传给该模型构造函数的参数（缺省 = 用 sklearn 默认值）
  - `test_size` / `random_state` / `stratify`：切分口径，见下（`stratify` 可能为 `false`）

## 处理口径（必须完全照做，结果要可复现）

1. 按 `input.csv` 的列顺序取特征矩阵 `X`（除最后一列）与标签 `y`（最后一列）。
2. `task == "classification"` 时把 `y` 转成整数标签（**可能是多分类**，标签为 `0..K-1`）。
3. 切分：`train_test_split(X, y, test_size=test_size, random_state=random_state)`；
   当 `task == "classification"` 且 `stratify` 为真时，额外传 `stratify=y`；
   **`stratify` 为假时不要传**（传了会改变切分结果）。
4. 用 `model` 指定的模型（构造参数取 `model_params`）在训练集上 `fit`，在测试集上 `predict`。
5. 指标（全部基于**测试集**预测）：
   - `regression`：`r2`（`r2_score`）、`mae`（`mean_absolute_error`）
   - `classification`：`accuracy`（`accuracy_score`）、`confusion_matrix`（`confusion_matrix` 的结果；
     **K 类任务就是 K×K**：二分类 2×2、三分类 3×3）
6. 指标数值保留 4 位小数（`round(x, 4)`）；`confusion_matrix` 用整数。

## 输出格式（`output.json`，键名必须完全一致）

```json
{
  "model": "LinearRegression",
  "n_train": 60,
  "n_test": 20,
  "metrics": { "r2": 0.9861, "mae": 0.4626 }
}
```

- `model`：与 `params.json` 的 `model` 一致
- `n_train` / `n_test`：切分后训练集与测试集的样本数（整数）
- `metrics`：按 `task` 给对应指标键（回归 `r2`/`mae`；分类 `accuracy`/`confusion_matrix`）

只输出这四个顶层键，`metrics` 里只放该 task 要求的指标 —— 多键、少键、键名拼写不同都算不合格。
只用 `input.csv` 里的数据，不要臆造样本。
