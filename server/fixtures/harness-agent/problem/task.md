# 应用实验：构建一个通用 agent（循环 / 记忆 / 工具 / 知识库）

> **流程归属**：本实验是**工程实现型**——按题目口径写一段确定性代码，用两个样例逐字段核对，
> **没有"定基线 → 训练 → 评估指标"这些环节**。

## 业务背景

平台有一个**通用 agent** 的骨架：它能循环、能记东西、能调工具、能查文档、能守边界，还能**调度 skill**。
这一章你要把它**自己实现一遍**（这样你才知道它内部在干什么），并且做到**换一批材料仍然能跑**。

所以题目给的两个样例来自**完全不同的领域**：

| 样例 | 领域 | 材料长什么样 |
|---|---|---|
| `case01` | 图书借阅 | 借阅记录表 + 借阅规则 + 两个 skill |
| `case02` | 设备维护 | 运行记录表 + 维护手册 + 两个 skill |

同一份 agent 要能在这两个领域上都跑通 —— 这就是"通用"的含义。
（**注意**：这一章不绑定任何业务；真正的业务应用是下一章的事。）

## 从这里开始（5 步，约 40 分钟出第一版）

| 步 | 做什么 | 你会拿到 |
|---|---|---|
| 1 | 本页「实验材料」下载题目包 | `task.md` + 两个样例 |
| 2 | 点「实验环境」，把 `scripts/harness.py` 里的 TODO 逐个填上（先填能跑通的最小版本） | 一份能跑的脚本 |
| 3 | 跑一个样例：`python3 scripts/harness.py <样例目录> output.json` | `output.json` |
| 4 | 按 `task.md` 逐条核对：每轮步数 / 工具错误码 / 记忆三态 / 检索 top3 / skill 路由 | 对齐后的结果 |
| 5 | 把结论与踩坑写进 `report.md`（模板在骨架里，六节照填） | 过程记录 |

## 时间不够时的最小路径（先让它跑通）

这一章要填 12 个函数，但**不必一次做完**：

1. **先让 `output.json` 出来**：只实现 `run_turn()`（循环 + 每步观测）与 `build_answer()`，其余返回占位；
2. **再补记忆**：`fact_pair()` → `apply_memory()` → `update_memory()`（更正/遗忘要真的生效）；
3. **再补工具与边界**：`validate_call()`、`mock_execute()`、`scan_safety()`；
4. **最后补检索与路由**：`bm25_rank()` / `tf_cosine_rank()` / `route_skill()`。

> 每补一块就跑一次样例，看 `output.json` 对应字段对不对 —— 比一次写完再 debug 省时间。

## 做完前自查（逐条打勾）

- [ ] 两个样例都能跑完，`harness.terminated` 每轮一条（`done` 或 `max_steps`）；
- [ ] `trace` 每步都有 `observation`（被拒绝的调用写成 `rejected:<原因>`）；
- [ ] 工具错误码分得开：未知工具 `-32601`，参数类 `-32602`；
- [ ] 记忆三态对得上：更正后旧条目进 `superseded`，忘掉的进 `forgotten`；
- [ ] 检索给出 `bm25_top3` 与 `cosine_top3`，并报出两者不同的轮次；
- [ ] 每轮的 `skill` 与样例一致（该用 `summary-report` / `maintenance` 的轮次没漏，闲聊轮次是 `null`）；
- [ ] 越界记录逐条升级、越权请求拒答（拒答轮不给引用）；
- [ ] `figures/` 里有一张图（标题轴标签用英文），`notes` 写了局限；
- [ ] `agent/profile.json` 写了名字/语气/签名（中性示例，可改成任意业务）；
- [ ] `report.md` 写了至少 1 条踩坑。

## 你的任务

实现一个**通用 agent**，下面是六件事（每一件都要真的发生）：

1. **循环（loop）**：按 `plan_stub.json` 每轮的决策序列逐步执行，每步都记 `observation`，
   尊重 `limits.json` 的 `max_steps`，并如实给出每轮的终止原因（`done` / `max_steps`）；
2. **记忆分层**：working（最近窗口）/ short（每轮一行摘要）/ long（条目表），
   能处理一次**更正**（旧的置 `superseded`）与一次**遗忘**（置 `forgotten`）；
3. **工具层（MCP 风格）**：按 `tools.json` 校验参数（四级 + 业务校验），
   非法请求如实记 `rejected` 并给对错误码，合法请求路由到本地 mock 给出写死格式的摘要；
3.5 **调度 Skill**：`skills/*/SKILL.md` 的 `triggers` 决定"这一轮该用哪个 skill"；
   **命中即停**（按 skill 名升序），**一个都不中就返回 `null`（不硬凑）**；
4. **知识库检索**：字符 2-gram + BM25 排序，并与 **TF 余弦对照**给出两者 top3 不同的轮次；
5. **安全边界**：异常记录逐条升级（固定话术）、越权请求拒答（不给引用）；
6. **答案与出处**：每轮一条答复，非拒答轮带一条 `kb` 出处。

## 一·五、调度 Skill 与 agent 定制

### ① 路由（每轮一次，先于 loop）

按 **skill 名字升序**逐个检查：该 skill 的任一 trigger 出现在用户文本里就选中它，**命中即停**；
一个都没中 → 该轮 `skill = null`。写进 `answers[].skill`，并统计 `metrics.skills_routed`。

> 为什么"没中不要硬凑"：选错 skill 会让后面全错；硬凑一个"最像的"比返回 `null` 更糟。

### ② agent 的定制（人格 / 风格）

平台已经有一个通用 agent；你要交付的是**你定制的那一份**。定制写在 `agent/profile.json`：

```json
{ "display_name": "我的助手", "tone": "简洁、先给结论再给依据",
  "signature": "—— 我的助手（通用示例，可改成任意业务）", "forbidden": ["下结论", "替人做决定"] }
```

`signature` 会**自动加到每轮答复末尾**（平台侧），`forbidden` 与安全边界呼应。

> **注意：agent 不是应用。** 应用的单位是 **Skill**（下一章做）。这一章交付的是：
> 一个能调度 skill 的通用 agent + 一份定制 + `output.json`。

## 二、循环（**口径钉死**）

`plan_stub.json` 的 `turns[].steps[]` 是"模型给出的决策序列"，元素形如
`{"action": "recall" | "tool" | "kb" | "finish"}`（`tool` 带 `call_id`）。

逐步执行，每步往 `trace` 追加 `{"turn", "step", "action", "observation"}`（`step` 从 1 起）：

| action | observation（**逐字**） |
|---|---|
| `recall` | `记忆命中：` + 逗号连接的本轮已应用条目 id；没有就 `记忆命中：-` |
| `tool` | 校验通过 → mock 摘要；不通过 → `rejected:` + `rejected_reason` |
| `kb` | `检索命中：` + 逗号连接的 `bm25_top3` |
| `finish` | `完成`，并结束本轮 |

**截断**：该轮 `steps` 长度 > `max_steps` 时只执行前 `max_steps` 步，本轮终止记 `max_steps`；
否则（走到 `finish`）记 `done`。`harness.terminated` 是**每轮一条**的数组。

## 三、工具层与记忆层（**口径钉死**）

### 3.1 参数校验（按顺序，命中即停）

| 序 | 条件 | 结论 |
|---|---|---|
| 1 | `tool` 不在名册 | `args_valid=false` / `error_code=-32601` / `rejected_reason="unknown_tool"` |
| 2 | `args` 不是对象 | `-32602` / `"invalid_args"` |
| 3 | 按声明顺序有必填缺失 | `-32602` / `"missing_required"` |
| 4 | 已给参数类型不符（`string`→字符串；`integer`→整数，布尔不算） | `-32602` / `"type_mismatch"` |
| 5 | **业务校验**：`flag_value` 的 `record_id` 不是异常记录 | `-32602` / `"not_out_of_range"` |
| 6 | 以上都不成立 | `args_valid=true` / `status="executed"` / `error_code=0` |

> 名册之外的多余参数忽略。非法项 `result_summary` 写 `""`。

### 3.2 mock 执行（只对合法项；摘要格式**逐字**）

| 工具 | 返回摘要 |
|---|---|
| `lookup_record` | `"{subject}/{item} 最近一次 {value} {unit}（{record_id}）"` —— 取该对象该项**最后出现**的一行 |
| `summarize_column` | `"{item} 均值 {round(均值, decimals)}"` —— `decimals` 缺省 0 |
| `fetch_doc` | `"{item} 的规则段落 {passage_id}"` —— 取正文含该项、`passage_id` 最小的 kb 文档；无则 `"{item} 的规则段落 无"` |
| `flag_value` | `"{record_id} 已登记待复核"` |

### 3.3 记忆（四操作 + 三层）

- **写入**：文本出现 `我老是搞混 <A> 和 <B>` → 条目 `{entry_id, fact, category:"weak_point", state:"active", importance:3}`；
- **更正**：`更正：我其实不搞混 <A> 和 <B> 了，是搞混 <A> 和 <C>` → 旧条目置 `superseded`，新建 `(A, C)`；
- **遗忘**：`忘掉 MEM<nn>` → 该条目置 `forgotten`（只处理 `active`）；
- **应用**：本轮文本**同时出现**某 active 条目的 `<A>` 与 `<B>` → 记 `{"turn","entry_id"}`；
  **含「更正：」的轮次不记应用**；
- **三层**：`working`（最近 `window` 条 `"T{turn}: {前 20 字}"`）、`short`
  （`"T{turn}: 步 {n} / 工具 {列表或 -} / 命中 {bm25_top3[0] 或 -}"`）、`long`（`active`/`superseded`/`forgotten`）。

## 四、知识库检索（**口径钉死**）

- 归一化：转小写、删掉非字母数字/汉字字符；
- 词项：字符 **2-gram**（长度 < 2 取单字）；
- **BM25**：`k1=1.5`、`b=0.75`；`idf = ln(1 + (N - df + 0.5)/(df + 0.5))`；
  `score = Σ idf·tf·(k1+1) / (tf + k1·(1 - b + b·dl/avgdl))`；
- **对照（TF 余弦）**：`cos = Σ q_t·d_t / (|q|·|d|)` —— 不做 idf、不做长度归一；
- 排序：分数降序，**分数（保留 9 位小数）相同**按 `passage_id` 升序；取前 `top_k`。

## 五、安全边界（**口径钉死**）

**① 异常 → 待复核**：对 `records.csv` 全部行扫一次，`value < low` 或 `value > high` 即为异常
（阈值取 `limits.json.thresholds[item]`，未声明的跳过）。按 `record_id` 升序给出：

```json
{ "record_id": "R02", "item": "机器学习", "value": 12, "message": "<limits.json 的 messages.warn 原文>" }
```

**② 越权请求 → 拒答**：文本含「**直接告诉我**」或「**你直接说**」时，本轮必须拒答：
`{ "turn": 4, "reason": "……（≥10 字，说清为什么不给结论）" }`，该轮 `citations` 为 `[]`。

## 六、答案与指标（**口径钉死**）

- `answers[]`：每轮 `{"turn", "skill", "answer", "citations"}`；非拒答轮 `answer` ≥10 字且含 `bm25_top3[0]`，
  `citations = [{"kind":"kb","ref": <bm25_top3[0]>}]`；拒答轮 `citations = []`；
- `metrics.top3_diff_turns`：BM25 与余弦 top3 不同的轮次（升序）；
- `metrics.tool_executed` / `tool_rejected` / `skills_routed`；
- `metrics.trace_checksum`：`trace` 投影成 `[[turn, step, action, observation], …]`，`sha256` 前 12 位。

## 数据字典

| 文件 | 列/键 | 含义 |
|---|---|---|
| `dialogue.jsonl` | `turn` / `user` | 每轮用户说的话 |
| `records.csv` | `record_id` / `subject` / `item` / `value` / `unit` | 记录表（工具的数据源，也是异常扫描对象） |
| `tools.json` | `tools[].name` / `parameters` | 工具名册 |
| `tool_calls.jsonl` | `call_id` / `turn` / `tool` / `args` | 待校验的调用（**里面有非法请求**） |
| `plan_stub.json` | `turns[].turn` / `steps[]` | 模型决策序列 |
| `limits.json` | `max_steps` / `window` / `top_k` / `thresholds` / `messages` | 限额与阈值 |
| `kb/*.md` | 文件名即 `passage_id` | 规则文档 |
| `skills/*/SKILL.md` | `name` / `description` / `triggers` | 可被调度的 skill（两个） |

> 数据是**虚构的教学数据**。

## 交付格式

```json
{
  "harness": { "turns": 7, "max_steps": 6, "steps_total": 23,
               "terminated": ["done", "done", "done", "done", "done", "done", "done"] },
  "trace": [ { "turn": 1, "step": 1, "action": "recall", "observation": "记忆命中：-" } ],
  "tool_calls": [ { "call_id": "C01", "tool": "lookup_record", "args_valid": true, "status": "executed",
                    "error_code": 0, "rejected_reason": "", "result_summary": "张伟/数据库系统 最近一次 3 次（R01）" } ],
  "memory": { "working": ["…"], "short": ["…"],
              "long": { "active": [], "superseded": [], "forgotten": [] }, "applied": [] },
  "retrieval": [ { "turn": 1, "bm25_top3": ["…"], "cosine_top3": ["…"] } ],
  "answers": [ { "turn": 6, "skill": "summary-report", "answer": "…（≥10 字）",
                 "citations": [ { "kind": "kb", "ref": "KB-01" } ] } ],
  "safety": { "escalations": [ { "record_id": "R02", "item": "机器学习", "value": 12, "message": "<固定话术>" } ],
              "refusals": [ { "turn": 4, "reason": "……（≥10 字）" } ] },
  "metrics": { "top3_diff_turns": [1, 2, 3], "tool_executed": 4, "tool_rejected": 4,
               "skills_routed": 1, "trace_checksum": "…（12 位）" },
  "figures": [ { "path": "figures/harness_overview.png", "takeaway": "…" } ],
  "notes": "…（≥60 字：每个部件为什么这么做、至少两条局限）"
}
```

## 名词速查

| 词 | 一句话 |
|---|---|
| agent | 通用运行时：循环 / 记忆 / 工具 / 知识库 / 边界 / 调度 skill |
| skill | 一段具体业务能力（`SKILL.md` + `scripts/api.py`），由 agent 按 `triggers` 路由 |
| trace | 每一步做了什么、看到了什么 |
| 终止原因 | `done`（正常收尾）/ `max_steps`（到每轮上限被截断） |
| 记忆三态 | `active` / `superseded`（被更正）/ `forgotten`（被遗忘） |
| 错误码 | `-32601` 未知工具 / `-32602` 参数类 |
| 对照做法 | 用来证明"我的做法更好"的朴素做法（这里是 TF 余弦） |
