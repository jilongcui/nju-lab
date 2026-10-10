# 包内说明（记忆系统实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、条目抽取 / 更新 / 遗忘 / 三种策略 / 检索五套口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两种规模（12 轮 / 16 轮），每个 case 有 `dialogue.csv` / `queries.csv` / `memory_config.json` 与 `expected.json` |
| `reference/` | **参考实现**（一份写完的方案）—— 先读后仿，不是标准答案 |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

## 本地自测（两个 case 都要跑）

把工作目录切到某一个 case，脚本把 `output.json` 与图写到当前目录：

```sh
mkdir -p /tmp/memory-run && cd /tmp/memory-run

# 用参考实现跑一遍（看看"对的"长什么样）
python3 <题目包>/reference/scripts/memory_assistant.py <题目包>/cases/case01 ./output.json

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/memory_assistant.py <题目包>/cases/case01 ./output.json
```

然后自己核对六件事（这就是判据的口径）：

1. **条目**：`n_entries`、每条 `[entry_id, category, time, importance, status, superseded_by]`、
   `entries_checksum` 与 `expected.json` 相同；
2. **窗口**：`window` 的 `turn_id` 序列、`window_entry_ids` 与 `expected.json` 一致；
3. **摘要**：`summary` 文本**逐字**一致、`summary_entry_ids` 一致；
4. **检索**：`retrieved` 里每题的 `entry_ids` 与 `expected.json` 一致；
5. **更新与遗忘**：`updates.applied` / `forgotten` / `before_after` 一致，
   且 `after` 里**不再出现**被更正的旧条目与被遗忘的条目；
6. **指标**：三个 `recall@k` 与 `expected.json` 一致（容差 1e-6）。

> `expected.json` 是**参考水平**不是标准答案：五套口径都钉死了，所以只要口径对，
> 这些值本来就该相同；口径错了就会不一样 —— 它同时是你自查"我哪一步理解偏了"的镜子。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| 条目数比预期多 | 把 `question`（助手提问）或 `chitchat`（闲聊）也算成了条目 | 只有 `kind ∈ {fact_statement, correction}` 的轮才产生条目 |
| `category` 与预期不同 | 判定顺序错了 | 必须**按 task.md 的 1→6 顺序命中即停**；`correction` 轮的兜底规则排在第 5 位 |
| `entries_checksum` 对不上 | 行序或末尾换行与口径不同 | 按 `entry_id` 升序、行格式 `entry_id\|category\|time\|importance\|status\|superseded_by\|fact`、行间 `\n`、末尾不加 |
| 旧条目在更新后还被命中 | 只"新增"了一条，没有把旧条目标成 `superseded` | 更新 = 旧条目**失效**（`status` + `superseded_by`），不是再写一条新的 |
| 被更正的条目出现在 `forgotten` 里 | 遗忘时没有排除已经 `superseded` 的条目 | 遗忘**只处理 `active`**；`superseded` 不再被顺带遗忘 |
| 窗口里列出了已被遗忘的条目 | `window_entry_ids` 没有按**最终状态**过滤 | 窗口"能提供的条目"= 这些轮产生、且**最终仍 `active`** 的条目 |
| 摘要里同类有两条 | 没有"每类只留 `(time, entry_id)` 最大的一条" | 这正是"摘要丢细节"的来源：同类只留最新的那一条 |
| 检索结果里有相似度 0 的条目 | 硬凑够了 `top_k` | 口径是**只保留相似度 > 0** 的条目；一个都不命中就返回空数组 |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标题/轴标签用英文，中文写在 `takeaway` / `notes` 里 |
