# 应用任务：给随访助手装上一层"记得住、找得到、改得掉、忘得了"的记忆

## 业务背景

第 16 章讲记忆系统：**分层**（工作 / 短期 / 长期 / 情景 / 程序）与**四大操作**
（写入 Store、检索 Retrieve、更新 Update、遗忘 Forget）。大模型本身是无状态的 ——
它之所以能"记得你上周说过对青霉素过敏"，全靠外面这一层把事实**存下来、按需取出来**。

但"存下来"远不是全部。真实随访里最难的三件事是：

1. **该取哪些**：上下文窗口有限，把所有历史都塞进去既贵又吵 —— 于是有了不同的组织策略：
   只留最近几轮（**窗口**）、把历史压成一段（**摘要**）、按当前提问去取相关条目（**检索**）；
2. **说错了要改**：患者上个月说在吃二甲双胍，这个月改成达格列净 ——
   如果只是"再写一条新的"，旧条目还会被检索命中，助手就会一直按旧药回答；
3. **该忘要忘**：不是所有信息都该长期留存（数据最小化 / 留存期限），
   但遗忘是有代价的：**被遗忘的信息，任何一次检索都再也拿不回来**。

本实验给你一段**多次随访对话**与一组**后续提问**，你要把上面三件事都做出来，并且**用指标说清代价**。

## 你的任务

用工作目录里的 `dialogue.csv`（对话）、`queries.csv`（提问 + 人工标注的"该用到哪些记忆条目"）、
`memory_config.json`（患者号与各项阈值）产出一份 `output.json` 与一张图。具体要求：

1. **写入**：按钉死的规则把对话沉淀成**记忆条目**，报出条目数与一个**逐字节可比的校验和**；
2. **更新**：处理对话里的**更正**，让旧条目**失效**（`superseded`）并新增条目；
3. **遗忘**：按重要性 / 时效阈值把该丢的标成 `forgotten`；
4. **三种上下文策略**：窗口 / 摘要 / 检索各算一遍 `recall@k`，并给出每个提问**用了哪些条目**；
5. **对照 before / after**：把"更新与遗忘**之前**"和"**之后**"的检索结果并列报出来 ——
   这是"更新真的生效、遗忘真的丢信息"的证据；
6. **用图说清取舍**：把三种策略的 `recall@k` 画成一张柱状图；
7. **说清取舍与风险**：`notes` 要讲清三种策略各解决什么、遗忘的代价与合规意义、
   以及"**错误记忆 = 错误病史**"这条风险。

> 代码怎么组织、函数怎么切都随你（**纯标准库**就够：`csv` / `json` / `math` / `hashlib` /
> `collections` / `unicodedata`；画图用已预装的 `matplotlib`）。
> 判据看的是：**口径一致 + 更新/遗忘真的生效 + 说得清取舍**。

## 实验流程（六步，每一步都要走完）

| 步 | 做什么 | 产出/落点 |
|---|---|---|
| ① **看清需求** | 随访助手要"记得住、找得到、改得掉、忘得了"，四件事分别难在哪 | 心里有数（写进 `notes`） |
| ② **看懂口径** | 条目格式、category 判定顺序、重要性、更新/遗忘阈值、检索口径 —— **都不许改** | 心里有数 |
| ③ **写入** | 哪些轮产生条目、怎么编号、状态怎么标 | 报告的 `memory.entries` / `entries_checksum` |
| ④ **更新与遗忘** | 处理更正（旧条目失效）与按阈值丢弃 | 报告的 `updates` |
| ⑤ **三种策略 + 检索** | 窗口 / 摘要 / 检索各算 `recall@k`，并算 before/after | `memory` / `metrics` / `updates.before_after` / `figures` |
| ⑥ **写结论** | 三种策略各解决什么、遗忘的代价、错误记忆的风险 | 报告的 `notes` |

> 图用 `matplotlib`（已预装）画，存到工作目录的 `figures/` 下，例如
> `plt.savefig("figures/strategy_recall.png", dpi=110)`。
> ⚠️ **图上的标题与坐标轴标签必须用英文**：运行环境里没有中文字体，中文会渲染成方框。
> 中文解释写在 `figures[].takeaway` 与 `notes` 里。

## 一、记忆条目的抽取口径（**钉死**）

**① 哪些轮产生条目**：只有 `kind` 为 `fact_statement` **或** `correction` 的轮才产生条目；
`question`（助手提问）与 `chitchat`（闲聊）**不产生**条目。

**② 编号**：把产生条目的轮按 `(date, turn_id)` **升序**排列，依次编号 `M01`、`M02`…（两位数）。

**③ 条目字段**：

| 字段 | 口径 |
|---|---|
| `entry_id` | `M01`…（见上） |
| `patient_id` | 来自 `memory_config.json` |
| `fact` | 该轮 `text` 的**原文**（去掉首尾空白），**不做改写、不做摘要** |
| `category` | 按下面第 ④ 条判定 |
| `time` | 该轮的 `date`（原样，`YYYY-MM-DD`） |
| `importance` | 由 `category` 决定：`allergy` 3 / `medication_change` 3 / `lab_result` 2 / 其余 1 |
| `status` | 起初都是 `active`；更新后可为 `superseded`；遗忘后可为 `forgotten` |
| `superseded_by` | 起初为空串 `""`；被更正后填**本轮新条目**的 `entry_id` |

**④ `category` 判定（按顺序，命中即停）**：

| 序 | 条件 | 结果 |
|---|---|---|
| 1 | `fact` 里出现「过敏」 | `allergy` |
| 2 | 出现「停用」「换用」「改为」「加用」之一 | `medication_change` |
| 3 | 出现「血糖」「血压」「化验」「检验」「肌酐」「血红蛋白」「脂蛋白」之一 | `lab_result` |
| 4 | 出现「抽烟」「戒烟」「饮酒」「喝酒」「白酒」「戒了」「散步」「运动」「游泳」「饮食」之一 | `lifestyle` |
| 5 | 该轮 `kind == "correction"`（前四条都没命中） | `medication_change` |
| 6 | 以上都不满足 | `other` |

**⑤ `entries_checksum`**（口径钉死，逐字节可复现）：把**全部条目**按 `entry_id` **升序**，
每行按下面的格式拼：

```
entry_id|category|time|importance|status|superseded_by|fact
```

行与行之间用 `\n` 连接、**末尾不加换行**；UTF-8 编码后取 sha256 十六进制字符串的**前 12 位**。

## 二、更新口径（**钉死**）

按 `(date, turn_id)` 升序处理 `kind == "correction"` 的轮，依次编号 `U01`、`U02`…

一条更正轮的 `text` 形如 `更正：<旧说法> → <新说法>`：

1. 去掉前缀「更正：」，再按 `→` 切成 `<旧说法>`（左）与 `<新说法>`（右），两边**去首尾空白**；
2. 找到**所有**满足下列条件的条目：`status == "active"`、`time` **早于**本轮的 `date`、
   且 `fact` 里**包含** `<旧说法>`；
3. 把这些条目标成 `status = "superseded"`、`superseded_by = <本轮新条目的 entry_id>`；
4. 记录这次更新：`{"update_id": "U01", "old_entry_ids": [被更正的 id（升序）], "new_entry_id": ...}`。

> 注意：新条目在**步骤一**就已经生成好了（更正轮本身会产生条目），这里只是把它"挂"上去。

## 三、遗忘口径（**钉死**）

**在所有更新应用之后**，把满足下列**全部**条件的条目标成 `status = "forgotten"`：

- `status == "active"`（**只处理 active** —— 已经被更正成 `superseded` 的条目**不会**被顺带遗忘）；
- `importance <= memory_config.forget_importance_max`；
- `time < memory_config.forget_before`（字符串比较，`YYYY-MM-DD` 格式）。

`updates.forgotten` = 被遗忘的 `entry_id`（**升序**数组）。

## 四、三种上下文策略与检索口径（**钉死**）

顺序**钉死**：先抽条目 → 再更新 → 再遗忘 → 最后在**最终 `active` 的条目上**做这三种策略。
（提示：一条被更正的旧条目，以及一条被遗忘的条目，**都不在最终池子里** —— 任何策略都取不到它。）

**① 窗口（window）**：把对话按 `(date, turn_id)` 升序排列，取**最后 `window_size` 轮**
（`window_size` 在 `memory_config.json` 里）。`memory.window` 报这些轮的 `turn_id`（**时间正序**）；
`memory.window_entry_ids` 报这些轮产生的条目里**最终仍 `active`** 的那些 `entry_id`（升序）。

**② 摘要（summary）**：对最终 `active` 的条目按 `category` 聚合，**每个 category 只保留
`(time, entry_id)` 最大的那一条**，再按 category 的**字符串升序**（ASCII）拼成：

```
category: fact；category: fact
```

（`": "` 是冒号加一个空格；**用中文分号 `；` 连接**；末尾**不加**任何标点。）
`memory.summary` 就是这个字符串；`memory.summary_entry_ids` 是保留下来的条目 id（升序）。

**③ 检索（retrieval）**：对每个提问，在最终 `active` 的条目上算**字符 2-gram 余弦相似度**，
取相似度最高的 `top_k` 条（`top_k` 在配置里）：

- 文本处理口径：NFKC + 转小写后，**只保留字母与数字**（`str.isalnum()` 为真；标点与空格全删），
  相邻两个字符算一个 2-gram（长度为 n 的串有 n-1 个 2-gram，按位置计数）；
- 相似度 = 两个 2-gram 计数向量的余弦（`Σ count_q·count_e / (‖q‖·‖e‖)`）；
- **只保留相似度 > 0 的条目**（一个都不命中就返回空数组）；
- 并列时按 `entry_id` **升序**；不足 `top_k` 就返回实际条数。

**④ 指标**：`queries.csv` 的 `relevant_entry_ids` 列（`;` 分隔）是人工标注的"回答这个问题**应该用到**的条目"。
三个指标都按下面的方式算，最后**对全部提问取平均**（保留 6 位小数）：

```
recall@k(单个提问) = |该策略能提供的条目 ∩ relevant| / |relevant|
```

- `metrics.recall_at_k_window`：该策略能提供的条目 = `window_entry_ids`；
- `metrics.recall_at_k_summary`：= `summary_entry_ids`；
- `metrics.recall_at_k_retrieval`：= 该提问检索命中的 `entry_ids`。

## 五、before / after 口径（**钉死**）

`updates.before_after` 每一个提问一项：`{"query_id", "before", "after"}`

- `after` = 最终状态（更新 + 遗忘之后）该提问检索命中的 `entry_ids`（与 `memory.retrieved` 一致）；
- `before` = 同样的检索，但跑在**只做完步骤一（抽取）时**的条目池上（即全部条目都是 `active`）。

> 这两列就是判据要看的"行为性差异"：更新后旧条目从 `after` 里消失、新条目出现；
> 遗忘后原本在 `before` 里能取到的条目在 `after` 里再也取不到。

## 数据字典

| 文件 | 列/键 | 含义 |
|---|---|---|
| `dialogue.csv` | `turn_id` / `date` / `role` / `kind` / `text` | 随访对话；`kind` ∈ `fact_statement`（自述事实）/ `correction`（更正）/ `question`（助手提问）/ `chitchat`（闲聊） |
| `queries.csv` | `query_id` / `query` / `relevant_entry_ids` | 后续提问 + 人工标注"该用到哪些条目"（`;` 分隔） |
| `memory_config.json` | `patient_id` | 患者号 |
| | `window_size` / `top_k` | 窗口只留几轮 / 检索取前几条 |
| | `forget_importance_max` / `forget_before` | 遗忘阈值（`importance <=` 这个值 且 `time <` 这个日期） |

> 数据是**虚构的教学数据**（中文，没有真实患者，也不是真实随访记录）。

## 交付格式

**`output.json`**（写在工作目录下；**键名与层级按下面的样例写**）：

```json
{
  "memory": {
    "n_entries": 7,
    "entries_checksum": "5eab37f8b88a",
    "entries": [
      { "entry_id": "M01", "patient_id": "P-001", "fact": "我两年前查出对青霉素过敏，打针后起过疹子。",
        "category": "allergy", "time": "2025-11-03", "importance": 3, "status": "active", "superseded_by": "" }
    ],
    "window": ["T09", "T10", "T11", "T12"],
    "window_entry_ids": ["M07"],
    "summary": "allergy: ……；lab_result: ……；medication_change: ……",
    "summary_entry_ids": ["M01", "M05", "M07"],
    "retrieved": [ { "query_id": "Q01", "entry_ids": ["M01"] } ]
  },
  "answers": [
    { "query_id": "Q01", "answer": "……（≥10 字；只依据检索到的记忆条目，不下诊断结论）", "used_entry_ids": ["M01"] }
  ],
  "updates": {
    "applied": [ { "update_id": "U01", "old_entry_ids": ["M03"], "new_entry_id": "M07" } ],
    "forgotten": ["M02", "M06"],
    "before_after": [ { "query_id": "Q02", "before": ["M07", "M03"], "after": ["M07"] } ]
  },
  "metrics": { "recall_at_k_window": 0.3, "recall_at_k_summary": 0.7, "recall_at_k_retrieval": 0.8 },
  "figures": [ { "path": "figures/strategy_recall.png", "takeaway": "……（一句话结论，数字要与 metrics 自洽）" } ],
  "notes": "……（≥60 字：三种策略各解决什么、遗忘的代价与合规意义、错误记忆 = 错误病史）"
}
```

- `memory.entries` 按 `entry_id` 升序；`retrieved` / `before_after` / `answers` 按 `query_id` 升序；
- `answers[].used_entry_ids` = 该提问在 `memory.retrieved` 里的 `entry_ids`（原样，**升序**）；
- 图至少 1 张：`path` + 一句 `takeaway`（结论要"看图说话"，并与 `metrics` 自洽）；
- 报告里的数值**不需要**和任何人一致 —— 只要口径对，它们**本来就该相同**；口径错了就会不一样。

## 怎么算完成

1. 写一个能跑的方案（推荐做成 Skill 里的一段脚本），能对任意一份同结构的三份文件产出
   `output.json` 与一张图；
2. 在 `cases/case01` 与 `cases/case02`（不同规模：12 轮 / 16 轮）上都能跑通 —— 判据对两个 case 各判一次；
3. 把结论与踩过的坑写进 `SKILL.md` 的「实测档案」。

判据全文见 `judge.md`；怎么自测、包内还有什么，见 `README.md`。
