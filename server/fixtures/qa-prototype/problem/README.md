# 包内说明（综合实践实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、**路由口径**、各形态实现口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两种语料规模（4 条试验 / 5 段段落，5 条试验 / 7 段段落），每个 case 有七份数据文件与 `expected.json` |
| `reference/` | **参考实现**（一份写完的方案）—— 先读后仿，不是标准答案 |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

## 本地自测（两个 case 都要跑）

把工作目录切到某一个 case，脚本把 `output.json` 与图写到当前目录：

```sh
mkdir -p /tmp/qa-run && cd /tmp/qa-run

# 用参考实现跑一遍（看看"对的"长什么样）
python3 <题目包>/reference/scripts/qa_ask.py <题目包>/cases/case01 ./output.json

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/qa_ask.py <题目包>/cases/case01 ./output.json
```

然后自己核对四件事（这就是判据的口径）：

1. **路由**：每题 `route` 与 `expected.json` 一致（两跳组合题的主路 + `sources` 里的第二条路）；
2. **关键事实**：每题 `key_facts` 与 `expected.json` 一致（这是答案对不对的核心）；
3. **出处**：`sources` 的 `kind` 组合一致、`ref` 非空、Q04 的 `path` 与 `expected.json` 完全相同；
4. **分布**：`route_counts` 一致，四种形态都至少用上一次。

> `expected.json` 是**参考水平**不是标准答案：路由与各实现口径都钉死了，所以只要做法对，
> 这些值本来就该相同；错了就会不一样 —— 它同时是你自查"哪一题走错了路"的镜子。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| Q01 取到 `T-105`（II 期那条） | 只按药名查，没有按**分期**筛 | 题意要的是 **III 期**试验；同药可能有多个试验 |
| Q02 找到好几段 | 术语没取全 | 要的是**同时**字面出现「PARP」「BRCA」「卵巢癌」三个概念的那一段 |
| Q03 找不到 P-03 | 用关键词的"字面共现"去找了 | 这一题要按**相似度**找：字符 2-gram 余弦最高的一段 |
| Q04 的 `path` 与 `expected` 不完全相同 | BFS 的邻接顺序或路径格式不对 | 路径写成 `head\|relation\|tail` 的链；同长度多条时取**边序列 ASCII 升序最小**的那条 |
| Q05 只报了一部分 | 漏了第二跳 | 这题要"图谱取适应证 + SQL 取试验数据"，`sources` 里两条都要有 |
| `edges.csv` 的边被当成无向 | 没注意方向 | 边表是 `head,relation,tail` **有向**三元组 |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标题/轴标签用英文，中文写在 `takeaway` / `notes` 里 |
