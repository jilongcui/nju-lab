---
name: ml-basics
description: 按 params.json 指定的口径（回归/分类、模型与超参、切分随机种子）训练并评估 sklearn 模型，输出统一结构的指标 JSON。当用户要求"训练/评估模型""复现某个建模结果""跑一遍基线模型"时使用。
---

# 机器学习基础建模 Skill（参考实现 · 学习示范）

> 📖 **这份实现随题目包一起下发**（`problem/reference/`），是给你的**示范**：
> 建议先读懂它（尤其 `scripts/train.py`），再在 `skill/` 里写自己的版本 ——
> 自己敲一遍、改掉你觉得别扭的地方，比复制粘贴学得多。
>
> 它与你的起点 `skill-template/` 形态完全一致、函数划分也刻意对齐
> （`load_case` / `train_and_evaluate` / `main`），方便逐段对照：
> 哪一段没头绪，就看这一段是怎么写的。
>
> 教师侧它还有第二个用途：**题目可解性自检**（`--skill problem/reference` 跑复验应全通过）。

## 能力边界

- **能处理**：数值型特征 + 单标签的 CSV（表头 + 数据行，**最后一列是 `target`**）；
  `LinearRegression` / `LogisticRegression` 两个模型及其构造参数（`model_params` 原样透传）。
- **能处理**：`regression` / `classification` 两类任务，指标按任务给出（回归 `r2`/`mae`，
  分类 `accuracy`/`confusion_matrix`）—— 分类含**二分类与多分类**（混淆矩阵按类别数 K 给 K×K）。
- **不处理**：类别型特征编码（所有列必须是数值，`float()` 失败即抛错）；
  缺失值填补（CSV 里出现空值会读成 `nan`，直接进模型）；
  其他模型族（`model` 不在白名单即报错，不做静默回退）；GPU / 大数据（复验镜像只有 CPU）。
- **不负责**：调参搜索、特征工程、模型持久化 —— 本题只产出一次训练的指标 JSON。

## 使用方法

```sh
python3 scripts/train.py <case_dir> <output.json>
```

`<case_dir>` 里要有 `input.csv` 与 `params.json`。平台复验时工作目录里就是这两份文件，
此时 `<case_dir>` 传 `.` 即可。

## 建模口径（已实现）

1. **特征与标签**：`input.csv` 第一行是表头，**最后一列是标签**，其余列是特征。
2. **分类标签**：`task == "classification"` 时把 `y` 转成整数（`astype(int)`）——
   数据里标签以浮点读入，不转会触发 sklearn 的"连续目标"报错。
3. **切分**：`train_test_split(X, y, test_size=params.test_size, random_state=params.random_state)`；
   当 `task == "classification"` 且 `params.stratify` 为真时，额外传 `stratify=y`。
   `test_size` / `random_state` **必须照抄 params**（用 sklearn 默认值会让 `n_train`/`n_test` 对不上）。
4. **模型**：`model` 指定类名，`model_params` 直接透传给构造函数
   （例：`{"class_weight": "balanced"}`）。
5. **指标**（全部基于测试集预测）：
   - `regression`：`r2`（`r2_score`）、`mae`（`mean_absolute_error`）；
   - `classification`：`accuracy`（`accuracy_score`）、`confusion_matrix`（2×2 嵌套整数列表）。
6. **精度**：指标数值 `round(x, 4)`；混淆矩阵保持整数。

## 自测

```sh
# 单个 case（数值差 ≤ 0.001 视为一致）
python3 scripts/train.py ../problem/cases/case01 /tmp/out.json
diff /tmp/out.json ../problem/cases/case01/expected.json

# 重算全部 expected.json（教师侧，口径改动后使用；**必须与复验同一个镜像**）
python3 scripts/train.py --regen-cases
```

## 实测档案（dossier）

- 自测时间：2026-10-08
- 用例通过率：5/5（case01 线性回归 R²=0.9861 / case02 均衡二分类 acc=0.90 /
  case03 类别不平衡 + `class_weight="balanced"` acc=0.92 / case04 **三分类** acc=0.75（CM 3×3）/
  case05 回归 + `fit_intercept=False` R²=0.4907）
- 踩坑记录（pitfalls）：
  1. 分类任务漏传 `stratify=y` 时脚本不报错，但 `n_train`/`n_test` 与期望不一致（最先暴露问题的是样本数而不是指标）。
  2. `y` 用 `float` 直接喂 `LogisticRegression` 会被当成连续目标报错，必须先 `astype(int)`。
  3. `expected.json` 必须在**与复验同一个镜像**里生成：sklearn 主版本变化会改变指标数值。
  4. `stratify` 为 `false` 时若仍传 `stratify=y`，切分结果不同 —— case04 的 `n_train`/`n_test` 与指标会一起错。
  5. 漏传 `model_params`（用默认 `fit_intercept=True`）时 case05 的 R² 会从 0.4907 跳到 ≈0.98 —— 最容易蒙混过关的一处。
