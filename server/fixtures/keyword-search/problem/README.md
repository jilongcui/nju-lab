# 包内说明（知识库 · 文本内容实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、索引/检索/基线/评估四套口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两种语料规模（12 篇 / 24 篇），每个 case 有 `corpus.csv` / `queries.csv` / `qrels.csv` 与 `expected.json` |
| `reference/` | **参考实现**（一份写完的方案）—— 先读后仿，不是标准答案 |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

## 本地自测（两个 case 都要跑）

把工作目录切到某一个 case，脚本把 `output.json` 与图写到当前目录：

```sh
mkdir -p /tmp/keyword-run && cd /tmp/keyword-run

# 用参考实现跑一遍（看看"对的"长什么样）
python3 <题目包>/reference/scripts/bm25_search.py <题目包>/cases/case01 ./output.json

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/bm25_search.py <题目包>/cases/case01 ./output.json
```

然后自己核对四件事（这就是判据的口径）：

1. **索引**：`index.vocab_size` 与 `index.postings_checksum` 与 `cases/<case>/expected.json` 相同；
2. **检索**：`retrieval` 里每个查询的 Top-3 名单与顺序与 `expected.json` 一致；
3. **基线**：`baseline[].top_ids` 与 `expected.json` 一致（口径是**原始计数、不归一化**）；
4. **指标**：`metrics` 里两个 `recall@3` 与 `by_type` 分组值与 `expected.json` 一致。

> `expected.json` 是**参考水平**不是标准答案：四套口径都钉死了，所以只要口径对，
> 这些数值本来就该相同；口径错了就会不一样 —— 它同时是你自查"我哪一步理解偏了"的镜子。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| `vocab_size` 比预期大 | 停用词没去干净，或切词时保留了单字符 | 口径 4 条：NFKC + 小写 → `[^a-z0-9]+` 切分 → 丢长度 < 2 → 丢停用词表里的词 |
| `postings_checksum` 对不上 | 行序或格式与口径不同 | 行格式 `词项|doc_id|词频`，词项升序、同词项内 doc_id 升序，行间 `\n`、**末尾不加换行**，取 sha256 前 12 位 |
| 某个查询的 Top-3 顺序与 `expected` 差一点 | 并列没有按 `doc_id` 升序 | 排序键是 `(-分数, doc_id)` |
| 基线分特别高、名单都是长文档 | 基线口径就是**不做长度归一化**（故意的） | 这正是要观察的现象；BM25 靠 `b` 与 `k1` 把短而精准的文档捞回来 |
| 中文语料跑不出结果 | 环境里没有中文分词器（也不联网装） | 本实验的语料是英文，口径按字母数字切词；换中文语料要先解决分词 |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标题/轴标签用英文，中文写在 `takeaway` / `notes` 里 |
