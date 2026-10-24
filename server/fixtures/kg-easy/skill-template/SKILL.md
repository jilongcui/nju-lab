# 用药预警（知识图谱 · 学生起点）

> 这个目录是**你的方案**：`SKILL.md` 写"这个技能什么时候该用、不该用"，
> `report.md` 记录自测与踩坑。**代码里的 TODO 才是你要改的地方**（文档不用改）。

## 实验材料（都在题目包 `problem/` 里）

- `problem/task.md` —— 需求 + 两条两跳查询的口径 + 路径格式 + 六步流程
- `problem/cases/` —— case01 / case02 两份 `triples.csv`（各 18 条），各带 `expected.json`
- `problem/judge.md` —— 语义判据
- `problem/reference/` —— 一份走完六步的示范

## 能力边界

> 这一节是技能说明书的一部分；**平台不检查这一节**，按实际情况补两句即可。

- 能处理：与 `triples.csv` 同结构的知识图谱（head / relation / tail），患者节点以 `P` 开头
- 不处理：三跳及以上推理、本体校验（实体/关系类型合法性）、实体消歧（"阿司匹林"="乙酰水杨酸"）、
  大规模图上的索引优化 —— 那些是中等档《用药安全审查》的内容
- 写死的假设：关系名固定那 8 个、风险取"不良反应"字典序第一条、按患者/药名排序

## 六步流程

① 看清需求（两条查询与 path 格式）→ ② 看一眼数据（哪些是知识、哪些是患者事实）→
③ 建图 → ④ 两条两跳查询 → ⑤ 与 `expected.json` 核对 + 画图 → ⑥ 写结论

材料配合：读 `problem/task.md` → 改 `scripts/solve.py` 里的 TODO → 两个 case 都跑 →
补能力边界（平台不检查）→ 提交；**实测记录写进 `report.md`**（平台按它评过程分）。

## 自测

```sh
python3 scripts/solve.py ../problem/cases/case01 ../case01/output.json --fig-dir figures/case01
python3 scripts/solve.py ../problem/cases/case02 ../case02/output.json --fig-dir figures/case02
```

> 实测记录（两条查询各命中几条、路径长什么样、踩过的坑）写进同级的 `report.md`。
