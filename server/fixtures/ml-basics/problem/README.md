# 题目包：机器学习基础建模（v1.0.0）

3 个用例，每个目录下 `input.csv`（数据）+ `params.json`（建模参数）+ `expected.json`（期望产出）。

## 输入

- `input.csv`：表头 + 数据行，**最后一列是 `target`**，其余列是数值特征。
- `params.json`：本次 case 的 `task` / `model` / `model_params` / 切分口径。

## 口径（评分以 `expected.json` 为准，逐字段容差见 `judge.md`）

固定 `train_test_split(test_size=params.test_size, random_state=params.random_state[, stratify=y])`，
用指定 sklearn 模型在训练集 fit、测试集 predict，指标保留 4 位小数：
回归给 `r2`/`mae`，分类给 `accuracy`/`confusion_matrix`。

## 用例覆盖

| case | 数据 | 模型 | 期望（测试集） | 考点 |
|---|---|---|---|---|
| case01 | 80 行、2 特征、线性关系+噪声 | `LinearRegression` | `r2=0.9861`、`mae=0.4626` | 回归口径与四舍五入 |
| case02 | 200 行、2 特征、类别均衡 | `LogisticRegression` | `accuracy=0.90`、CM=`[[22,4],[1,23]]` | `stratify` 与混淆矩阵结构 |
| case03 | 300 行、正例约 10% | `LogisticRegression(class_weight="balanced")` | `accuracy=0.92`、CM=`[[61,6],[0,8]]` | `model_params` 透传与不平衡场景 |

> 三个 case 的指标都**不是满分**，所以"模型没训好/口径抄错"会真的掉分，而不是碰巧全对。

## 依赖

`manifest.requires.python = ["sklearn", "pandas", "numpy"]` —— 复验镜像 `nju-lab-verify:0.2.0-rc.2-pkg4`
已预装（scikit-learn 1.9.1 / pandas / numpy），驱动会在开跑前自检，缺了直接失败。

## 自测方法

```sh
python3 <你的skill>/scripts/train.py cases/case01/input.csv cases/case01/params.json out.json
python3 - <<'PY'
import json
exp = json.load(open("cases/case01/expected.json", encoding="utf-8"))
got = json.load(open("out.json", encoding="utf-8"))
print("exact match:", exp == got)
print("expected:", exp); print("got     :", got)
PY
```

四个顶层字段全部对上（数值差 ≤ 0.001）即该 case 通过。
