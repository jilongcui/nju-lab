---
name: sql-crud
description: 关系数据库实验：把脏的"患者 / 就诊 / 检验"三张 CSV 与一份更正单，清洗入库成 SQLite 数据库（主键 + 外键），执行增删改查并用 SQL 统计，产出 output.json 与一张图。当用户要求"建检验数据库""用 SQL 统计 HbA1c 超标患者""按更正单修改数据"时使用。
---

# 检验数据入库与查询 Skill（参考实现 · 学习示范）

> 📖 这份实现**随题目包一起下发**（`problem/reference/`），是给你的**示范** —— 不是标准答案。
> 判据只看"清洗口径一致 + 更正真的落到库里 + 查询结果正确 + 说清设计"，所以
> 表名怎么起、DDL 怎么写、清洗代码怎么组织都随你；换一种写法只要口径一致就能通过。

## 能力边界

- 能处理：`patients.csv` / `visits.csv` / `labs.csv` + `corrections.json` 这套固定结构的输入
- 能处理：三种日期格式（`YYYY-MM-DD` / `YYYY/M/D` / `DD-MM-YYYY`）与常见的脏数据
  （首尾空白、空字段、重复行、非正数检验值、对不上的外键）
- 能处理：SQLite 建表（主键 + 外键 + `PRAGMA foreign_keys = ON`）、DELETE / UPDATE / INSERT
- 不处理：**单位换算**（同项目混用单位时会算错）、跨库迁移、并发与审计（谁在什么时候改了什么）
- 不处理：字段名/表结构与题干不同的输入（列名写死在 `CSV_HEADERS`）

## 方法（六步 —— 与 `task.md` 的流程一致）

1. **看清需求** —— 为什么要主外键：主键保证一行能被唯一指认，外键保证"不会留下查不到患者的报告"
2. **摸清数据** —— `profile_tables`：先数行数，再数脏在哪几类
3. **建库** —— `create_schema`：患者—就诊—检验三层，外键 + `PRAGMA foreign_keys = ON`
4. **清洗入库** —— `clean_table`（口径 1~6，**顺序不能反**）+ `insert_rows`
5. **增删改查** —— `apply_corrections`：DELETE / UPDATE / INSERT，并如实记录被外键拒绝的条数
6. **查询与结论** —— `run_queries`（三表 JOIN + GROUP BY + HAVING）+ 一张科室分布图 + `notes`

产出结构（`output.json`）见 `task.md`；判据见 `judge.md`。

## 实测档案

- 自测时间：
- 用例通过率：/2
- 关键数字：case01 入库 39/43/101、丢弃 19 无效 + 10 重复；case02 入库 53/58/127、丢弃 29 无效 + 12 重复
- 踩坑记录（pitfalls）：
  - `PRAGMA foreign_keys` 默认是**关**的 —— 忘了打开，那条引用不存在就诊的报告就会被悄悄收下
  - 清洗必须**先校验、再去重**，且按 patients → visits → labs 顺序；否则"孤儿报告"的数量会算错
  - 就诊行被丢弃时，挂在它下面的检验报告会**级联**变成孤儿 —— `loaded.labs` 比"原始行数减坏行数"少得多
