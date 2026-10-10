# 包内说明（知识图谱实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、建图/预警/更新口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两批数据（不同规模），每个 case 有 `triples.csv` / `ontology.json` / `updates.json` 与 `expected.json` |
| `reference/` | **参考实现**（一份写完的方案）—— 先读后仿，不是标准答案 |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

## 本地自测（两个 case 都要跑）

```sh
mkdir -p /tmp/kg-run && cd /tmp/kg-run

# 用参考实现跑一遍（看看"对的"长什么样）
python3 <题目包>/reference/scripts/kg.py <题目包>/cases/case01 ./output.json

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/kg.py <题目包>/cases/case01 ./output.json
```

然后自己核对四件事（这就是判据的口径）：

1. **图**：`graph` 的节点/边数与类型统计和 `expected.json` 一致；
2. **预警**：`alerts_before` / `alerts_after` 的两类清单**连同路径**都与 expected 一致；
3. **更新**：`crud` 的各项条数一致，且 `rejected_updates` 为 1（那条违反本体的更新必须被拒绝）；
4. **变化**：`alerts_after` 与 `alerts_before` 不同 —— 撤销的医嘱让禁忌证预警减少、补录的患者带来新预警。

## 常见问题

| 现象 | 原因 | 怎么做 |
| --- | --- | --- |
| 预警条数比 expected 多 | 关系名没区分 | "在用药"要同时认 `服用` 与 `医嘱使用`；相互作用是**双向**的，两个方向都要查 |
| `rejected_updates` 是 0 | 本体校验没做，或校验写成了"只检查关系名存在" | 校验要比对**端点类型**：`entity_types[head] == schema.from` 且 `entity_types[tail] == schema.to` |
| 路径与 expected 不一致 | 三元组顺序写反了 | 按 `task.md` 表里的顺序抄：禁忌证是 `患者→疾病 / 药物→疾病 / 患者→药物` |
| 更新后预警没变 | 更新直接改了图对象却拿旧数据算 | 更新之后**重新**跑一遍预警查询 |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标题/轴标签用英文，中文写在 `takeaway` / `notes` 里 |
