# 包内说明（关系数据库实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、清洗口径、更正口径、查询口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两批数据（不同规模），每个 case 有 `patients.csv` / `visits.csv` / `labs.csv` / `corrections.json` 与 `expected.json` |
| `reference/` | **参考实现**（一份写完的方案）—— 先读后仿，不是标准答案 |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

## 本地自测（两个 case 都要跑）

把工作目录切到某一个 case，脚本把 `output.json` 与图写到当前目录：

```sh
mkdir -p /tmp/sql-crud-run && cd /tmp/sql-crud-run

# 用参考实现跑一遍（看看"对的"长什么样）
python3 <题目包>/reference/scripts/run_sql.py <题目包>/cases/case01 ./output.json

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/run_sql.py <题目包>/cases/case01 ./output.json
```

然后自己核对三件事（这就是判据的口径）：

1. **口径**：`loaded` / `dropped` 与 `cases/<case>/expected.json` 里的对应项相同；
2. **更正**：`crud.rejected_orphan_labs` 为 1（那条引用不存在就诊的报告必须被拒绝），其余条数也对得上；
3. **查询**：`query_results` 与 `expected.json` 一致（`q2` 的顺序不计分，内容要一致）。

> `expected.json` 是**参考水平**不是标准答案：清洗与查询口径已经钉死，所以只要口径对，
> 这些数值本来就该相同；口径错了就会不一样 —— 它同时是你自查"我有没有漏掉某一类脏数据"的镜子。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| `loaded.labs` 比预想少很多 | 级联丢弃：有些就诊行被丢掉了，挂在它下面的检验报告就"对不上"了 | 按 task.md 的顺序 patients → visits → labs 清洗，每级都用**清洗后**的 id 判断引用 |
| 那条补录的报告**没有**被拒绝 | 没打开外键约束 | SQLite 在每次连接上执行 `PRAGMA foreign_keys = ON`（默认是关的） |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标题/轴标签用英文，中文写在 `takeaway` / `notes` 里 |
| 日期 `07-03-2026` 解析成 7 月 3 日 | 口径是 **日-月-年** | 三种格式：`YYYY-MM-DD`、`YYYY/M/D`、`DD-MM-YYYY` |
| 去重数量对不上 | 去重发生在**清洗之后**（空字段/非法值/孤儿行先被丢掉，不参与去重比较） | 先校验再去重 |
