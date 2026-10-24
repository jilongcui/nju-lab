# 参考实现（示范）

> 出题时的示范：一份走完六步的 `scripts/solve.py`。平台不检查这份内容，只要求它在题包里。

## 怎么做

1. `CREATE TABLE visits (...)` 建表，`primary_key = visit_id`；
2. 用 `csv.DictReader` 逐行 `INSERT`（`systolic` / `diastolic` 转 int）；
3. 四条 SQL：`WHERE ... OR ...` + `DISTINCT`；`GROUP BY department` + `ORDER BY n DESC, department`；
   `AVG(systolic)` + `round(...,1)`；`GROUP BY patient_id HAVING COUNT(*) >= 2`；
4. `matplotlib` 画各科室次数柱状图（轴标签英文）；
5. 写 `output.json`，`notes` 说清四条查询怎么写、哪条最容易错。

## 实测记录

见同目录 `report.md`（示范填写）。
