# 参考实现（示范）

> 出题时的示范：一份走完六步的 `scripts/solve.py`。平台不检查这份内容，只要求它在题包里。

## 怎么做

1. 读 `reference_ranges.csv`（建 dict，空格转 `None`）与 `report.csv`（逐行）；
2. `judge()` 按七条顺序判：表外项目 → unknown；空值 → unknown；危急高（`>=`）→ 危急低（`<=`）→
   偏高（`>`）→ 偏低（`<`）→ 正常；
3. 每条 `reason` 写出比较对象（阈值或区间），让读的人能复核；
4. 抽 `critical_alerts`（带 `threshold` 与 `side`），算六类 flag 计数；
5. 画各类 flag 项数柱状图（轴标签英文），写 `output.json`。

## 实测记录

见同目录 `report.md`（示范填写）。
