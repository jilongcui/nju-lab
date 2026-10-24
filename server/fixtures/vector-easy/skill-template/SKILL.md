# 按主诉找相似病例（学生起点）

> 这个目录是**你的方案**：`SKILL.md` 写"这个技能什么时候该用、不该用"，
> `report.md` 记录自测与踩坑。**代码里的 TODO 才是你要改的地方**（文档不用改）。

## 实验材料（都在题目包 `problem/` 里）

- `problem/task.md` —— 需求 + 向量化口径 + 排序规则 + 六步流程 + 交付格式
- `problem/cases/` —— case01 / case02 两份 `docs.csv` + `queries.csv` + `concepts.json`（各带 `expected.json`）
- `problem/judge.md` —— 语义判据
- `problem/reference/` —— 一份走完六步的示范

## 能力边界

> 这一节是技能说明书的一部分；**平台不检查这一节**，按实际情况补两句即可。

- 能处理：与 `docs.csv` 同结构的短文本（中文主诉），概念落在给定 8 维词表内
- 不处理：没有出现在词表/同义词表里的说法（会漏）、长文档、真实 embedding 模型、ANN 索引、多字段过滤
- 写死的假设：概念维度固定 8、同义词表固定、排序按「分数降序 + doc_id 升序」、只保留 > 0 的结果

## 六步流程

① 看清需求（口径与排序）→ ② 看一眼数据 → ③ 向量化 → ④ 算余弦取 Top-3 → ⑤ 三种查询对照 →
⑥ 写结论

材料配合：读 `problem/task.md` → 改 `scripts/solve.py` 里的 TODO → 两个 case 都跑 →
补能力边界（平台不检查）→ 提交；**实测记录写进 `report.md`**（平台按它评过程分）。

## 自测

```sh
python3 scripts/solve.py ../problem/cases/case01 ../case01/output.json --fig-dir figures/case01
python3 scripts/solve.py ../problem/cases/case02 ../case02/output.json --fig-dir figures/case02
```

> 实测记录（三条查询的 Top-K、分数、踩过的坑）写进同级的 `report.md`；这里只保留能力边界。
