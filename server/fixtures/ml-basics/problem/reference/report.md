# 实测档案（示范填写，原 reference/SKILL.md，2026-10-24 迁移）

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
