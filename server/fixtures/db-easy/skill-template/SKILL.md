# 血压随访记录查询（学生起点）

> 这个目录是**你的方案**：`SKILL.md` 写"这个技能什么时候该用、不该用"，
> `report.md` 记录自测与踩坑。**代码里的 TODO 才是你要改的地方**（文档不用改）。

## 实验材料（都在题目包 `problem/` 里）

- `problem/task.md` —— 需求 + 四条查询口径 + 六步流程 + 交付格式
- `problem/cases/` —— case01（20 行）/ case02（24 行）两份 `visits.csv`，各带 `expected.json`
- `problem/judge.md` —— 语义判据
- `problem/reference/` —— 一份走完六步的示范

## 能力边界

> 这一节是技能说明书的一部分；**平台不检查这一节**，按实际情况补两句即可。

- 能处理：与 `visits.csv` 同结构的**单表**随访记录（6 列，含 `systolic` / `diastolic`）
- 不处理：多表关联（JOIN）、外键约束、脏数据清洗、事务回滚 —— 那些是中等档实验的内容
- 写死的假设：表名 `visits`、列名与顺序固定；科室取值就是那四个

## 六步流程

① 看清需求（四条查询的排序口径）→ ② 看一眼数据 → ③ 建表 + 导入 → ④ 写 SQL → ⑤ 与 `expected.json` 核对 →
⑥ 写结论

材料配合：读 `problem/task.md` → 改 `scripts/solve.py` 里的 TODO → 两个 case 都跑 →
补能力边界（平台不检查）→ 提交；**实测记录写进 `report.md`**（平台按它评过程分）。

## 自测

```sh
python3 scripts/solve.py ../problem/cases/case01 ../case01/output.json --fig-dir figures/case01
python3 scripts/solve.py ../problem/cases/case02 ../case02/output.json --fig-dir figures/case02
```

> 实测记录（四条查询的结果、错误分布、踩过的坑）写进同级的 `report.md`；这里只保留能力边界。
