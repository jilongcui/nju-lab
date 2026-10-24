# db-easy —— 入门实验：血压随访记录查一查（SQL · 单表）

> 对应课程章节：**关系数据库**（动手实践：跑通示例 SQL → 改写条件 → COUNT/AVG/GROUP BY 分组统计）。
> 难度 **easy**：单表、四条查询、只用 Python 自带 `sqlite3`，不装任何东西。

## 场景与数据

- 应用：社区卫生站把每次血压随访记在一张表里，医生要问四个问题
- 数据：`problem/cases/case01`（20 行）/ `case02`（24 行），列 `visit_id, patient_id, visit_date, department, systolic, diastolic`
- 造题：`tools/gen_cases.py`（固定数据，可重跑；**不下发**）

## 判据设计要点

1. 四条查询逐字段比对（q1 过滤+去重+排序 / q2 GROUP BY + 两种排序 / q3 AVG 保留 1 位 / q4 GROUP BY + HAVING）；
2. 排序口径写死（q2 次数降序 + 科室名升序），否则同分顺序不稳定；
3. 只要求单表，不涉及 JOIN / 外键 / 清洗 —— 那些留给中等档 `sql-crud`。

## 项目字段文案（建项目时用）

- **title**：入门实验：血压随访记录查一查（SQL · 单表 · 容易）
- **difficulty**：`easy`
- **content**（学生详情页首屏；不写"你的任务"）：
  社区卫生站把每次随访记在一张表里：谁、哪天、哪个科室、收缩压与舒张压。
  现在要回答医生最常问的四个问题：谁血压超标、各科室随访多少次、平均收缩压多少、谁被随访了不止一次。
- **objectives**：
  1. 会用 `CREATE TABLE` + `INSERT` 把 CSV 变成一张真表（主键、列类型）；
  2. 会用 SQL 做过滤、聚合与分组（`WHERE` / `AVG` / `GROUP BY` / `HAVING`）；
  3. 知道排序口径为什么要写全（次数相同时按名字升序）。
- **background**（每条 = 概念 + 一句人话解释）：
  - **关系数据库**：数据存在一张张二维表里，行是一条记录、列是一个属性，用主键唯一标识一行。
  - **SELECT 的四个动作**：`WHERE` 筛行、`GROUP BY` 分组、聚合函数（`COUNT`/`AVG`）算每组一个数、`ORDER BY` 定顺序。
  - **HAVING 与 WHERE 的区别**：`WHERE` 在分组前筛行，`HAVING` 在分组后筛组（例如"随访 ≥2 次的人"）。
  - **类型转换**：CSV 读进来都是字符串，`systolic` 要转成整数才能比较和求平均。
- **description**：
  1. 读实验内容与本节的达标要求，确认四条查询的口径与排序；
  2. 用 `sqlite3` 建表并把 `visits.csv` 逐行导入（记下 `loaded.rows`）；
  3. 写 q1：`WHERE systolic >= 140 OR diastolic >= 90`，`DISTINCT` 去重，升序；
  4. 写 q2：`GROUP BY department` + `COUNT(*)`，按次数降序、科室名升序；
  5. 写 q3：`AVG(systolic)` 保留 1 位小数；q4：`GROUP BY patient_id HAVING COUNT(*) >= 2`；
  6. 画各科室随访次数柱状图（轴标签英文，中文写进 `takeaway`）；
  7. 两个 case 都跑一遍，与 `expected.json` 核对；
  8. 生成实验报告 `report.md`：数字由平台从各 case 的 `output.json` 自动填入，你只补结论与踩坑。
- **references**：SQLite 官方 SQL 语法（`SELECT` / `GROUP BY` / `HAVING`）；Python `sqlite3` 文档；`problem/reference/scripts/solve.py`（示范实现）。
- **faq**：为什么 q2 的顺序和我想的不一样？（次数相同的科室要按名字升序，写全 `ORDER BY n DESC, department ASC`）；为什么 q3 差一点点不算过？（要 `round(..., 1)`，容差 0.05）；能不能不用 SQL 直接算？（不行，这一步练的就是 SQL）。

## 打包 / 自检 / 发布

```sh
cd server/fixtures/db-easy
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg8 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip
```

## 实测记录

- 参考实现在复验镜像（`pkg8`）内跑通两个 case：四条查询与 `expected.json` 全一致，图正常生成；
- case01 20 行 / case02 24 行；血压超标 8 / 11 人，平均收缩压 136.6 / 139.2。
