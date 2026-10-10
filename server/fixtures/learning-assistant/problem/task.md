# 综合实践（收官）：搭一个"分子医学学习助手"的最小闭环

## 业务背景

这是本课程的**收官实验**。第 19 章给了一个项目目标与一套架构：

> 读学生的实验数据 → 规划并执行分析 → 检索文献 → **生成实验报告** → **记住学生的进度与薄弱点**

章里把它拆成四个模块（感知 / 大脑 / 行动 / 记忆）和三阶段实施路径。真实工程里，阶段二会用到
`mem0` 这类记忆服务、MCP 工具、LangChain-LangGraph 编排 —— 但**本实验环境没有外网、镜像里也没有这些库**，
所以本实验用**本地等价物**：本地记忆条目表 + 本地 mock 工具 + 自己的编排脚本。

> ⚠️ **本题不给参考实现**。前 18 章你做过实验包、Skill、检索、记忆、工具调用、安全边界 ——
> 这一章要看的是**你能不能自己把它们组装起来**。给的是**需求 + 数据 + 交付契约**，
> 怎么实现（函数怎么分、用什么数据结构、报告怎么成文）完全由你决定。

## 你的任务

用工作目录里的六份文件，产出 `output.json` 与一张图。**下面五件事必须真的发生**（不是加分项）：

1. **一次记忆读写（跨轮）**：从提问里把学生的**薄弱点**记成一条记忆，并在**后面的提问**里用上它；
2. **一次工具调用（带校验）**：按 `tools.json` 的 schema 校验 `tool_calls.csv` 里的每个请求，
   合法的路由到本地 mock 执行并给出结果摘要，**不合法的如实记为 rejected 并写出理由**；
3. **一次技能流程**：按 `report_template.json` 生成"目的 / 方法 / 结果 / 讨论"四节报告；
4. **一次检索 + 出处**：越界读数逐行引用到**行号级**、解释引用到**段落级**，格式钉死；
5. **一次安全边界**：越界读数**升级**（不是照答）+ 固定话术；要求"直接下诊断"的提问**拒答**。

## 实验流程（六步，每一步都要走完）

| 步 | 做什么 | 产出/落点 |
|---|---|---|
| ① **看清需求** | 五件事分别对应第 16 / 17 / 18 章的哪一套本事？各自难在哪 | 心里有数（写进 `notes`） |
| ② **摸清材料** | 六份文件怎么对上（提问、数据行、段落、工具名册、待执行调用、模板与阈值） | 心里有数 |
| ③ **搭最小闭环** | 记忆（写入 + 应用）、工具（校验 + 路由 + mock）、报告（四节）、引用、安全 | 代码里的这几段 |
| ④ **逐环跑通** | 每一环单独跑一遍：记忆条目对不对、调用结论对不对、四节齐不齐、引用格式对不对 | 报告的四个部分 |
| ⑤ **汇总与画图** | 把各指标均值与越界行数画一张图 | `figures` |
| ⑥ **写结论** | 每一环**为什么这么做**、哪里是"检索结果"而不是"结论"、局限有哪些 | `notes` |

> 图用 `matplotlib`（已预装）画，存到工作目录的 `figures/` 下，例如
> `plt.savefig("figures/item_overview.png", dpi=110)`。
> ⚠️ **图上的标题与坐标轴标签必须用英文/ASCII**：运行环境里没有中文字体，中文会渲染成方框。
> 本实验的指标名是中文，所以图上的标签请用 `item 1` / `item 2` … 这类**编号**，
> 并在 `figures[].takeaway` 里用中文写清「编号 → 指标名」的对应关系。

## 一、记忆：写入与应用（**口径钉死**）

**① 写入**：逐条查看 `questions.csv` 的 `question`（按 `q_id` 升序），若文本里出现**固定句式**
`我老是搞混 <A> 和 <B>`，就写一条记忆条目：

```json
{ "entry_id": "MEM01", "fact": "老是搞混 <A> 和 <B>", "category": "weak_point" }
```

- `<A>` / `<B>` 的切法：`老是搞混` 与 `和` 之间的部分为 `<A>`；`和` 之后到下一个标点
  （`，。！？、,` 或空白）之前为 `<B>`；
- `entry_id` 按命中顺序编号 `MEM01`、`MEM02`…；
- `fact` 的写法**固定**：`老是搞混 ` + `<A>` + ` 和 ` + `<B>`（`老是搞混`后一个空格、`和`前后各一个空格）。

**② 应用**：对**写入该条记忆的那一轮之后**的每一个提问（即 `q_id` 顺序在后），若提问文本里
**同时出现** `<A>` 与 `<B>`，就记一次应用：`{"question_id": "…", "entry_id": "MEM…"}`。
（第一个提出薄弱点的提问本身**不算**应用。）

## 二、工具调用：校验 + 路由 + mock 执行（**口径钉死**）

`tools.json` 是工具名册（每个工具给出参数名、类型、是否必填）；`tool_calls.csv` 是**待执行**的请求
（`call_id`、`tool`、`args` 是一个 JSON 字符串）。

**① 校验**（按下面的顺序，**命中即停**）：

| 序 | 条件 | 结论 |
|---|---|---|
| 1 | `tool` 不在名册里 | `args_valid=false`，`rejected_reason="unknown_tool"` |
| 2 | `args` 不是合法 JSON **或**不是一个对象 | `false`，`"invalid_args"` |
| 3 | 按名册里参数**声明的顺序**，有必填参数缺失 | `false`，`"missing_required"` |
| 4 | 某个参数的类型与声明不符（`string` 要字符串；`integer` 只要**整数**，布尔不算） | `false`，`"type_mismatch"` |
| 5 | 以上都不成立 | `true`，`status="executed"` |

> **名册之外的多余参数一律忽略**（不报错）。`args_valid=true` 的项 `rejected_reason` 写**空字符串**。

**② mock 执行**（只有 `args_valid=true` 才执行；返回摘要的格式**写死**）：

| 工具 | 返回摘要 |
|---|---|
| `mean_of_column` | `"{column} 均值 {round(均值, decimals)}"` —— `decimals` 缺省为 `0`；均值取该 `item` 全部 `value` 的算术平均 |
| `plot_histogram` | `"{column} 直方图 bins={bins}"` |
| `fetch_reference` | `"{item} 的参考段落 {passage_id}"` —— 取 `passages.csv` 里 `item` 匹配、`passage_id` **最小**的那条 |

（摘要里的数字用 Python `round()` 默认的字符串形式，例如 `9.0`、`111.5`。）

## 三、报告：按模板成文（**口径钉死**）

`report_template.json` 给了 `sections`（名称 + 每节最小字数）。报告必须**按这个顺序**给出这四节，
每节的 `content` 长度不低于对应的 `min_chars`。正文怎么写随你，但要真的建立在前面的结果上。

## 四、出处：行级 + 段级（**口径钉死**）

**① 先找出越界读数**：对 `experiment_data.csv` 的每一行，取 `report_template.json` 的
`thresholds[该行 item]`；若 `value < low` 或 `value > high`，这一行就是**越界行**。

**② 引用格式**：

- data 引用：`{"kind": "data", "ref": "experiment_data.csv:<row_id>"}` —— **每个越界行一条**；
- passage 引用：`{"kind": "passage", "ref": "passages.csv:<passage_id>"}` ——
  把越界行的 `item` **去重**后按字符串升序（ASCII）排列，每个 item 取它在 `passages.csv` 里
  `passage_id` **最小**的那条；
- 顺序**钉死**：先给出全部 data 引用（按 `row_id` 升序），再给出全部 passage 引用（按上面的 item 顺序）。

## 五、安全边界（**口径钉死**）

**① 升级（escalation）**：每个越界行一条：

```json
{ "row_id": "R02", "item": "…", "value": 18, "message": "<report_template.json 的 messages.warn 原文>" }
```

`message` 必须是模板里的固定话术，**一字不改**；`value` 是该行的数值（数字）。

**② 拒答（refusal）**：提问文本里出现「**直接告诉我**」或「**你直接说**」任一措辞时，该提问必须被拒答：

```json
{ "question_id": "Q03", "reason": "……（≥10 字，说清为什么不给诊断结论）" }
```

> 这两条不是"格式要求"：越界读数可能是**测错**的，助手没有资格替人做判断；
> 诊断结论必须由医师结合完整病史与检查作出。

## 数据字典

| 文件 | 列/键 | 含义 |
|---|---|---|
| `questions.csv` | `q_id` / `question` | 学生的提问（含薄弱点自述、要求下诊断的那一题） |
| `experiment_data.csv` | `row_id` / `item` / `value` / `unit` | 学生的实验读数（行级引用的对象） |
| `passages.csv` | `passage_id` / `item` / `source` / `text` | 教材/规范段落（段级引用的对象） |
| `tools.json` | `tools[].name` / `description` / `parameters` | 本地 mock 工具名册（参数名 / 类型 / 是否必填） |
| `tool_calls.csv` | `call_id` / `tool` / `args` | 待执行的调用（`args` 是 JSON 字符串；**里面有非法调用**） |
| `report_template.json` | `sections` / `thresholds` / `messages` | 报告模板、警戒线、固定话术 |

> 数据是**虚构的教学数据**（没有真实患者，也不是真实实验记录）。

## 交付格式

**`output.json`**（写在工作目录下；**键名与层级按下面的样例写**）：

```json
{
  "report": {
    "template_used": "report_template.json",
    "sections": [ { "name": "目的", "content": "……（≥ 模板的 min_chars）" } ]
  },
  "tool_calls": [
    { "call_id": "C01", "tool": "mean_of_column", "args_valid": true, "status": "executed",
      "rejected_reason": "", "result_summary": "血小板计数 均值 111.5" }
  ],
  "memory": {
    "written": [ { "entry_id": "MEM01", "fact": "老是搞混 白细胞计数 和 血小板计数", "category": "weak_point" } ],
    "applied": [ { "question_id": "Q02", "entry_id": "MEM01" } ]
  },
  "citations": [
    { "kind": "data", "ref": "experiment_data.csv:R02" },
    { "kind": "passage", "ref": "passages.csv:P-02" }
  ],
  "safety": {
    "refusals": [ { "question_id": "Q03", "reason": "……（≥10 字）" } ],
    "escalations": [ { "row_id": "R02", "item": "血小板计数", "value": 18, "message": "<固定话术>" } ]
  },
  "key_facts": {
    "n_warn_rows": 2, "warn_row_ids": ["R02", "R06"],
    "n_call_executed": 4, "n_call_rejected": 2,
    "weak_point": "白细胞计数/血小板计数"
  },
  "figures": [ { "path": "figures/item_overview.png", "takeaway": "……（一句话结论；含「编号 → 指标名」的对应）" } ],
  "notes": "……（≥60 字：每一环为什么这么做、"检索结果 ≠ 结论"、至少两条局限）"
}
```

- `key_facts.weak_point` 的格式**钉死**：`"<A>/<B>"`（例如 `白细胞计数/血小板计数`）；
- `report.sections[].name` 必须与模板一致、顺序一致；
- `citations` 顺序**钉死**（先 data 后 passage，各自的排序规则见上）；
- 图至少 1 张：`path` + 一句 `takeaway`；
- 报告里的数值**不需要**和任何人一致 —— 只要口径对，它们**本来就该相同**；口径错了就会不一样。

## 怎么算完成

1. 写一个能跑的方案（推荐做成 Skill 里的一段脚本），能对任意一份同结构的六份文件产出
   `output.json` 与一张图；
2. 在 `cases/case01` 与 `cases/case02`（不同指标与规模）上都能跑通 —— 判据对两个 case 各判一次；
3. 把结论与踩过的坑写进 `SKILL.md` 的「实测档案」。

> **本题不给参考实现**，所以"卡住"是正常的。可以回头翻你做过的实验：
> 第 16 章的"本地条目表 + 自己实现的检索"、第 18 章的"确定性任务下沉给脚本 + 安全边界落成字段"、
> 第 5 / 9 章的"口径钉死 + 逐字段可比" —— 这一题就是把它们**再拼一次**。

判据全文见 `judge.md`；怎么自测、包内还有什么，见 `README.md`。
