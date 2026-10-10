# 包内说明（向量数据库实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、向量化/检索/对照/增删改查口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两批数据（不同规模、不同维度），每个 case 有 `corpus.csv` / `queries.csv` / `concepts.json` / `updates.json` 与 `expected.json` |
| `reference/` | **参考实现**（一份写完的方案）—— 先读后仿，不是标准答案 |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

## 本地自测（两个 case 都要跑）

```sh
mkdir -p /tmp/vec-run && cd /tmp/vec-run

# 用参考实现跑一遍（看看"对的"长什么样）
python3 <题目包>/reference/scripts/search.py <题目包>/cases/case01 ./output.json

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/search.py <题目包>/cases/case01 ./output.json
```

然后自己核对三件事（这就是判据的口径）：

1. **向量化**：`index.dim` 等于 `concepts.json` 的 `dim`，`index.n_docs` 等于语料条数；
2. **检索**：`retrieval` 里每条查询的 Top-3 名单与 `cases/<case>/expected.json` 的 `retrieval[].top_ids` 一致
   （关键词对照同理看 `keyword_baseline`）；
3. **对照**：`metrics.recall_at_3_vector` 明显高于 `recall_at_3_keyword`。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| 改写查询的 Top-3 和 expected 不一致 | 向量化口径没照做 | 子串计数（不是分词）、累加**该概念全部同义词**、逐维计数后 **L2 归一化** |
| 关键词检索也命中了改写查询 | 场景词/标点干扰，或 2-gram 没有**去重** | 口径是"查询的 2-gram **去重集合**"，文档得分 = 这些 gram 在文档里的**总次数** |
| 给了 3 条但每条查询都返回 3 条 | 口径是**只返回分数 > 0** 的结果 | 没命中的查询返回空列表（`unrelated` 查询就应该是空的） |
| 改写后检索结果没变 | 改了文本但没**重算向量** | `update_docs` 之后必须重新 embed 那一条 |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标题/轴标签用英文，中文写在 `takeaway` / `notes` 里 |
