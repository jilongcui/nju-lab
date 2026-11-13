# 综合实践：把 harness 做成一个可分享的智能体应用

> **流程归属（给引导用的提示）**：本实验是**工程实现型 + 交付型**——按题目口径写一段确定性代码，
> 用题目包里的 case 逐字段核对，**没有"定基线 → 训练 → 评估指标"这些环节**。
> 六步见下面「实验流程」：第 3 步是"搭 core + 改前端"，第 5 步是"边界与分享自测"。

## 从这里开始（5 步，约 30 分钟出第一版）

> 这一节只讲**先走通**；完整口径在下面各节，字段一个都别改。

| 步 | 做什么 | 你会拿到 |
|---|---|---|
| 1 | 平台「我的应用」→ 新建应用 | 一个**应用 id**（发布时要用） |
| 2 | 本页「实验材料」下载题目包 | `task.md` + 两个样例数据集 |
| 3 | 点「实验环境」，在工作区里把模板改起来（先只改 `web/theme.css` 的主色和标题） | 一个"看起来是你的"页面 |
| 4 | 在工作台里跑样例：`python3 harness/run.py ./cases/case01 output.json`（样例目录按实际路径） | `output.json` + `figures/` 里的图 |
| 5 | 在工作台里发布：`python3 publish_app.py --app <应用 id> --publish` | 分享链接（匿名可打开） |

> ⚠️ 网页上的「上传产物」只适合本地已有 zip 的情况。**学员的工作区在远端容器里**，
> 浏览器选不到那些文件 —— 用第 5 步的命令最快。

## 时间不够时的最小路径（先做出一个能打开的版本）

这一档最容易"什么都想做、最后一件事都没成"。按下面三步走，**每一步都有可交付**：

1. **先做"能出报告"**：`harness/api.py` 的 `parse_attachment()` + `build_report()`（与入门档同一套），
   跑通 `harness/run.py` 拿到 `output.json`；
2. **再做"能打开"**：`web/` 只改两处（`theme.css` 的 `--accent`、`index.html` 的标题），
   然后 `python3 publish_app.py --app <id> --publish` —— 这时已经有**可分享的页面**了；
3. **最后补"能讲清"**：记忆改变行集、越界升级与拒答、`report.md` 里的踩坑与局限。

> 到第 2 步就"及格线"了（应用能用 + 交付形态）；第 3 步决定你能不能拿满。
> 别在第一步就把六件事一起写 —— 先把报告跑出来，后面每一步都能看到进展。

## 做完前自查（逐条打勾）

- [ ] 三类附件都能解析：PDF / Word 的指标行出来了，**图片也读出来了**（不是只登记）；
- [ ] 指标行的 `flag` 与参考区间对得上（低 `low` / 高 `high` / 其余 `normal`）；
- [ ] 用户说「报告只列异常指标」后，报告行集变小；说「忘掉 MEM01」后又变回全量；
- [ ] 超出参考区间的行有提示，被要求"直接说是不是 XX 病"时**拒答且不给引用**；
- [ ] `web/` 与老师的模板**不一样**（`app.web_sha256` ≠ `template.json` 里的基线）；
- [ ] 平台「我的应用」能预览、能复制分享链接（同学不登录也能打开）；
- [ ] `report.md` 写了至少 1 条踩坑。

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

| 类型 | 怎么解 | 通道（`via`） |
|---|---|---|
| PDF | 找 `stream … endstream`，抽 `(...) Tj` 里的文本，按出现顺序成行 | `text` |
| DOCX | `zipfile` 读 `word/document.xml`，每个 `<w:p>` 取其 `<w:t>` 文本拼接成一行 | `text` |
| 图片 | **交给视觉模型**把图里的三段式数据行读出来（图片没有文本层，正则读不到） | `vision` |

- 行里形如 `ITEM,VALUE,UNIT`（三项、数值在第 2 列）的才登记进指标表，其余是备注、忽略；
- `chars` = 文本类附件的行长度之和（**图片写 `0`**，它没有文本层）；
- `rows` = 该附件抽出的指标行数；
- `checksum`：文本类用"每行 `strip()` 后以 `\n` 连接"的 `sha256` **前 12 位**；
  图片用**结构化行**的规范化文本（`item,value,unit` 逗号无空格、按行 `\n` 连接）的 `sha256` 前 12 位
  —— 视觉输出的**空格/换行会漂**，所以只对抽出来的行算。

### 图片走视觉：怎么调、为什么要这么调

环境里已经注入了模型额度（`DEEPSEEK_API_KEY`），端点是 OpenAI 兼容的：

```python
payload = {
    "model": "deepseek-flash",          # 支持 image_url（实测）
    "max_tokens": 800,
    "temperature": 0,
    "reasoning_effort": "none",         # 它是推理模型：预算含思维链，给太小会只剩空 content
    "messages": [{"role": "user", "content": [
        {"type": "text", "text": "读出图中每一行检验数据，按「指标,数值,单位」输出，一行一条…"},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}},
    ]}],
}
# POST {DEEPSEEK_BASE_URL:-https://api.deepseek.com}/chat/completions
```

> 三个坑（都是实测踩到的）：① `max_tokens` 太小会被思维链吃光，`content` 可能是空的；
> ② 输出**格式会漂**（`PLT, 18, 10^9/L` 与 `PLT,18,10^9/L` 都可能出现）—— 所以下游必须用
> **容错正则**抽行，不能拿原始文本逐字比对；③ 环境没有外网以外的东西，别指望装 OCR 库。

## 二、决策序列与循环（**口径钉死**）

每轮按 `plan_stub.json` 的 `steps` 逐步执行，每步往 `trace` 追加 `{turn, step, action, observation}`：

| action | observation（**逐字**） |
|---|---|
| `recall` | `记忆命中：` + 逗号连接的 active 偏好条目 id；没有就 `记忆命中：-` |
| `parse` | 文本类：`解析 {文件名}：{登记行数} 行（{chars} 字）`；图片：`解析 {文件名}：图片抽取 {登记行数} 行（视觉通道）` |
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

## 六、把产物交到平台（**在工作台里一条命令**）

你的代码在工作区的**远端容器**里，浏览器拿不到这些文件 —— 所以别去找"上传"按钮，
在工作台里跑题目包自带的脚本：

```sh
# <应用 id>：在平台「我的应用」新建应用后可见（也可以从页面 URL 里抄）
python3 publish_app.py --app <应用 id>            # 只上传一版
python3 publish_app.py --app <应用 id> --publish  # 上传 + 发布，打印分享链接
```

它只打包 `app.json` / `harness/` / `web/` / `kb/`（题目材料、日志、输出不会带上去），
用容器里已经注入的 `NJU_LAB_SERVER_URL` 与 `NJU_LAB_TOKEN` 调平台接口。
token 过期就去平台右上角「API Token」重新领一个。

> 这个脚本为什么必须在容器里跑：平台学员的工作区是远端容器，本地没有这些文件。
> 上传成功后到「我的应用」点「预览」即可看到你的页面（首次启动约 30–60 秒）。

## 七、前端、元信息与分享（**判据看这三样**）

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
  "attachments": [ { "name": "report.pdf", "kind": "pdf", "via": "text", "chars": 56, "rows": 3,
                     "checksum": "3e79b0794ef5" },
                   { "name": "scan.png", "kind": "image", "via": "vision", "chars": 0, "rows": 1,
                     "checksum": "c482e7ae14a4" } ],
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
  "metrics": { "tool_executed": 1, "tool_rejected": 1, "vision_calls": 1,
               "report_rows": 5, "abnormal_rows": 4, "trace_checksum": "…（12 位）" },
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
   三个附件都要解析到（**图片走视觉**，`metrics.vision_calls` 至少 1 次）；
2. `web/` 改到能看出是你的应用（主题能换、结构有你的改动），`app.json` 填好；
3. 在 `cases/case01` 与 `cases/case02` 上都跑通 —— 判据对两个 case 各判一次；
4. 本地跑 `python3 app_host.py` 能打开页面，上传附件、拿到回复与报告；
5. 把结论与坑记下来 —— 写进 `report.md`（模板在骨架里，六节照填），**不需要改 `SKILL.md`**。

判据全文见 `judge.md`；怎么自测、包内还有什么，见 `README.md`。

## 名词速查

| 词 | 一句话 |
|---|---|
| harness | 包在模型外面的脚手架：循环 / 记忆 / 工具 / 检索 / 边界 |
| core | 你写的那部分逻辑（本实验 = `harness/api.py` 的六个函数） |
| 产物（zip） | `app.json` + `app_host.py` + `harness/` + `web/` + `kb/` |
| `app.json` | 元信息：标题 / 场景 / 主题 / 支持的附件类型 / 可见性 |
| 指标行 | 从附件抽出的 `item, value, unit` 三元组 |
| `flag` | 参考区间判出的状态：`low` / `high` / `normal` |
| 出处 | 结论引用到哪条指南段落（`KB-xx`） |
| 分享链接 | 匿名可打开的地址；下架即失效 |
| 可见性 | 仅自己 / 教师可见 / 课程内可见 |
