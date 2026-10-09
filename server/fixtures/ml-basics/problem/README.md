# 题目包：机器学习基础建模（v1.0.0）

> 这是本实验的**题目包** —— 「什么叫做对了」都在这里：口径（`task.md`）、判据（`judge.md`）、
> 用例与期望值（`cases/`），另有**一份完整的示范实现**（`reference/`）供你对照学习。

## 这个实验要学什么

1. **跑通一次完整的监督学习流程**：读数据 → 切分 → 训练 → 预测 → 算指标 → 写出结果 JSON。
2. **三个"容易想当然"的点**（做完你应该能讲清）：
   - 为什么切分要固定 `random_state`？（可复现）
   - 分类任务为什么要 `stratify`？（让各集合里类别比例接近原始分布）
   - `model_params` 到底传给了谁、影响什么？（模型构造函数）
3. **怎么自证做对了**：拿自己的输出与 `expected.json` 逐字段比对（数值容差 0.001）。

## 包内有什么、怎么用

| 路径 | 是什么 | 建议怎么用 |
|---|---|---|
| `task.md` | 口径（题干） | **动手前先读** |
| `judge.md` | 判据（怎么算对、容差多少） | 交之前读一遍，避免键名/结构出错 |
| `reference/` | **示范实现**（同款 Skill、已写满） | 先把 `scripts/train.py` 读一遍，再回自己的 `skill/` 敲一遍 |
| `cases/case0N/` | 5 个用例：`input.csv` + `params.json` + `expected.json` | 本地自测 |

## 输入

- `input.csv`：表头 + 数据行，**最后一列是 `target`**，其余列是数值特征。
- `params.json`：本次 case 的 `task` / `model` / `model_params` / 切分口径。

## 口径（评分以 `expected.json` 为准，逐字段容差见 `judge.md`）

固定 `train_test_split(test_size=params.test_size, random_state=params.random_state[, stratify=y])`，
用指定 sklearn 模型在训练集 fit、测试集 predict，指标保留 4 位小数：
回归给 `r2`/`mae`，分类给 `accuracy`/`confusion_matrix`（K 个类别就是 K×K 矩阵）。

> 为什么要写得这么死？因为指标受"切分方式"影响很大 —— 口径不统一，"对错"就没有共同标准。
> 这也是 `reference/scripts/train.py` 里那几行的写法来源。

## 5 个用例，各自想让你观察什么

| case | 配置 | 期望（测试集） | 观察点 |
|---|---|---|---|
| case01 | `LinearRegression` | `r2=0.9861`、`mae=0.4626` | 最基础的回归流程：指标怎么算、怎么四舍五入 |
| case02 | `LogisticRegression` | `accuracy=0.90`、CM=`[[22,4],[1,23]]` | 分类指标与**混淆矩阵**长什么样（2×2） |
| case03 | `LogisticRegression(class_weight="balanced")` | `accuracy=0.92`、CM=`[[61,6],[0,8]]` | `model_params` 透传；类别不平衡时会发生什么 |
| case04 | `LogisticRegression`、`test_size=0.2`、`random_state=7`、`stratify=false`、**三分类** | `accuracy=0.75`、CM=`[[11,2,0],[1,12,3],[0,6,13]]` | 多分类的混淆矩阵是 **3×3**；`stratify` 不传时切分结果不同 |
| case05 | `LinearRegression(fit_intercept=false)`、`test_size=0.3` | `r2=0.4907`、`mae=2.662` | **强制拟合过原点**会付出多大代价（对比 case01 的 0.9861） |

> 指标都不是满分，这是正常的 —— 真实数据的模型就是这样。**重点是能解释"为什么是这个数"**：
> 比如 case05 的 R² 掉到 0.49，是因为数据本身有明显的截距（≈4.0），强制过原点自然拟合不上。

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

> 卡住了怎么办：先看 `reference/scripts/train.py` 里对应的那一段，再回来改自己的实现。
