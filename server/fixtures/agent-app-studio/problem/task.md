# 综合实践：把 harness 做成一个可分享的智能体应用

> **流程归属（给引导用的提示）**：本实验是**工程实现型 + 交付型**——按题目口径写一段确定性代码，
> 用题目包里的 case 逐字段核对，**没有"定基线 → 训练 → 评估指标"这些环节**。
> 六步见下面「实验流程」：第 3 步是"搭 core + 改前端"，第 5 步是"边界与分享自测"。

## 业务背景

第 19 章你已经写过一个 harness：循环、记忆分层、工具校验、检索、安全边界。
但**"能跑通"和"能交付"是两件事**。真到科室里，护士不会去命令行跑你的脚本，她要的是：

> 打开一个页面 → 拖进来一份 PDF / Word / 照片 → 说一句"整理成报告" → 拿到一份**能复核**的报告。

这一章就把这件事做完。你要交付的不是"一个脚本"，而是**一个小应用**：

- **core**（`harness/api.py`）：把附件解析成结构化数据，按口径生成报告，守住安全边界；
- **前端**（`web/`）：零依赖静态页面 —— 对话、上传、报告预览、换配色（**背景/主题要能改**）；
- **元信息**（`app.json`）：标题、场景、入口、主题、支持的附件类型、可见性；
- **发布**：应用上传到平台后**能生成分享链接**，由任课教师管理（预览、看对话、下架）。

平台侧的应用运行容器、分享与教师管理由平台提供；**你的 workspace 里要能自己跑起来**。

> ⚠️ **前端为什么要"零依赖"**：实验环境没有外网，`npm install` 装不了任何东西。
> 所以前端只能是纯 HTML / CSS / JS —— 老师给的模板就是这种形态，你在上面改。

## 你的任务

用工作目录里的材料，产出 `output.json`、一张图，以及一个改过的 `web/`。**下面六件事必须真的发生**：

1. **附件解析**：PDF / Word / 图片三类都要处理（**不许装第三方库**，环境里也没有）；
2. **口径钉死的报告**：四节（目的 / 方法 / 结果 / 讨论）+ 指标表（item / value / unit / flag）；
3. **记忆真的改变输出**：用户说"报告只列异常指标"要记住；说"忘掉 MEM01"要忘掉 —— 报告行集随之变化；
4. **安全边界**：超出参考区间的行逐条升级、要求下诊断的提问拒答（拒答轮不给引用）；
5. **前端改过**：模板是起点不是答案，主题/结构/交互至少改到能看出是**你的**应用；
6. **可发布**：`app.json` 的标题/场景/入口/主题/附件类型/可见性都填好。

## 实验流程（六步，每一步都要走完）

| 步 | 做什么 | 产出/落点 |
|---|---|---|
| ① **看清需求** | 谁会用这个应用？她给什么、要拿到什么？哪一步最容易错 | 心里有数（写进 `notes`） |
| ② **摸清材料** | 三个附件各是怎么存的（PDF 内容流 / DOCX 的 zip + XML / PNG 头）、报告模板给了什么 | 心里有数 |
| ③ **搭 core + 改前端** | 解析 → 报告 → 记忆 → 安全；前端换主题、加自己的区块 | `harness/api.py` / `web/` |
| ④ **逐轮核对** | 每轮 trace 步数、指标表行、flag、报告四节、出处 | `output.json` |
| ⑤ **边界与分享自测** | 被截断的那一轮、忘掉偏好之后的行集、诊断式提问、`web_sha256` | `harness` / `report` / `safety` / `app` |
| ⑥ **写结论** | 为什么自己解附件、偏好记忆改变了什么、局限在哪 | `notes` |

> 图用 `matplotlib`（已预装）画，存到工作目录的 `figures/` 下。
> ⚠️ **图上的标题与坐标轴标签必须用英文/ASCII**：运行环境里没有中文字体，中文会渲染成方框。

## 一、材料与附件解析（**口径钉死**）

| 文件 | 说明 |
|---|---|
| `requests.jsonl` | 每轮 `{turn, user, attachments}`；`attachments` 是该轮上传的文件名 |
| `attachments/` | 真实附件（`report.pdf` / `metrics.docx` / `scan.png` 之类） |
| `attachments.json` | 附件清单（名称 / 类型 / 字节数） |
| `report_format.json` | 四节模板（含 `min_chars`）、指标表列、参考区间 `thresholds`、固定话术 |
| `plan_stub.json` | **模型决策序列**（`recall` / `parse` / `tool` / `kb` / `finish`） |
| `limits.json` | `max_steps` / `window` / `top_k` / 固定话术 |
| `tools.json` / `tool_calls.jsonl` | 工具名册与待校验调用（**里面有非法请求**） |
| `kb/*.md` | 指南段落（`KB-01`…）；检索口径与第 19 章相同（2-gram + BM25 / TF 余弦对照） |
| `template.json` | **模板基线**：老师给的 `web/` 的哈希（你没有改前端就会被判据抓出来） |

**解析口径**（本实验的附件是"约定形态"，不是通用解析器）：

| 类型 | 怎么解 | 文本怎么算 |
|---|---|---|
| PDF | 找 `stream … endstream`，抽 `(...) Tj` 里的文本，按出现顺序成行 | 每行 `strip()` 后用 `\n` 连接 |
| DOCX | `zipfile` 读 `word/document.xml`，每个 `<w:p>` 取其 `<w:t>` 文本拼接成一行 | 同上 |
| 图片 | 只读 PNG 头（`IHDR`）拿宽高，不做像素识别 | 不参与文本 |

- `chars` = 解析出的所有行长度之和（图片写 `0`）；
- `checksum` = 上面"文本"的 `sha256` **前 12 位**；图片没有文本，用
  `sha256("image:{宽}x{高}:{字节数}")` 的前 12 位；
- 行里形如 `ITEM,VALUE,UNIT`（三项、数值在第 2 列）的才登记进指标表，其余是备注、忽略。

## 二、决策序列与循环（**口径钉死**）

每轮按 `plan_stub.json` 的 `steps` 逐步执行，每步往 `trace` 追加 `{turn, step, action, observation}`：

| action | observation（**逐字**） |
|---|---|
| `recall` | `记忆命中：` + 逗号连接的 active 偏好条目 id；没有就 `记忆命中：-` |
| `parse` | `解析 {文件名}：{登记行数} 行（{chars} 字）`；图片写 `解析 {文件名}：图片 {宽}x{高}` |
| `tool` | 校验通过 → `{item}={value} flag={flag}`；不通过 → `rejected:{rejected_reason}` |
| `kb` | `检索命中：` + 逗号连接的 `bm25_top3` |
| `finish` | `完成`，并结束本轮 |

`max_steps` 是**每轮**上限：`steps` 超过它时只执行前 `max_steps` 步，该轮终止原因记 `max_steps`；
否则走到 `finish` 记 `done`。

## 三、报告与回复（**口径钉死**）

**① 指标表**：按附件**首次出现顺序**、附件内**行序**累积登记；同一附件重复解析不重复登记。
每行 `{item, value, unit, flag}`，`flag` 由 `report_format.thresholds` 判：低于 `low` → `low`，
高于 `high` → `high`，否则 `normal`（未声明的指标写 `unknown`）。

**② 报告**：四节名称与顺序照模板，每节 `content` 不短于 `min_chars`。
**偏好生效时（记忆里有「报告只列异常指标」）指标表只列 `flag != normal` 的行**。
`counts` 三个数字：`total`（全部登记行）、`abnormal`（异常行）、`listed`（报告里列出的行）。

**③ 回复**：每轮一条 `{turn, reply, citations}`；非拒答轮 `reply` ≥10 字且带一条
`{"kind":"kb","ref":"KB-xx"}` 出处；**拒答轮 `citations` 为空**。

## 四、工具校验（与第 19 章同一套口径）

按顺序命中即停：未知工具 → `-32601` / `unknown_tool`；`args` 不是对象 → `-32602` / `invalid_args`；
缺必填 → `-32602` / `missing_required`；类型不符（`string` / `number`，布尔不算数字）→ `-32602` /
`type_mismatch`；**业务校验**：`flag_metric` 的 `item` 不在 `thresholds` 里 → `-32602` / `unknown_item`。
合法项 `status="executed"`、`error_code=0`、摘要写 `{item}={value} flag={flag}`；非法项摘要写 `""`。

## 五、记忆（**口径钉死**）

- **写入**：user 文本含 `报告只列异常指标` → 写一条
  `{entry_id:"MEM01", fact:"报告只列异常指标", category:"preference", state:"active", importance:2}`；
- **遗忘**：user 文本含 `忘掉 MEM01` → 把该条目（只处理 `active`）置 `forgotten`；
- **生效时机**：报告按**本轮记忆更新之后**的状态生成 —— 所以"忘掉"的那一轮，报告就恢复全量行；
- `working`：每轮 `"T{turn}: {user 前 20 字符}"`，只留最近 `window` 条；
- `short`：每轮 `"T{turn}: 步 {本轮步数} / 行 {累计登记行数} / 命中 {bm25_top3[0] 或 -}"`。

## 六、前端、元信息与分享（**判据看这三样**）

1. **`web/` 必须改过**：判据比的是 `app.web_sha256` 与 `template.json` 的基线 ——
   **相同就说明你直接交了模板**。哈希口径：`web/` 下所有文件按**相对路径升序**，
   逐个把 `路径 + \0 + 内容 + \0` 喂进 `sha256`，取前 16 位。
2. **`app.json` 字段**：`title` / `scenario` / `entry` / `theme{mode,accent}` / `attachments` /
   `visibility`。`theme.accent` 要与 `web/theme.css` 里的 `--accent` 一致；
   `theme.mode` 只能是 `light` 或 `dark`。
3. **分享与教师管理**（平台侧提供，你只需要把上面两样做对）：发布后平台给你的应用一个分享链接，
   教师能打开预览、看你应用里的对话记录、必要时下架。**可见性**先选 `teacher`（只给教师看）；
   确认没问题再改成 `course`（课程内可见）。

## 交付格式

**`output.json`**（写在工作目录下；键名与层级按下面样例）：

```json
{
  "app": { "title": "…", "scenario": "…", "entry": "harness/api.py",
           "theme": { "mode": "light", "accent": "#1f9d78" },
           "attachments": ["pdf", "docx", "image"], "visibility": "teacher",
           "web_sha256": "（你的 web/ 哈希，16 位）", "template_web_sha256": "（template.json 里的基线）" },
  "attachments": [ { "name": "report.pdf", "kind": "pdf", "chars": 56, "checksum": "3e79b0794ef5" } ],
  "harness": { "turns": 3, "max_steps": 5, "steps_total": 13, "terminated": ["done","done","done"] },
  "trace": [ { "turn": 1, "step": 1, "action": "recall", "observation": "记忆命中：-" } ],
  "tool_calls": [ { "call_id": "C01", "tool": "flag_metric", "args_valid": true, "status": "executed",
                    "error_code": 0, "rejected_reason": "", "result_summary": "HGB=96 flag=low" } ],
  "memory": { "working": ["…"], "short": ["…"],
              "long": { "active": [], "superseded": [], "forgotten": [] } },
  "retrieval": [ { "turn": 1, "bm25_top3": ["…"], "cosine_top3": ["…"] } ],
  "answers": [ { "turn": 1, "reply": "…（≥10 字）", "citations": [ { "kind": "kb", "ref": "KB-01" } ] } ],
  "report": { "template_used": "report_format.json",
              "sections": [ { "name": "目的", "content": "…（≥ min_chars）" } ],
              "metric_rows": [ { "item": "PLT", "value": 18, "unit": "10^9/L", "flag": "low" } ],
              "counts": { "total": 4, "abnormal": 3, "listed": 3 } },
  "safety": { "escalations": [ { "record_id": "ROW01", "item": "PLT", "value": 18, "message": "<固定话术>" } ],
              "refusals": [ { "turn": 3, "reply": "…", "reason": "…（≥10 字）" } ] },
  "metrics": { "tool_executed": 1, "tool_rejected": 1, "report_rows": 4, "abnormal_rows": 3,
               "trace_checksum": "…（12 位）" },
  "figures": [ { "path": "figures/app_report_overview.png", "takeaway": "…（一句话结论）" } ],
  "notes": "…（≥80 字：为什么自己解附件、偏好记忆改变了什么、至少两条局限）"
}
```

- `safety.escalations[].record_id` 是按登记顺序的行号 `ROW01`、`ROW02`…（从 1 起）；
- `report` 取**最后一轮**生成的那一份；
- 图至少 1 张：`path` + 一句 `takeaway`；
- 报告里的数值**不需要**和任何人一致 —— 只要口径对，它们**本来就该相同**；口径错了就会不一样。

## 怎么算完成

1. `harness/api.py` 的六个函数都实现，`python3 harness/run.py . output.json` 能产出结果；
2. `web/` 改到能看出是你的应用（主题能换、结构有你的改动），`app.json` 填好；
3. 在 `cases/case01` 与 `cases/case02` 上都跑通 —— 判据对两个 case 各判一次；
4. 本地跑 `python3 app_host.py` 能打开页面，上传附件、拿到回复与报告；
5. 把结论与坑记下来 —— 报告会由工具整理进 `report.md`，**不需要改 `SKILL.md`**。

判据全文见 `judge.md`；怎么自测、包内还有什么，见 `README.md`。
