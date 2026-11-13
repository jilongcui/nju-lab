# 应用实验：给随访助手写一个 harness

> **流程归属（给引导用的提示）**：本实验是**工程实现型**——按题目口径写一段确定性代码，
> 用题目包里的 case 逐字段核对，**没有"定基线 → 训练 → 评估指标"这些环节**。
> 六步见下面「实验流程」，第 3 步是"按口径搭六个部件"，第 5 步是"边界用例自测"。

## 从这里开始（5 步，约 40 分钟出第一版）

> 这一章**不给参考实现**，但口径写得很细。先跑通一个样例，再逐条对齐字段。

| 步 | 做什么 | 你会拿到 |
|---|---|---|
| 1 | 本页「实验材料」下载题目包 | `task.md` + 两个样例数据集 |
| 2 | 点「实验环境」，把 `scripts/harness.py` 里的 TODO 逐个填上（先填能跑通的最小版本） | 一份能跑的脚本 |
| 3 | 跑一个样例：`python3 scripts/harness.py <样例目录> output.json` | `output.json` |
| 4 | 按 `task.md` 逐条核对：每轮步数 / 工具错误码 / 记忆三态 / 检索 top3 | 对齐后的结果 |
| 5 | 把结论与踩坑写进 `report.md`（工具会帮你整理格式） | 过程记录 |

## 时间不够时的最小路径（先让它跑通）

这一章要填 12 个函数，但**不必一次做完**。按"先跑通、再对齐"走，卡住的风险会小很多：

1. **先让 `output.json` 出来**：只实现 `run_turn()`（循环，每步写 `observation`）与
   `build_answer()`（答复 + 出处），其余函数先返回占位值（空列表 / 空字符串）；
2. **再补记忆**：`fact_pair()` → `apply_memory()` → `update_memory()`，
   让"更正/遗忘"真的生效（这是本章最容易考到、也最容易漏的一块）；
3. **再补工具与边界**：`validate_call()`（四级校验 + 业务校验）、`mock_execute()`、`scan_safety()`；
4. **最后补检索**：`bm25_rank()` 与 `tf_cosine_rank()`（口径在 §四，公式照抄即可）。

> 每补一块就跑一次样例，看 `output.json` 里对应的字段对不对 —— 比一次写完再 debug 省时间得多。
> 时间充裕再追求"逐字对齐"（`记忆命中：-` 的连字符、`解析 …：N 行` 的括号都算）。

## 做完前自查（逐条打勾）

- [ ] 两个样例都能跑完，`harness.terminated` 每轮一条（`done` 或 `max_steps`）；
- [ ] `trace` 每步都有 `observation`（包括被拒绝的调用写成 `rejected:<原因>`）；
- [ ] 工具错误码分得开：未知工具 `-32601`，参数类 `-32602`；
- [ ] 记忆三态对得上：更正后旧条目进 `superseded`，忘掉的进 `forgotten`；
- [ ] 检索给出 `bm25_top3` 与 `cosine_top3`，并报出两者不同的轮次；
- [ ] 每轮的 `skill` 与样例一致（该用 `lab-report` / `followup` 的轮次没漏，闲聊轮次是 `null`）；
- [ ] `agent/api.py` 写完，能在平台「用我的 Skill 创建应用」发布出来；
- [ ] 越界行逐条升级、诊断式提问拒答（拒答轮不给引用）；
- [ ] `figures/` 里有一张图（标题轴标签用英文），`notes` 写了局限；
- [ ] `report.md` 写了至少 1 条踩坑。

## 业务背景

社区卫生站想在内部试一个**随访助手**：护士说一句话，它自己去查检验记录、查指南段落、
必要时把越界读数升级、把「这个病人是不是感染了」这类问题挡回去。

真正难的不是"接一个大模型"，而是**包在模型外面的那一层脚手架（harness）**：

- 模型可能一次给出好几步计划 → **谁负责一步步执行、谁负责记下每步看到了什么**？
- 同一段对话越聊越长 → **哪些留在窗口里、哪些压成摘要、哪些进可检索的长期条目表**？
- 模型要求调用工具 → **参数不对该不该执行？失败了报什么错误码？**
- 指南有几十页 → **凭什么把某一段排第一，怎么证明这个排序比"朴素做法"好？**
- 读出 18 这种数 → **什么时候该升级给人、什么时候必须拒答？**

这一章你就在做这一层。它和模型**解耦**：题目给你一份 `plan_stub.json` 当作"模型的决策"，
你写的 harness 要把它变成**可执行、可核对、可解释**的循环。

> 提示：这是第 19 章从"四环闭环"升级后的版本 —— 前一版只要求"一次记忆读写 + 一次工具调用"，
> 这一版要求你**自己实现循环与分层**：`trace` 要逐步可比，记忆要真的分三层并处理更新与遗忘，
> 工具要按 MCP 风格给错误码，检索要给出与对照做法的差异。

## 你的任务

用工作目录里的七份材料，产出 `output.json` 与一张图。**下面六件事必须真的发生**（不是加分项）：

1. **循环（loop）**：按 `plan_stub.json` 每轮的决策序列逐步执行，每步都记 `observation`，
   尊重 `limits.json` 的 `max_steps`，并如实给出每轮的终止原因（`done` / `max_steps`）；
2. **记忆分层**：working（最近窗口）/ short（每轮一行摘要）/ long（条目表），
   并能处理一次**更正**（旧的置 `superseded`）与一次**遗忘**（置 `forgotten`）；
3. **工具层（MCP 风格）**：按 `tools.json` 校验参数（四级 + 一级业务校验），
   非法请求如实记 `rejected` 并给对错误码，合法请求路由到本地 mock 给出写死格式的摘要；
3.5 **调度 Skill**：材料里的 `skills/*/SKILL.md` 给了两个 skill（`lab-report` / `followup`）的 `triggers`。
   每轮先决定**该不该用某个 skill**：命中就调用它的 `scripts/api.py`；**一个都不中就返回 `null`（不硬凑）**；
4. **知识库检索**：字符 2-gram + BM25 排序，并与 **TF 余弦对照**给出两者 top3 不同的轮次；
5. **安全边界**：越界读数逐行升级（固定话术）、要求下诊断的提问拒答（不给引用）；
6. **答案与出处**：每轮一条 `answer`，非拒答轮带一条 `kb` 出处。

## 实验流程（六步，每一步都要走完）

| 步 | 做什么 | 产出/落点 |
|---|---|---|
| ① **看清需求** | 六个部件各解决什么问题？循环、记忆、工具、检索、边界分别难在哪 | 心里有数（写进 `notes`） |
| ② **摸清材料** | 七份材料怎么对上：对话 / 记录 / 名册 / 待执行调用 / 决策序列 / 限额 / 知识库 | 心里有数 |
| ③ **搭六个部件** | 检索、记忆、工具校验、循环、安全、答案拼装 | 代码里的六段 |
| ④ **逐轮核对** | 每轮的 `trace` 步数对不对、记忆应用对不对、工具结论对不对、出处对不对 | `output.json` |
| ⑤ **边界自测** | 被截断的那一轮、被遗忘的条目、对正常读数要求升级、要求下诊断的提问 | `harness.terminated` / `memory.long` / `safety` |
| ⑥ **写结论** | 每个部件为什么这么做、BM25 与对照差在哪、至少两条局限 | `notes` |

> 图用 `matplotlib`（已预装）画，存到工作目录的 `figures/` 下，例如
> `plt.savefig("figures/harness_overview.png", dpi=110)`。
> ⚠️ **图上的标题与坐标轴标签必须用英文/ASCII**：运行环境里没有中文字体，中文会渲染成方框。

## 一、材料与每轮处理顺序（**顺序钉死**）

每轮（`dialogue.jsonl` 的一行，`turn` 从 1 连续编号）都按下面这个顺序处理：

| 序 | 做什么 | 依据 |
|---|---|---|
| 1 | **检索**：对 user 文本算 BM25 与 TF 余弦，各取 top3 | §四 |
| 2 | **记忆应用**：用**进入本轮之前**的 active 条目判断 | §三 |
| 3 | **loop**：按 `plan_stub.json` 该轮的 `steps` 执行，最多 `max_steps` 步 | §二 |
| 4 | **记忆更新**：遗忘 → 更正 → 写入 | §三 |
| 5 | **安全边界**：拒答判定（拒答轮的 `citations` 为空） | §五 |
| 6 | **答案**：拼 `answer` 与 `citations` | §六 |
| 7 | **记忆三层收尾**：working 追加并按 `window` 截断、short 追加一行 | §三 |

## 一·五、调度 Skill 与发布成应用

### ① 路由（每轮一次，先于 loop）

`skills/lab-report/SKILL.md` 与 `skills/followup/SKILL.md` 各有 `triggers`（逗号分隔）。
每轮按 **skill 名字升序**逐个检查：该 skill 的任一 trigger 出现在用户文本里就选中它，**命中即停**；
一个都没中 → 该轮 `skill = null`。

写进 `answers[].skill`（`null` 表示这轮没用到 skill），并统计 `metrics.skills_routed`。

> 为什么"没中不要硬凑"：选错 skill 会让后面全错（工具、口径都不对），
> 而硬凑一个"最像的"比返回 `null` 更糟 —— 用户会以为你懂。

### ② 发布成应用（平台能力，你不写前端）

工作区里的 `agent/api.py` 是**平台入口**：把 `scripts/harness.py` 的部件（校验 / 检索 / 越界扫描）
接到平台的请求上（附件由平台解析、知识库由平台传、诊断式提问由平台兜底）。

写完后提交，到平台「我的应用」点「**用我的 Skill 创建应用**」——
平台自动装包、起容器、发布，给你一个分享链接（别人不登录也能打开）。

所以这一章的交付不止是 `output.json`，还有**一个能打开的应用**。

## 二、循环（**口径钉死**）

`plan_stub.json` 的 `turns[].steps[]` 就是"模型给出的决策序列"，每个元素是
`{"action": "recall" | "tool" | "kb" | "finish"}`，`action="tool"` 时另有 `call_id`。

逐步执行，每步往 `trace` 追加一条 `{"turn", "step", "action", "observation"}`（`step` 从 1 起）：

| action | observation 的写法（**逐字**） |
|---|---|
| `recall` | `记忆命中：` + 逗号连接的**本轮已应用条目 id**；一个都没有就写 `记忆命中：-` |
| `tool` | 校验通过 → mock 执行摘要（见 §三）；不通过 → `rejected:` + `rejected_reason` |
| `kb` | `检索命中：` + 逗号连接的 `bm25_top3` |
| `finish` | `完成`，并**结束本轮** |

**截断口径**：该轮 `steps` 长度 > `max_steps` 时，只执行前 `max_steps` 步，
本轮终止原因记 `max_steps`；否则（走到 `finish`）记 `done`。
`harness.terminated` 是**每轮一条**的数组；`harness.steps_total` = `trace` 的长度。

## 三、工具层与记忆层（**口径钉死**）

### 3.1 参数校验（按顺序，命中即停）

| 序 | 条件 | 结论 |
|---|---|---|
| 1 | `tool` 不在 `tools.json` 名册里 | `args_valid=false` / `error_code=-32601` / `rejected_reason="unknown_tool"` |
| 2 | `args` 不是 JSON 对象 | `-32602` / `"invalid_args"` |
| 3 | 按**声明顺序**有必填参数缺失 | `-32602` / `"missing_required"` |
| 4 | 按声明顺序，已给参数的类型与声明不符（`string`→字符串；`integer`→**整数**，布尔不算） | `-32602` / `"type_mismatch"` |
| 5 | **业务校验**：`escalate_value` 的 `record_id` 不在越界集合里 | `-32602` / `"not_out_of_range"` |
| 6 | 以上都不成立 | `args_valid=true` / `status="executed"` / `error_code=0` / `rejected_reason=""` |

> 名册之外的多余参数一律忽略（不报错）。非法项的 `result_summary` 写 `""`。

### 3.2 mock 执行（只有 `args_valid=true` 才执行；摘要格式**逐字**）

| 工具 | 返回摘要 |
|---|---|
| `lookup_record` | `"{patient_id}/{item} 最近一次 {value} {unit}（{record_id}）"` —— 取该患者该指标在 `records.csv` 中**最后出现**的一行 |
| `summarize_metric` | `"{item} 均值 {round(均值, decimals)}"` —— `decimals` 缺省 `0`，均值取该指标全部记录 |
| `fetch_guideline` | `"{item} 的指南段落 {passage_id}"` —— 取正文含该指标名、且 `passage_id` **最小**的 kb 文档；一个都没有写 `"{item} 的指南段落 无"` |
| `escalate_value` | `"{record_id} 已登记升级"` |

> 数值的字符串形式用 Python `round()` 的默认形式（例如 `119.0`、`7.2`）；
> `{value}` 用**最短数值形式**（`18` 而不是 `18.0`）。

### 3.3 记忆（四操作 + 三层）

**写入**：user 文本出现固定句式 `我老是搞混 <A> 和 <B>` 时写入一条：

```json
{ "entry_id": "MEM01", "fact": "老是搞混 <A> 和 <B>", "category": "weak_point",
  "state": "active", "importance": 3 }
```

`entry_id` 按创建顺序从 `MEM01` 起编；`fact` 写法**固定**（`老是搞混` 后一个空格、`和` 前后各一个空格）。

**更正**：user 文本出现 `更正：我其实不搞混 <A> 和 <B> 了，是搞混 <A> 和 <C>` 时，
把与该 `(A, B)` 相同的 **active** 条目置 `superseded`，再新建一条 `(A, C)` 的条目。

**遗忘**：user 文本出现 `忘掉 MEM<nn>` 时，把该条目（只处理 `active`）置 `forgotten`。

**应用**：本轮文本**同时出现**某条 `active` 条目的 `<A>` 与 `<B>` → 记 `{"turn", "entry_id"}`；
**含「更正：」的轮次不记应用**（那一轮在做纠正，不是在用记忆）。

**三层输出**：

| 层 | 内容 |
|---|---|
| `working` | 每轮追加 `"T{turn}: {user 前 20 个字符}"`，只保留最近 `window` 条 |
| `short` | 每轮追加 `"T{turn}: 步 {本轮 trace 步数} / 工具 {成功执行过的工具名，逗号连接；没有写 -} / 命中 {bm25_top3[0]；没有写 -}"` |
| `long` | `{"active": [...], "superseded": [...], "forgotten": [...]}`，条目字段见上 |

## 四、知识库检索（**口径钉死**）

- **归一化**：转小写，删掉所有非字母数字/汉字的字符；
- **词项**：字符 **2-gram**（归一化后长度 < 2 时取单字）；
- **BM25**：`k1=1.5`、`b=0.75`；`idf = ln(1 + (N - df + 0.5) / (df + 0.5))`；
  `score = Σ idf · tf·(k1+1) / (tf + k1·(1 - b + b·dl/avgdl))`（`N` 文档数、`df` 含该 gram 的文档数、
  `dl` 该文档 gram 数、`avgdl` 平均文档长度）；
- **对照（TF 余弦）**：`cos = Σ q_t·d_t / (|q|·|d|)` —— **不做 idf、不做长度归一**；
- **排序**：分数降序；**分数（保留 9 位小数）相同**时按 `passage_id` 升序；各取前 `top_k`（在 `limits.json`）。

> 对照不是装饰：`kb/` 里的文档长度差别很大，TF 余弦会被长综述带走，BM25 不会。
> 你要在 `metrics.top3_diff_turns` 里报出**两者 top3 不同的轮次**（升序）。

## 五、安全边界（**口径钉死**）

**① 越界 → 升级**：对 `records.csv` 的**全部行**扫一次，`value < low` 或 `value > high` 即为越界
（阈值取 `limits.json.thresholds[item]`，未声明的指标跳过）。按 `record_id` 升序给出：

```json
{ "record_id": "R02", "item": "血小板计数", "value": 18, "message": "<limits.json 的 messages.warn 原文>" }
```

`message` **一字不改**；`value` 用最短数值形式。

**② 要求下诊断 → 拒答**：user 文本含「**直接告诉我**」或「**你直接说**」时，本轮必须拒答：

```json
{ "turn": 4, "reason": "……（≥10 字，说清为什么不给诊断结论）" }
```

拒答轮 `citations` 为 `[]`，`answer` ≥10 字。

> 越界读数可能是**测错**的，助手没有资格替人判断；诊断结论必须由医师结合完整病史与检查作出。

## 六、答案与指标（**口径钉死**）

- `answers[]`：每轮一条 `{"turn", "answer", "citations"}`；非拒答轮 `answer` ≥10 字且**含该轮 `bm25_top3[0]`**，
  `citations = [{"kind": "kb", "ref": <bm25_top3[0]>}]`；拒答轮 `citations = []`；
- `metrics.top3_diff_turns`：BM25 与余弦 top3 不同的轮次（升序）；
- `metrics.tool_executed` / `tool_rejected`：按 `args_valid` 计数；
- `metrics.trace_checksum`：把 `trace` 投影成 `[[turn, step, action, observation], …]`，
  用 `json.dumps(..., ensure_ascii=False)` 序列化后取 `sha256` 的**前 12 位十六进制**。

## 数据字典

| 文件 | 列/键 | 含义 |
|---|---|---|
| `dialogue.jsonl` | `turn` / `user` | 每轮护士说的话 |
| `records.csv` | `record_id` / `patient_id` / `item` / `value` / `unit` | 检验记录（工具的数据源，也是越界扫描对象） |
| `tools.json` | `tools[].name` / `description` / `parameters` | 工具名册（参数名 / 类型 / 是否必填） |
| `tool_calls.jsonl` | `call_id` / `turn` / `tool` / `args` | 待校验的调用（**里面有非法请求**） |
| `plan_stub.json` | `turns[].turn` / `turns[].steps[]` | **模型决策序列**（`action` 四种） |
| `limits.json` | `max_steps` / `window` / `top_k` / `thresholds` / `messages` | 限额、参考区间、固定话术 |
| `kb/*.md` | 文件名即 `passage_id` | 指南段落（`KB-01`…） |

> 数据是**虚构的教学数据**（没有真实患者，也不是真实检验记录）。

## 交付格式

**`output.json`**（写在工作目录下；**键名与层级按下面的样例写**）：

```json
{
  "harness": { "turns": 5, "max_steps": 6, "steps_total": 23,
               "terminated": ["done", "done", "done", "done", "done"] },
  "trace": [ { "turn": 1, "step": 1, "action": "recall", "observation": "记忆命中：-" } ],
  "tool_calls": [
    { "call_id": "C01", "tool": "lookup_record", "args_valid": true, "status": "executed",
      "error_code": 0, "rejected_reason": "", "result_summary": "P001/血小板计数 最近一次 18 10^9/L（R02）" }
  ],
  "memory": {
    "working": ["T5: ……"],
    "short": ["T1: 步 5 / 工具 lookup_record,summarize_metric / 命中 KB-01"],
    "long": {
      "active": [ { "entry_id": "MEM02", "fact": "老是搞混 糖化血红蛋白 和 血红蛋白",
                    "category": "weak_point", "state": "active", "importance": 3 } ],
      "superseded": [], "forgotten": []
    },
    "applied": [ { "turn": 3, "entry_id": "MEM01" } ]
  },
  "retrieval": [ { "turn": 1, "bm25_top3": ["KB-01", "KB-05", "KB-02"],
                   "cosine_top3": ["KB-01", "KB-05", "KB-03"] } ],
  "answers": [ { "turn": 1, "answer": "……（≥10 字，含 bm25_top3[0]）",
                 "citations": [ { "kind": "kb", "ref": "KB-01" } ] } ],
  "safety": {
    "escalations": [ { "record_id": "R02", "item": "血小板计数", "value": 18, "message": "<固定话术>" } ],
    "refusals": [ { "turn": 4, "reason": "……（≥10 字）" } ]
  },
  "metrics": { "top3_diff_turns": [1, 2, 3, 4], "tool_executed": 4, "tool_rejected": 4,
               "trace_checksum": "106c1be2c1b6" },
  "figures": [ { "path": "figures/harness_overview.png", "takeaway": "……（一句话结论）" } ],
  "notes": "……（≥60 字：每个部件为什么这么做、BM25 与对照差在哪、至少两条局限）"
}
```

- `trace` 的顺序就是执行顺序；`harness.terminated` 与 `dialogue.jsonl` 的轮次**一一对应**；
- `tool_calls` 覆盖 `tool_calls.jsonl` 的**每一条**（含没被决策序列引用的）；
- 图至少 1 张：`path` + 一句 `takeaway`；
- 报告里的数值**不需要**和任何人一致 —— 只要口径对，它们**本来就该相同**；口径错了就会不一样。

## 怎么算完成

1. 写一个能跑的方案（推荐做成 Skill 里的一段脚本），能对任意一份同结构的七份材料产出
   `output.json` 与一张图；
2. 在 `cases/case01` 与 `cases/case02`（不同规模、不同限额）上都能跑通 —— 判据对两个 case 各判一次；
3. 把结论与踩过的坑记下来 —— 写进 `report.md`（模板在骨架里，六节照填），**不需要改 `SKILL.md`**。

判据全文见 `judge.md`；怎么自测、包内还有什么，见 `README.md`。

## 名词速查

| 词 | 一句话 |
|---|---|
| harness | 包在模型外面的脚手架（循环 / 记忆 / 工具 / 检索 / 边界） |
| trace | 每一步做了什么、看到了什么 |
| 终止原因 | `done`（正常收尾）/ `max_steps`（到每轮上限被截断） |
| 记忆三态 | `active` / `superseded`（被更正）/ `forgotten`（被遗忘） |
| 错误码 | `-32601` 未知工具 / `-32602` 参数类问题 |
| 对照做法 | 用来证明"我的做法更好"的朴素做法（这里是 TF 余弦） |
