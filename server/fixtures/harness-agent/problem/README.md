# 包内说明（应用实验 · 给随访助手写一个 harness）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、六个部件的口径（循环 / 工具 / 记忆 / 检索 / 安全 / 答案）、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两套输入（七份材料）+ `expected.json`（自测用） |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

> ⚠️ **本实验不给参考实现**。这是第 19 章的**迁移检验** —— 考察你能不能在只有"需求 + 数据 +
> 交付契约"的情况下，把前面几章学过的本事**自己组装**起来：
> 第 16 章的记忆条目表与更新/遗忘、第 17 章的 MCP 报文与参数校验、第 5 章的倒排/BM25 检索与对照、
> 第 18 章的"确定性任务下沉给脚本 + 安全边界落成字段"。卡住时请回头翻你做过的实验。

## 本地自测（两个 case 都要跑）

```sh
mkdir -p /tmp/harness-run && cd /tmp/harness-run

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/harness.py <题目包>/cases/case01 ./output.json
```

然后自己核对八件事（这就是判据的口径）：

1. **循环**：`trace` 的 `[turn, step, action, observation]` 与 `expected.json` 逐步一致；
   `harness.terminated` 是**每轮一条**（`done` / `max_steps`）—— case02 有一轮会被截断；
2. **工具**：每条 `[call_id, tool, args_valid, status, error_code, rejected_reason, result_summary]` 一致
   （注意：**里面有未知工具、缺必填、类型错、以及"对正常读数要求升级"这四种失败**）；
3. **记忆三层**：`working` / `short` / `long` 都在；`long` 的三态与条目 `[entry_id, fact, state]` 一致；
4. **记忆应用**：`memory.applied` 的 `[turn, entry_id]` 一致（**含「更正：」的那一轮不算应用**）；
5. **检索**：每轮的 `bm25_top3` 与 `cosine_top3` 一致，`metrics.top3_diff_turns` 一致；
6. **安全**：`safety.escalations` 的 `[record_id, item, value, message]` 一致（`message` 与
   `limits.json` 的固定话术**逐字相同**）、`safety.refusals` 的轮次一致；
7. **图**：至少 1 张，`takeaway` 与 `metrics` 自洽（图上的标签用英文）；
8. **`notes`**：讲清每个部件为什么这么做、BM25 与对照差在哪、至少两条局限。

> `expected.json` 是**参考水平**不是标准答案（它由教师侧的解答样例算出，不随包下发）：
> 口径钉死的部分只要做对就该完全相同；口径错了就会不一样 —— 它同时是你自查"我哪一步理解偏了"的镜子。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| 每轮都记成 `max_steps` | 把"每轮步数上限"当成了"总步数上限" | `max_steps` 是**每轮**的上限；只有 `steps` 长度超过它的那一轮才记 `max_steps` |
| 非法调用被我"跳过"了 | 只记录了成功的调用 | 口径是**每条都要出现在 `tool_calls` 里**，非法的记 `args_valid=false` / `status="rejected"` + 非空理由 |
| 错误码全写 `-32602` | 没区分"未知工具" | 名册里没有的工具是 `-32601`（方法不存在），参数类问题才是 `-32602` |
| 对正常读数也"升级成功"了 | 漏了业务校验 | `escalate_value` 只接受**越界**记录，否则记 `not_out_of_range` |
| 更正之后旧条目还在 `active` | 只写不管状态 | 更正要把 `(A, B)` 那条置 `superseded`，遗忘要置 `forgotten`；`active` 里不该再有它们 |
| `bm25_top3` 与 `cosine_top3` 永远一样 | 两套都用了同一份实现 | 对照是**故意不同**的：余弦不做 idf、不做长度归一，会被长综述带走 |
| `answers` 里没带出处 | 只写了自然语言 | 非拒答轮 `answer` 必须含 `bm25_top3[0]`，`citations` 给一条 `{"kind":"kb","ref":…}` |
