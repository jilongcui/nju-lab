# 入门实验：血压随访记录查一查（SQL · 单表）

## 业务背景

社区卫生站把每次随访记在 **一张表** 里：谁（`patient_id`）、哪天（`visit_date`）、在哪个科室（`department`）、
收缩压与舒张压（`systolic` / `diastolic`）。现在要回答医生最常问的几个问题：

- 哪些人的血压超标（收缩压 ≥ 140 **或** 舒张压 ≥ 90）？
- 各科室各随访了多少次？
- 平均收缩压是多少？
- 哪些人被随访了不止一次？

数据就在 \`visits.csv\`（case01 20 行，case02 24 行）。

## 你的任务

用 **SQLite**（Python 自带 \`sqlite3\`，不用装任何东西）把 CSV 导进一张表，然后用 SQL 回答四个问题，
把结果写进 \`output.json\`，并画一张「各科室随访次数」的柱状图。

1. **四条查询的口径**（顺序与排序都算分）：
   - `q1_high_bp`：收缩压 ≥ 140 或舒张压 ≥ 90 的 `patient_id`，**去重、升序**；
   - `q2_by_department`：每个科室的随访次数，形如 `[{ "department": "全科", "n": 8 }]`，
     按**次数降序、科室名升序**；
   - `q3_avg_systolic`：全表平均收缩压，**四舍五入到 1 位小数**；
   - `q4_followup_twice`：随访 **≥2 次** 的 `patient_id`，升序。
2. **可复现**：不要手写结果 —— 必须真的建表、导入、用 SQL 查出来。
3. **画一张图**：各科室随访次数（轴标签用英文，中文写进 `takeaway`）。

## 实验流程（六步）

| 步 | 做什么 | 产出 |
|---|---|---|
| ① 看清需求 | 四条查询的口径与排序规则 | 心里有数 |
| ② 看一眼数据 | 列名、行数、科室有哪些 | 图（可选） |
| ③ 建表 + 导入 | `CREATE TABLE` + 逐行 `INSERT` | `schema` / `loaded` |
| ④ 写 SQL | 过滤 / 聚合 / `GROUP BY` / `HAVING` | `query_results` |
| ⑤ 核对 | 与 `expected.json` 对一眼 | 数字一致 |
| ⑥ 写结论 | 结论与踩坑 | `report.md` |

## 交付格式

**`output.json`**（写在工作目录下）：

```json
{
  "schema": {
    "table": "visits",
    "columns": [["visit_id","TEXT"],["patient_id","TEXT"],["visit_date","TEXT"],["department","TEXT"],["systolic","INTEGER"],["diastolic","INTEGER"]],
    "primary_key": ["visit_id"]
  },
  "loaded": { "rows": 20 },
  "query_results": {
    "q1_high_bp": ["P02", "P04"],
    "q2_by_department": [{ "department": "全科", "n": 8 }],
    "q3_avg_systolic": 138.5,
    "q4_followup_twice": ["P01", "P02"]
  },
  "figures": [
    { "path": "figures/by_department.png", "takeaway": "全科的随访次数最多（8 次），占了大半。" }
  ],
  "notes": "……（≥40 字：四条查询分别用什么 SQL 写、哪条最容易写错、case02 与 case01 的差别）"
}
```

- 数字类型：`n` / `rows` / `q3_avg_systolic` 是**数字**，不要写成字符串。
- `figures` 至少 1 张，`path` 与实际落点一致（相对当前工作目录）。

## 怎么算完成

1. 两个 case（`cases/case01`、`cases/case02`）都跑通，四条查询与 `expected.json` 一致。
2. 图能打开、`takeaway` 与数据自洽。
3. 把结论与踩过的坑记下来 —— 报告会由工具整理进 `report.md`，**不需要改 `SKILL.md`**。

判据全文见 `judge.md`。
