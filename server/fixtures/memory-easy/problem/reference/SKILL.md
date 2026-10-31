# 参考实现（示范）

> 出题时的示范：一份走完六步的 `scripts/solve.py`。平台不检查这份内容，只要求它在题包里。

## 怎么做

1. 读 `memory_seed.json`（表）与 `ops.jsonl`（操作序列，一行一个）；
2. 四个操作各写一个函数：`store` 只追加；`update` 把旧条目转 `superseded` 再追加 `<id>v2`；
   `forget` 只改 `active`；`retrieve` 过滤 `active` 后按 `id` 升序；
3. 每个操作之后记一步快照（`step` / `op` / `rows`，`rows` 只留 `id` + `status`）；
4. 收尾算三种状态的计数，保留完整 `rows`（含 `fact` / `kind`）；
5. 画每步三种状态的堆叠柱状图（轴标签英文），写 `output.json`。

## 实测记录

见同目录 `report.md`（示范填写）。
