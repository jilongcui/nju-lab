# 题目包：机器学习基础建模（v1.0.0）

5 个用例，每个目录下 `input.csv`（数据）+ `params.json`（建模参数）+ `expected.json`（期望产出）。

## 输入

- `input.csv`：表头 + 数据行，**最后一列是 `target`**，其余列是数值特征。
- `params.json`：本次 case 的 `task` / `model` / `model_params` / 切分口径。

## 口径（评分以 `expected.json` 为准，逐字段容差见 `judge.md`）

固定 `train_test_split(test_size=params.test_size, random_state=params.random_state[, stratify=y])`，
用指定 sklearn 模型在训练集 fit、测试集 predict，指标保留 4 位小数：
回归给 `r2`/`mae`，分类给 `accuracy`/`confusion_matrix`。

## 用例覆盖

| case | 数据 | 模型 / 参数 | 期望（测试集） | 考点 |
|---|---|---|---|---|
| case01 | 80 行、2 特征、线性关系+噪声 | `LinearRegression` | `r2=0.9861`、`mae=0.4626` | 回归口径与四舍五入 |
| case02 | 200 行、类别均衡 | `LogisticRegression` | `accuracy=0.90`、CM=`[[22,4],[1,23]]` | `stratify=y` 与混淆矩阵结构 |
| case03 | 300 行、正例约 10% | `LogisticRegression(class_weight="balanced")` | `accuracy=0.92`、CM=`[[61,6],[0,8]]` | `model_params` 透传与不平衡场景 |
| case04 | 240 行、**三分类**、三簇重叠 | `LogisticRegression`、`test_size=0.2`、`random_state=7`、**`stratify=false`** | `accuracy=0.75`、CM=`[[11,2,0],[1,12,3],[0,6,13]]` | 多分类（混淆矩阵是 **3×3**）、**不传 `stratify` 的分支**、非默认切分与种子 |
| case05 | 120 行、真实截距 4.0 | `LinearRegression(fit_intercept=false)`、`test_size=0.3` | `r2=0.4907`、`mae=2.662` | `model_params` **是否真的透传** |

> 五个 case 的指标都**明显不是满分**（`0.49` ~ `0.92`），口径抄错会真的掉分、不容易碰巧全对。
> **case05 是照妖镜**：不把 `model_params` 传给构造函数（用默认 `fit_intercept=true`），
> R² 会从 `0.4907` 跳到 ≈`0.98` —— 一眼看出实现有没有透传。

## 依赖

`manifest.requires.python = ["sklearn", "pandas", "numpy"]` —— 复验镜像 `nju-lab-verify:0.2.0-rc.2-pkg4`
已预装（scikit-learn 1.9.1 / pandas / numpy），驱动会在开跑前自检，缺了直接失败。

## 自测方法

CLI 约定：`train.py <case_dir> <output.json>`（`<case_dir>` 里要有 `input.csv` 与 `params.json`）。

```sh
# 单个 case
python3 <你的skill>/scripts/train.py cases/case01 out.json
python3 -c "import json;a=json.load(open('out.json'));b=json.load(open('cases/case01/expected.json'));print('exact:',a==b);print('got :',a);print('want:',b)"

# 全部 5 个 case（同一套容差口径：数值差 ≤ 0.001、结构逐项相等）
for c in cases/*/; do
  python3 <你的skill>/scripts/train.py "$c" /tmp/out.json >/dev/null
  python3 - "$c" <<'PY'
import json, pathlib, sys
c = pathlib.Path(sys.argv[1])
exp = json.load(open(c / 'expected.json', encoding='utf-8'))
got = json.load(open('/tmp/out.json', encoding='utf-8'))
def close(a, b):
    if isinstance(a, dict): return a.keys() == b.keys() and all(close(a[k], b[k]) for k in a)
    if isinstance(a, list): return len(a) == len(b) and all(close(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and not isinstance(a, bool) and isinstance(b, (int, float)):
        return abs(a - b) <= 0.001
    return a == b
print(c.name, 'PASS' if close(exp, got) else 'FAIL')
PY
done
```

四个顶层字段全部对上（数值差 ≤ 0.001）即该 case 通过；5 个全过即通过率 5/5。
