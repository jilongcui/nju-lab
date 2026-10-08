评分细则（逐字段核对实际产出 output.json 与期望产出 expected.json）：

1. 顶层键必须**恰好**是 `model`、`n_train`、`n_test`、`metrics`；
   多键、少键、键名拼写不同（如 `accuracy` 写成 `acc`）→ 不通过。
2. `model`：字符串必须与期望完全一致。
3. `n_train` / `n_test`：与期望完全相等（整数）。
   切分口径写错（`random_state` 不对、分类漏传 `stratify`）通常最先在这里暴露。
4. `metrics`：
   - 回归：必须有 `r2` 与 `mae`，各自的绝对值与期望相差 ≤ 0.001 视为一致。
   - 分类：必须有 `accuracy` 与 `confusion_matrix`；`accuracy` 绝对差 ≤ 0.001；
     `confusion_matrix` 必须是 **2×2 嵌套整数列表**且逐元素相等。
   - `metrics` 内**不允许**出现该 task 之外的指标键（例如回归里混进 `accuracy`）。
5. 判定口径：
   - JSON 的键序、缩进、空白差异不扣分；数值只要在容差内即视为一致。
   - 只要有一条不满足：pass=false，并在 rationale 里指出**具体哪个字段**不符、期望与实际各是多少。
   - 全部满足：pass=true，score=1；否则 score 按满足的字段比例给 0~1 的小数。
