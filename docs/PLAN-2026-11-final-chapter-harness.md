# 收官两章落地计划：第 19 章 Harness 智能体 + 第 20 章 应用实践

> 状态：**进行中**（2026-11-11 起；2026-11-15 第 19 章改为 `server/fixtures/agent-live/`，见 §0.3）。
> 平台侧应用托管的设计见 [`DESIGN-2026-11-agent-app-platform.md`](DESIGN-2026-11-agent-app-platform.md)。
>
> 配套必读：[`EXPERIMENT-CREATION-GUIDE.md`](EXPERIMENT-CREATION-GUIDE.md)（怎么做）、
> [`EXPERIMENT-DESIGN-FRAMEWORK.md`](EXPERIMENT-DESIGN-FRAMEWORK.md)（怎么设计）、
> [`PLAN-2026-10-experiment-roadmap.md`](PLAN-2026-10-experiment-roadmap.md)（前三个批次的记录与经验）、
> [`EXPERIMENT-PACKAGE-SPEC.md`](EXPERIMENT-PACKAGE-SPEC.md)（包格式）。

---

## 0. 一句话

课程原来在第 19 章用 `learning-assistant`（四环闭环）收尾。本次按"综合运用前面所有章节"的口径**升级收官**：

- **第 19 章**（改造）= `harness-agent`：学生手写 harness 的六个部件 —— **循环 / 记忆分层 / 工具（MCP 风格）/ 知识库检索 / 安全边界 / 答案与出处**；
- **第 20 章**（新建）= `agent-app-studio`：把 harness 接到**零依赖静态前端**上做成一个真应用（示例：上传实验数据 → 按规定格式生成实验报告），**发布到平台、分享给老师、由教师管理**。

## 0.1 用户选定的三条口径（2026-11-11）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 章节定位 | **19 章升级为 harness 智能体，20 章新增具体应用实践**（`learning-assistant` 下架保留、不删数据） |
| 2 | 分享与运行 | **平台托管运行容器**（完整方案，**分两期**）：一期单实例 + 教师可见，二期再接三档可见性与并发配额 |
| 3 | 交付边界 | **教师给零依赖静态前端模板，学生自由改**；后端只写 harness core，**HTTP / 上传封装由模板提供** |

## 0.2 与既有批次的关系

| 批次 | 内容 | 状态 |
|---|---|---|
| 批次 1 | 第 18 / 5 / 9 章（技能 / 知识库 / 问答原型） | ✅ 已上线 |
| 批次 2 | 第 4 / 16 / 19 章（注意力 / 记忆 / 学习助手） | ✅ 已上线 |
| 批次 3（本文件） | 第 19 章升级 + 第 20 章新建 + 平台应用托管 | 🚧 进行中 |

> 第 19 章原来的 `learning-assistant` 项目**下架保留**：数据与实测记录都留着，
> 需要回滚时重新 publish 即可（见 §5）。

---

## 0.3 2026-11-15 重构：第 19 章改成「搭一个能跑的 agent」

**用户反馈（原话）**：「我觉得目前的实验是相当傻的，还把我们的实验当成之前的机器学习实验，
但是我们现在就是简单的构建一个通用 agent，还搞什么 case1、case2 对比…… 我是做 agent 搭建的实验啊」。

**核对仓库后确认成立**（不是措辞问题，是判据与形态问题）：

| 现象 | 证据 |
|---|---|
| 判据主体是"对齐标准答案" | `harness-agent/problem/manifest.json` 16 条断言里 **11 条**含 `expected` 逐字段比对 |
| 包里其实没有 agent | 模型被替换成 `plan_stub.json` 桩，学生写的是"按剧本执行 + 记账"的确定性脚本（12 个函数 / 16 处 TODO） |
| 形态照搬 ML 实验 | `cases/case01`、`case02` 两套材料 + `expected.json`；报告模板里还有"各 case 的结果"表 |

**用户选定的新口径**：

| 决策点 | 结论 |
|---|---|
| 第 19 章交付形态 | **真写一个能跑的 agent**：接真模型 + 真工具 + 循环，**一个场景**，验收看它能不能完成一组真实对话任务 |
| 判分底线 | **冒烟断言 + 教师 rubric 为主**（不再比对 `expected`） |

**落地**

- 新包 **`server/fixtures/agent-live/`**（单场景 · 设备维护 · 6 组真实对话）；旧 `harness-agent`
  保留不删、项目 `unpublish`（与 `learning-assistant` 同一套回滚约定）。
- 判分基建 `server/verify-image/run-eval.mjs` 泛化三处（全部向后兼容 38 个历史包）：
  ① `expected.*` 可选；② 无 `cases/` 目录时把包根当唯一工作目录（case 名 `main`）；
  ③ 报告扫描不再硬要求"两个 case 的表格行"。镜像 **`nju-lab-verify:0.2.0-rc.2-pkg9`**。
- "教师 rubric 为主"**不需要改平台代码**：平台本来就有 `autoScoreSuggestion`（自动建议分）与
  `teacherScore`（教师分），前端取 `teacherScore ?? autoScoreSuggestion`。
- 规范补充：`docs/EXPERIMENT-PACKAGE-SPEC.md` §3.0「单场景包（无 cases / 无 expected）」。

**追加（2026-11-15，用户追问"学员构建好 agent 之后怎么用"）**：第 19 章的 agent 现在**能直接发布成应用**，
零平台改动 —— `app_host.py` 的 `ENTRY_CANDIDATES` 第一项本来就是 `skill/agent/api.py`，
只是新包没提供这个文件。已给好 `agent/api.py`（平台入口）+ `agent/llm.py` 支持平台模型代理；
学生把数据拷进 Skill 根后即可在「我的应用」里一键创建，得到网页对话 + 分享链接。
实测：第 1 轮报 5 台逾期、第 2 轮"我负责 A 区"、第 3 轮只报 A 区 2 台（跨轮记忆在应用里生效）。

> **口径待定**：第 20 章原本写"应用 = Skill"（2026-11-13 用户拍板）。现在第 19 章的 agent 也能发布，
> 于是第 20 章有两条路可选（平台 agent + 写 Skill，或直接用自己的 agent）。要不要把这点写进第 20 章题干，
> 需要用户定。

**第 20 章不受影响**：第 20 章交付的是 **Skill**（`handle()`，由平台 agent 调度），判据本来就
不依赖第 19 章的 `harness-agent` 包，故本次不动。

---

## 1. 第 19 章：`harness-agent`（已落地）

### 1.1 应用与任务形态

随访助手要能听懂一句"帮我看下 P001 最近的血小板计数"，自己走完一轮又一轮。
**难的不是接模型，而是包在模型外面的那一层**：谁执行、谁记账、谁记住、谁拦住。

所以题目把"模型"变成**桩**：`plan_stub.json` 给出每轮的决策序列（`recall` / `tool` / `kb` / `finish`），
学生实现的 harness 必须真的循环、每步记 `observation`、尊重 `max_steps`。
好处是**输入全部写死 ⇒ 逐字段可比**（沿用 `attention-ablation` 的经验）。

### 1.2 包结构

```
server/fixtures/harness-agent/
├── problem/                         → problem.zip（下发；**没有 reference/**）
│   ├── manifest.json                IO 契约 + flow=engineering + 14 条断言
│   ├── task.md                      六步流程 + 六个部件的口径 + 交付格式
│   ├── judge.md                     语义判据（理由说清 / 检索≠结论 / 安全边界 / 局限）
│   ├── README.md                    导学 + 排错表
│   └── cases/case0{1,2}/            dialogue / records / tools / tool_calls / plan_stub / limits / kb/ + expected
├── skill-template/                  → skill-template.zip（起点骨架）
│   ├── SKILL.md                     能力边界预填（不留文档 TODO）
│   ├── report.md                    报告六节（工程实现型列）
│   └── scripts/harness.py           六件各留一个 TODO 函数
├── solution/                        ⚠️ 教师侧解答样例（不下发、不打包）
│   ├── SKILL.md
│   ├── report.md                    实测档案
│   └── scripts/harness.py           完整实现 + `--regen-expected`
├── tools/gen_data.py                造题工具（不下发）
└── README.md
```

### 1.3 判据设计（14 条断言）

| 组 | 断言 | 判什么 |
|---|---|---|
| 结构 | 字段完整 / 循环真的发生 | 十项都在；`trace` 每步有 `turn/step/action/observation` |
| 循环 | 终止条件正确 / trace 逐步一致 | `terminated` 每轮一条；截断记 `max_steps`；逐步与 expected 对上 |
| 工具 | 逐条一致 / 非法如实记 / **错误码不混用** / **业务校验拦人** | `-32601`（未知工具）vs `-32602`（参数类）；`not_out_of_range` |
| 记忆 | 三层都在 / **行为性：旧条目进 superseded、被遗忘的进 forgotten** / 应用一致 | 更新与遗忘真的生效，不是只写不管 |
| 检索 | top3 逐轮一致 + `top3_diff_turns` 一致 | BM25 与 TF 余弦的差异被报出来 |
| 安全 | 越界逐行升级 + 拒答 | `message` 与固定话术逐字相同 |
| 收尾 | 图 + 工具记账自洽 + `notes` ≥60 字 | `takeaway` 与 `metrics` 自洽 |

**防退化两端**：

| 偷懒解 | 会被哪条拦住 |
|---|---|
| 不实现循环，直接把 `steps` 抄成结论 | "循环真的发生"（`trace` 空）+ "终止条件正确" |
| 检索只用 TF 余弦（不做长度归一） | `top3_diff_turns` 与 `bm25_top3` 逐轮比对 |
| `escalate_value` 一律执行成功 | `not_out_of_range` 计数 ≥1 且必须 rejected |

### 1.4 出题时的实测依据（2026-11-11，`nju-lab-verify:0.2.0-rc.2-pkg6`）

| case | 轮数 | 总步数 | terminated | 工具 executed/rejected | 记忆三态 | top3 不同的轮次 | `trace_checksum` |
|---|---|---|---|---|---|---|---|
| case01 | 5 | 23 | 全 `done` | 4 / 4 | 1 / 1 / 0 | `[1,2,3,4]` | `106c1be2c1b6` |
| case02 | 3 | 12 | `done` / **`max_steps`** / `done` | 5 / 2 | 0 / 0 / 1 | `[1,3]` | `ed407ae57a69` |

- 两 case 的失败分布合起来覆盖四类：`unknown_tool` / `missing_required` / `type_mismatch` / `not_out_of_range`；
- case02 第 2 轮**故意给 6 步**（`max_steps=4`）：专门考"到点就停并把原因写出来"；
- case02 的 `top3_diff_turns=[1,3]` 由语料结构保证：最长的综述 `KB-04` 在 TF 余弦下被顶到第一，BM25 因为长度归一没被带走。

### 1.5 上线动作

```sh
cd server/fixtures/harness-agent
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip
# → 参考实现复验（应 2/2）
cd /home/ubuntu/nju-lab
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low -e VERIFY_MAX_CASES=0 \
  -v "$PWD/server/fixtures/harness-agent:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/solution --problem /p/problem.zip \
  --out /outputs/harness-agent.json --timeout-ms 300000
```

之后：上传两个包 → 建项目（chapterId = 第 19 章 `8fb368bb-e56a-4cd5-8e93-c0761792ec99`）→ publish；
原 `learning-assistant` 项目 unpublish；第 19 章正文按 §3.1 改造并重生成 deck。

---

## 2. 第 20 章：`agent-app-studio`（待落地）

### 2.1 应用与任务形态

学生把第 19 章的 harness 接上一个**真前端**，做成能交付给护士/老师用的应用。
题目给三个候选场景（学生也可自选，需在 `app.json` 里写清）：

1. **实验数据 → 标准格式实验报告**（主样板）：上传 `.xlsx` / `.pdf` / `.docx` / 图片 → 抽指标表 →
   按 `report_format.json` 出四节报告 + 指标表 + 危急值提示 + 出处；
2. 检验单解读（复用第 18 章口径）；
3. 文献/教材问答（复用第 5 / 9 章检索）。

### 2.2 交付契约（四件套）

```
skill-template/
├── app.json           # 元信息：title / scenario / entry / theme{accent,bg} / attachments.types / visibility
├── harness/api.py     # 只写 core：load(app_dir) + handle(message, attachments, session) -> {reply, report, citations}
├── web/               # 零依赖静态前端（从 web-template 复制后自由改）
│   ├── index.html     #   对话区 + 上传控件 + 报告预览
│   └── theme.css      #   主题变量（≥3 个 CSS 变量，供"改背景/配色"）
├── app_host.py        # 教师提供，**学生不改**：HTTP + multipart + 附件落盘 + 会话持久化 + 调平台 LLM 代理
├── SKILL.md
└── report.md
```

**为什么前端必须零依赖**：工作台与运行容器都在 `--internal` 网络里、没有外网，
`npm install` 不可能成功。所以前端 = 纯 HTML/CSS/JS，学生改主题与交互，不引入构建链。

### 2.3 判据草案（16 条，含 2 条"交付形态"）

字段完整 → `app.json` 元信息完整 → `web/index.html` 含必需元素（对话容器 / `input[type=file]` 覆盖
pdf+docx+图片 / `data-theme` 容器）→ **零依赖**（`web/` 下无 `package.json`、无外链 `http(s)://` script/style）
→ 主题变量 ≥3 且与 `app.json.theme` 一致 → **与模板不完全相同**（防"直接交模板"）→
附件解析（`pdf` / `docx` 抽出文本的 checksum 与 expected 一致）→ 指标表逐行一致 →
报告四节齐 + `min_chars` → `requests.jsonl` 端到端走完 loop → 跨轮记忆生效 →
工具校验/执行/rejected 一致 → 检索出处一致 → 危急值升级 + 拒答 → 图 ≥1 → `notes` ≥80 字。

**判分分工**：`output.json` 判 harness 与报告（自动）；**前端体验 / 分享与权限 / 演示答辩 → 教师 rubric**
（沿用第 19 章正文已有的"演示答辩"验收项）。

### 2.4 依赖与门槛

| 项 | 结论 |
|---|---|
| `pypdf` / `python-docx` | **不预装**：PDF/DOCX 让学生用标准库自己解（"附件不是魔法"）；图片走视觉模型，不需要 OCR 库 |
| 图片上传 | **走视觉模型抽取**（2026-11-11 实测 `deepseek-flash` 支持 `image_url` 且能读准三段式数据行）；判据只比对抽出的结构化行，不比模型原始输出（格式会漂） |
| 复验容器 | 判分只跑 core + 固定附件（`cases/<case>/attachments/`），**不依赖运行容器** |
| 平台依赖 | 应用发布 / 托管运行 / 分享 / 教师管理（见 DESIGN 文档两期计划） |

### 2.5 上线顺序（建议）

1. 先落**实验包**（能 `--check` + 复验 2/2），平台侧可以先用"交 zip + 教师在工作台里跑"验收；
2. 平台一期（托管运行 + 教师可见）上线后，把题干里的"发布与分享"从"交 zip"改成"点发布"；
3. 平台二期（三档可见性 + 评分）上线后，把教师 rubric 接进评分页。

---

## 3. 章节正文改造（用 `update-chapter` skill）

### 3.1 第 19 章（改造，不新增章节）

改法：保留"项目目标 + 四模块架构 + 三阶段路径 + 安全红线"的骨架，
把叙事从"学习助手"换成"**harness**"，并明确六个部件：

| 原正文 | 改成 |
|---|---|
| 阶段二：`mem0` / MCP 工具 / LangChain-LangGraph 编排 | **本地等价物**：条目表 + mock 工具 + 自己的编排脚本（保留"与真实工程的差距"一段） |
| 四模块（感知 / 大脑 / 行动 / 记忆） | 保留为上位架构，下面新增 **harness 六件**：模型接口层 / 循环控制器 / 工具层 / 记忆分层 / 知识库 / 安全边界 |
| 验收标准（功能闭环 / 可溯源 / 安全边界 / 工程规范 / 演示答辩） | 前四条对应六件；**演示答辩**留给第 20 章 |
| 章末"动手实践" | 指向 `harness-agent`（要求：两个 case 都过、`trace` 逐步可比、报告由工具生成） |

### 3.2 第 20 章（新建，order 20）

标题建议：**《综合实践：从 Harness 到可分享的智能体应用》**。正文六节：
① 为什么"能用"和"能交付"是两件事 → ② 应用的四件套（core / 前端 / 附件 / 权限）→
③ 前端只有零依赖这一条路（无外网 + 模板）→ ④ 附件解析与"口径钉死" → ⑤ 发布、分享与教师管理 →
⑥ 工程规范与演示答辩 + 安全红线。

新建章节：

```sh
TOKEN=$(curl -s -X POST http://127.0.0.1:3100/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -s -X POST http://127.0.0.1:3100/api/courses/course-cd11ea33/chapters \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"综合实践：从 Harness 到可分享的智能体应用","order":20,"content":"…"}'
```

---

## 4. 平台工程：应用托管（两期）

细节见 [`DESIGN-2026-11-agent-app-platform.md`](DESIGN-2026-11-agent-app-platform.md)。要点：

- **不改 nginx**：静态前端与对话接口都走 `/lab/api/apps/...`（已存在的 `/lab/api/` 通道）；
- **运行时**复用 `ContainerRuntime`：`nju-lab-app-runtime` 镜像（`FROM nju-lab-verify`）+ `app_host.py`；
- **LLM 不落容器**：容器只访问平台代理 `/api/llm/chat`（限流 + 审计 + 不泄露 key）；
- 一期：上传 / 发布 / 起容器 / 反代（HTTP+SSE）/ 教师可见 / 对话日志；
- 二期：三档可见性（教师 / 课程内 / 免登录只读）、多版本回滚、并发排队与配额、成本看板、评分接入。

---

## 5. 里程碑

| 期 | 交付 | 验收 |
|---|---|---|
| **M1** | 第 19 章实验包 + 正文改造 + deck 重生成 + 项目发布（`learning-assistant` 下架） | `--check` 0；复验 2/2；`unzip -l problem.zip` 无 `solution/` |
| **M2** | 第 20 章新建 + 实验包（含 `web-template` / `app_host.py` / `solution`） | 同上；学生端章节页可见 |
| **M3** | 平台一期 | `server npm test` / `web build` 全绿；端到端手工清单 |
| **M4** | 平台二期 | 三档可见性各验一遍；10 并发压测 |
| **M5** | 收尾 | `fixtures/README` 加行、`HANDOFF.md` 顶部条目、`git commit && push` |

---

## 6. 风险与未决

| 风险 | 对策 |
|---|---|
| 运行容器并发与内存（1g/0.5cpu 每容器） | 一期并发上限 10 + 队列；空闲 15 min 回收 |
| 学生代码在容器内跑 | 非 root、只读镜像、只挂自己的 app 目录、`--internal`、禁 `--privileged` |
| 判分与线上不一致 | `app_host.py` / `web-template` 由包下发**且**镜像内置同一份，sha256 断言钉死 |
| 模型不确定性破坏逐字段判据 | case 全走 `llm_stub`；真模型只用于自测与演示 |
| 解析库要重建镜像 | 一次重建（verify + workspace 同步升 tag），照 `UPGRADE-playbook.md` §4 的坑执行 |
| 历史文档不能改 | `docs/ACCEPTANCE-*` 与已发布实测记录不动；升级信息只追加到 `HANDOFF.md` 顶部 |

**未决（M3 前要定）**：应用容器并发上限与每会话 token 配额；免登录分享要不要开；
`learning-assistant` 是否保留为第 19 章的 easy 档。
