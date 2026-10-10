# 实验扩展路线图：下一批实验（教师向 · 落地计划）

> **这份文件是给"下一个 session 的接手人"看的**：批次 1（第 18 / 5 / 9 章）已于 2026-10-10 落地并上线；
> 本文件给出**批次 2（第 4 / 16 / 19 章）**的设计草案、平台约束与落地步骤，**照着做就能直接开工**。
>
> 配套必读（本文件不重复它们的内容）：
> [`EXPERIMENT-CREATION-GUIDE.md`](EXPERIMENT-CREATION-GUIDE.md)（怎么做：11 步照做 + 坑表）、
> [`EXPERIMENT-DESIGN-FRAMEWORK.md`](EXPERIMENT-DESIGN-FRAMEWORK.md)（怎么设计：判据分层、教学向七件事、
> 「引导监督模式」）、[`EXPERIMENT-PACKAGE-SPEC.md`](EXPERIMENT-PACKAGE-SPEC.md)（包格式与依赖声明）、
> [`UPGRADE-playbook.md`](UPGRADE-playbook.md)（镜像重建 / 部署坑）、根目录 `AGENTS.md`（仓库纪律）；
> **运行态事实**（镜像 tag、kit 版本、平台项目 id 与 sha256）一律看 `HANDOFF.md` 顶部。
>
> **可抄的样板（按形态挑，都带 12 条断言 + 完整 README 文案）**：
>
> - `server/fixtures/lab-report-reader/` —— **技能 / 智能体类**：口径钉死 + 逐项比对 + 把 `SKILL.md` 的
>   关键内容以 `skill_card` 字段带进报告（judge 只能看产出文件，这是个现成解法）；
> - `server/fixtures/keyword-search/` —— **"做法 + 对照 + 指标"型**：用 `postings_checksum` 钉死中间口径，
>   两组 `recall@3` 逐字段比对，**对照组差距由语料结构保证**；
> - `server/fixtures/qa-prototype/` —— **多模块组装型**：逐题路由 + 关键事实 + 出处形态 + 路径全比对；
> - `server/fixtures/sql-crud/`、`vector-search/`、`kg-alerts/` —— "数据库 / 知识库类"三个样板。

---

## 0. 一句话

课程《分子医学人工智能理论与实验》（`course-cd11ea33`）现有 **14 章 / 15 个实验**：
批次 1（18 技能 → 5 知识库 → 9 综合实践）**已完成并上线**（见 §0.1）；
批次 2（4 LLM 原理 → 16 记忆系统 → 19 智能体综合实践）**已完成并上线**（`--check` 退出码 0、
参考实现复验 2/2、三个项目已发布，见 §0.2）。
**下一批可选做批次 3：第 17 章（MCP 服务，解析型简化版）**。第 15 章建议只做讨论作业、第 1 章不需要实验。

---

## 0.1 落地进度（2026-10-10）

**批次 1 已完成并上线**（三个实验包 + 学生端第三条引导分支 + 镜像/kit + 平台发布）：

| 实验 | 章节 | 应用 | 断言 | 参考实现复验 | 关键实测数值 |
|---|---|---|---|---|---|
| `lab-report-reader` | 第 18 章 | 检验报告解读 Skill（口径比对 + 危急值拦截 + 技能卡） | 12 | **2/2、硬性 12/12**（68s / 55s） | case01 报告单 15 行 → 13 项（12 可判定 + 1 表外），丢弃 1 非法 + 1 重复，危急值 3 个 |
| `keyword-search` | 第 5 章 | 倒排索引 + BM25 + 字符 2-gram 对照 | 12 | **2/2、硬性 12/12**（98s / 35s） | `recall@3` BM25 **0.875 / 0.75** vs 2-gram **0.0 / 0.0** |
| `qa-prototype` | 第 9 章 | 四形态各用一次 + 出处可溯源 | 12 | **2/2、硬性 12/12**（85s / 99s） | 路由 sql 1 / keyword 1 / vector 1 / graph 2；Q04 是 3 跳链 |

平台项目 id / 章节 / sha256、**workspace 镜像 tag（`nju-lab-workspace:0.2.0-rc.2-pkg8`）**、
kit 版本（`20261010-1456-ef6e154`）等运行态事实见 `HANDOFF.md` 顶部。
§6 的待决事项：第 1、3 项已随批次 1 决定；第 2、4、5、6 项仍待定，并新增了批次 2 相关的第 7~9 项。

---

## 0.2 批次 2 落地进度（2026-10-10，✅ 已完成并上线）

**用户选定的三件口径**（对应 §6 第 7 / 8 / 9 项）：
① 第 4 章实验**含**“下一个 token 的概率分布 + 采样”（题干用「**锐化系数**」的名义引入，不新造“温度”概念）；
② 第 16 章**做满正文的“四操作”**（写入 / 检索 / **更新** / **遗忘**），不只是三种上下文策略；
③ 第 19 章走**折中方案** —— 学生只拿空壳骨架（`problem.zip` 里**没有** `reference/`），
教师侧另建 `solution/`（不进任何 ZIP、不下发）用于跑复验。

| 实验 | 章节 | 应用 | 断言 | 复验（本机实测 2026-10-10） | 关键实测数值 |
|---|---|---|---|---|---|
| `attention-ablation` | 第 4 章 | 手写缩放点积注意力 + 三档消融 + 下一个 token 的采样 | 14 | **2/2、硬性 14/14**（58s / 33s） | 校验和 `8d16d6b80dda`；去缩放 `max_row_weight` **0.2761 → 0.4329**、行熵 **2.2074 → 1.7238**；去掩码 `mean_future_weight` **0.4725**；`top1_ratio` **0.745 / 0.540 / 0.360** |
| `memory-strategies` | 第 16 章 | 记忆四操作 + 窗口 / 摘要 / 检索三策略 + before/after | 13 | **2/2、硬性 13/13**（58s / 45s） | case01：7 条条目（4 active / 1 superseded / 2 forgotten）；三策略 recall **0.3 / 0.7 / 0.8**；Q04 `[M02,M06] → []` |
| `learning-assistant` | 第 19 章 | 四环闭环 + 行级/段级出处 + 安全边界（**迁移检验**） | 12 | **2/2、硬性 12/12**（64s / 49s） | case01：6 次调用（**4 executed / 2 rejected**）、2 行越界、引用 4 条、拒答 1 条 |

三件**新沉淀的经验**（写后续实验时照用）：

1. **输入能写死就写死**：第 4 章把所有小数落地成“固定 3 位小数的十进制字符串”，
   于是注意力矩阵、校验和、采样的前 5 个结果**跨平台逐位可比** —— 精确比对才立得住
   （若让种子现算浮点，跨 BLAS 版本就会漂）；同时配一个**离散量**（`top_attend`：每行 `argmax` 的列号）
   做双保险，连续量（消融统计量）则用**容差 + 方向性**双判；
2. **行为性判据比“跑通”强**：第 16 章把“更新后旧条目不再命中”“被遗忘的条目在三种策略里都取不到”
   “before/after 至少有一题不同”写成断言，并设了一处**边界口径**（遗忘**只处理 `active`** ⇒
   被更正的 `superseded` 不会被顺带遗忘）—— 这与批次 1 的“边界口径方向相反”是同一套思路；
3. **迁移检验要保住“可解性证明”**：第 19 章不给学生参考实现，但教师侧留 `solution/`
   （与 `problem/` 平级 ⇒ 打包命令永远不会带上它），用它跑复验 2/2 —— 用 `unzip -l problem.zip` 核对过。

**章节正文修订（同批完成）**：第 4 章章末**新增「九、动手实践」**指向本章实验；
第 16 / 19 章教学示例处各补一段「**课堂说明（关于实验环境）**」，把 `mem0` / MCP /
LangChain-LangGraph 换成本地等价物并说明差距（见 §7 附录）。

平台侧（2026-10-10，经操作人确认）：三个项目已**上传 + 绑定 + 发布**，项目 id 与 sha256 见 `HANDOFF.md` 顶部。

**未做**：批次 3（第 17 章）；
`VERIFY_MAX_CASES` 仍为 `1`。本批**不需要**改学生端引导 ⇒ 不动 workspace 镜像、不重打 kit。

---

## 0.3 批次 1 沉淀的经验（批次 2 直接照用）

1. **口径钉死 → 逐字段可比**：不需要"达标线"的实验（技能类、检索类、综合题）把清洗 / 判定 / 检索 /
   路由口径全部写进 `task.md`，结果就唯一确定，`assertions` 可以逐条比对；带达标线的实验
   （ML / 深度学习）才用"相对基线的比例"。
2. **判据只能看 `output.json`**：`assertions` 与 `judge` 都只拿到**产出文件**（judge 另有 `expected`），
   看不到 `SKILL.md`、也看不到中间产物 → **要判的东西必须进报告字段**。批次 1 用 `skill_card`
   把 description / 不适用场景 / 安全规则带进报告，就是这个原因。
3. **把"不确定"和"安全边界"做成判据**：材料里查不到依据时必须判 `unknown`（不许猜）、危急值必须
   逐条写出依据阈值、不许下诊断断言 —— 这比"跑通"更能说明学生读懂了口径。
4. **对照组的差距要由数据保证**：`keyword-search` 里"字符 2-gram 基线 `recall@3` 为 0"不是巧合，
   而是语料结构（每个主题 1 篇短精准 + 3 篇长综述）刻意造出来的；造数据时就把两端都量出来并写进 README。
5. **"看起来像、其实相反"的口径最有教学价值**：`flag` 用严格不等（等于参考上限算正常）、危急值用
   闭区间（等于危急阈值就报警）—— 这组对照是批次 1 最受欢迎的判据，批次 2 的 16 章可以照此做
   "更新前 / 更新后"的对照。
6. **参考实现随包下发 + 骨架留 TODO**：`problem/reference/` 既是学生的"先读后仿"材料，也是教师
   "题目可解性"的机器证明（拿它跑一遍复验即证）；骨架只留结构 + TODO + 解释层（原理一句 + 最小示例）。
7. **造题工具不下发**：`tools/gen_data.py` 负责"造数据 + 标定"，数据要么**显式写死**、要么**固定种子**，
   能重跑出逐字节相同的结果（判据才稳定）。
8. **图上的标题 / 轴标签一律英文**（镜像无中文字体，中文会渲染成方框）；中文解释写
   `figures[].takeaway` / `summary` / `notes`。
9. **复验用 pkg6、工作台用 pkg8**：`--check` 与参考实现复验都用 `nju-lab-verify:0.2.0-rc.2-pkg6`；
   只有"要改学生端引导文案"时才需要重建 workspace 镜像、重打 kit（批次 2 **大概率不需要**，见 §2）。
10. **收尾四件事**：实验 `README.md` 补「判据设计要点 + 出题时的实测依据 + 项目字段文案」→
    `server/fixtures/README.md` 表格加行 → `HANDOFF.md` 顶部加一条（用户要求 / 选定口径 / 实测数值 /
    产物与部署 / 未做）→ `git commit && git push`（先提交再 push；**别提交** `3.sh` 等他人未跟踪文件）。

---

## 1. 现状盘点（章节 × 实验覆盖矩阵）

| 章 | 章节 | 正文长度 | 现有实验 | 本路线图的安排 |
|---|---|---|---|---|
| 1 | 人工智能发展概论 | 1059 | — | **不做实验**（纯概念/历史） |
| 2 | 机器学习基本理论和实践 | 2174 | 3 个（回归 / 二分类 / 多分类） | 已覆盖 |
| 3 | 深度学习基本原理和实践 | 3693 | 3 个（MLP / CNN / 序列） | 已覆盖 |
| 4 | 大语言模型原理和实践 | 5629 | — | **批次 2（第一个做）**：注意力数值实验（+ 可选：下一个 token 分布） |
| 5 | 知识库概念和文本内容 | 2621 | 1 个（2026-10 落地） | 已覆盖 |
| 6 | 关系数据库 | 2198 | 1 个（2026-10 落地） | 已覆盖 |
| 7 | 向量数据库 | 2396 | 1 个（2026-10 落地） | 已覆盖 |
| 8 | 知识图谱 | 2755 | 1 个（2026-10 落地） | 已覆盖 |
| 9 | 综合实践：分子医学知识问答系统 | 2691 | 1 个（2026-10 落地） | 已覆盖 |
| 15 | 智能体：定义、框架与常用选择 | 2525 | — | **只做讨论作业**（选型主观，不进自动判分） |
| 16 | 记忆系统 Memory | 2021 | — | **批次 2**：记忆四操作（写入 / 检索 / 更新 / 遗忘）+ 三种上下文策略的取舍 |
| 17 | 工具扩展：MCP 服务 | 2171 | — | **批次 3（可选）**：解析型简化版 |
| 18 | 技能 Skill 的创建与使用 | 2314 | 1 个（2026-10 落地） | 已覆盖 |
| 19 | 智能体综合实践：分子医学学习助手 | 2152 | — | **批次 2（收官）**：迁移检验型综合任务 |

> 章节 order 是 **1–9 + 15–19**（10–14 是空号）。新增章节从 **order 20** 起排；
> 要塞进中间用 `POST /api/courses/:id/chapters/reorder`。
> 各章节 id（做实验时要用）：4 章 `df1a6ec0-a6d3-48e0-9bb0-0677a7094ad7`、
> 16 章 `8cf8c4fc-52c4-4059-b244-fbd810f60e7e`、19 章 `8fb368bb-e56a-4cd5-8e93-c0761792ec99`。

---

## 2. 平台约束（**设计前必读**：这批实验全部踩过或差点踩到）

| 约束 | 事实（2026-10 实测） | 对设计的影响 |
|---|---|---|
| **没有外网** | 工作台与复验容器都在 `--internal` 网络（`nju-verify-egress`），只放行模型 API 的 SNI 白名单；镜像只读、容器内 `pip install` 不可能成功 | 运行环境只能是**镜像预装 + 学生脚本自己搭**；`Neo4j / Milvus / Qdrant / Chroma / MCP SDK / mem0 / LangChain / Dify` 都**用不了** |
| **预装集** | `pkg6` 镜像：`pandas numpy scipy scikit-learn statsmodels matplotlib torch(CPU) openpyxl requests beautifulsoup4 lxml PyYAML tabulate pytest` + 命令 `jq unzip zstd`；另有 Python 标准库（`sqlite3` ✅、`networkx` ✅） | 优先选**已有依赖**；批次 2 三个实验只用到 `numpy`（4 章）+ `matplotlib`，其余纯标准库 |
| **产物契约** | 复验 = 逐 case 跑一轮 dsh（题干 + 学生 Skill）→ 与 `expected.*` 比对；`outputFile` 是**唯一**判分入口 | 交付物必须是"**能重建环境 + 产出一个结果文件**"的脚本化方案，不是"手工搭好的一次" |
| **判据分层** | 算术/事实 → `manifest.assertions`（JS 表达式，严格 `true`）；语义 → `judge.md`（LLM） | 数值达标线**绝不写进** `judge.md`（实测会被判通过）；结论里的数字**允许四舍五入**（实测误杀过一次） |
| **判据只能看产出文件** | `assertions` 拿到 `out` + `expected`；`judge` 拿到 `expected` + 产出文本；**两者都看不到 `SKILL.md` 与中间产物** | 要判的东西必须写进 `output.json` 的字段（批次 1 的 `skill_card` / `postings_checksum` / 逐题 `key_facts` 都是这么来的） |
| **`skill-template.zip` 根必须有 `SKILL.md`** | `--check` 会拒掉"没有唯一 SKILL.md 层"的包 | "第 19 章不给骨架"做不到 100% —— 现实做法见 §4.6：**给空壳结构 + TODO，但不放 `problem/reference/`** |
| **`VERIFY_MAX_CASES=1`** | `server/.env` 当前只跑 case01（成本开关）；教师本地自检跑的是全部 case | 想让平台跑全部 case → 改成 `0`（**未决事项，见 §6 第 2 项**） |
| **镜像 tag** | verify = `nju-lab-verify:0.2.0-rc.2-pkg6`；workspace = `nju-lab-workspace:0.2.0-rc.2-pkg8`（批次 1 后；pkg7 保留作回滚点） | 自检 / 复验命令都用 pkg6（见 §5）；**批次 2 不改客户端就不需要动 workspace 镜像** |
| **引导语已分三条流程** | `dsh/nju-lab-client/src/host/guidance.ts` 按「ML / 深度学习」「数据库 / 知识库」「**智能体 / 技能**」三条分支（第三条 2026-10-10 加入，已进 pkg8 与 kit） | 批次 2 的 **16 / 19 章正好走第三条分支**，无需再改客户端 —— 除非要改引导文案本身 |
| **章节正文可能"跑不通"** | 第 4 章**没有「动手实践」节**、也没讲"温度"；第 16 章点名 `mem0`；第 19 章阶段二用 `mem0` / MCP 工具 / LangChain-LangGraph；第 17 章让真搭 MCP 服务器 | 做实验时**要么在题干里换成本地等价物**，**要么同步修订正文**（见 §7 附录） |

---

## 3. 批次计划总览

| 批次 | 实验 | 一句话 | 依赖 | 风险 / 现状 |
|---|---|---|---|---|
| **1** ✅ | 18 技能 Skill：检验报告解读 | 交付一个真 Skill：报告 → 结构化解读 + 危急值 | 零新增 | **已完成并上线**（2026-10-10） |
| | 5 知识库：关键词检索 | 倒排索引 + BM25 检索，与"字符 2-gram"对照 | 零新增 | **已完成并上线** |
| | 9 综合实践：四形态问答原型 | SQL + 关键词 + 向量 + 图谱拼装，答案带出处 | 零新增 | **已完成并上线** |
| **2** ✅ | 4 LLM 原理：注意力 + 消融 + 采样 | `numpy` 手写缩放点积注意力 + 消融对照 + 采样分布 | `numpy`、`matplotlib` | **已完成并上线**（2026-10-10） |
| | 16 记忆系统：三种策略 + 更新/遗忘 | 窗口 / 摘要 / 检索三种策略的取舍，外加一次更新与一次遗忘 | 零新增 | **已完成并上线**（2026-10-10） |
| | 19 智能体综合实践 | **迁移检验**：四环闭环 + 出处 + 安全边界 | 零新增 | **已完成并上线**（2026-10-10；骨架取折中方案，见 §6 第 9 项） |
| **3** | 17 MCP：解析型简化 | tool-call 记录 → 校验/路由/mock 执行 | 零新增 | 高（与正文的"真搭 server"差距大） |

---

## 4. 各实验设计草案

> 每个草案给：**正文实况 / 任务形态 / 产物契约草案 / 判据草案 / 依赖 / 可抄样板 / 要同步的动作**。
> 具体数值（case 规模、断言条数、阈值）留给设计时标定 —— 照样板 README 记一张
> 「出题时的实测依据」表（含日期与实测数值）。

### 4.1–4.3 批次 1（✅ 已完成，2026-10-10）

`lab-report-reader`（第 18 章）、`keyword-search`（第 5 章）、`qa-prototype`（第 9 章）已落地并上线：
设计细节、判据要点与实测数值见各自的 `README.md`，运行态（项目 id / sha256）见 `HANDOFF.md` 顶部。
**开工批次 2 之前先通读这三个包的 `task.md` / `manifest.json` / `judge.md`** —— 它们比本文的草案更具体。

### 4.4 批次 2 · 第 4 章《大语言模型原理和实践》

**正文实况**（chapter id `df1a6ec0-a6d3-48e0-9bb0-0677a7094ad7`，5600 余字）：LSTM 的两个天花板 →
Token 与词表 → Embedding + 位置编码 → **注意力**（Q/K/V 三身份、`softmax(QKᵀ/√d)·V` 三步、
"为什么非要拆 QKV"、与 LSTM 门控的对照表、多头注意力）→ Transformer 架构 → 为什么能大规模并行 →
应用与医学场景 → **幻觉**的警示 → 与 ML / 深度学习对比总结。
**注意：这一章没有「动手实践」节，也完全没有讲"温度"**（"温度"属于另一门课
`34877023-33b3-4c37-8d62-4cb4d83df53b` 的《概率和温度》章节）。
→ 实验必须**从零设计**，且优先贴合正文已经讲透的机制。

**建议任务形态（两段，都要绑到"解释现象"，不能只交公式）**：

1. **手写缩放点积注意力 + 自检**：给一小段语料（几十个 token，虚构医学短句）+ **写死的** Q/K/V 权重矩阵，
   用 `numpy` 实现注意力（含**因果掩码**），产出形状、行和、掩码上三角是否为 0、输出校验和；
2. **消融对照（本实验的教学核心）**：把同一组数据跑三遍 —— ① 完整版；② **去掉 `√d` 缩放**；
   ③ **去掉因果掩码** —— 报告每种的 **softmax 最大行权重**与**行熵**，让"缩放 / 掩码各解决什么"
   变成可量化的差距（对应正文的两句论断）。

> （可选，见 §6 第 7 项）再做一段"预测下一个 token 的概率分布"：给固定 logits，报告 top-1 概率与熵，
> 并按不同"锐化系数"采样 N 次报告 `top1_ratio` 的变化 —— 但**正文没讲温度**，若要做，题干里用
> "预测下一个 token"的名义引入，别写成新概念。

- **产物契约草案**：
  `{"tokens":{"n_tokens","vocab_size","top_terms":[…]}, "attention":{"shape","row_sums","masked_upper_is_zero","output_checksum"}, "ablation":[{"variant","max_row_weight","entropy"}], "figures":[…], "notes":"…"}`
- **判据草案**：
  - 断言：`softmax` 行和 ≈1（容差 1e-6）、因果掩码后上三角全为 0、`output_checksum` 与 expected 一致、
    **消融的方向性关系**（去掉缩放的 `max_row_weight` 更大 / 熵更低；去掉掩码后"看到未来"的权重 > 0）、
    固定 seed 可复现、图 ≥1 张（含 `takeaway` ≥10 字）、`notes` ≥60 字；
  - judge：是否讲清 `√d` 与掩码**各自解决什么**（不写数字）、Q/K/V 为什么要拆成三副"眼镜"、
    有没有把"注意力 = 加权平均"讲成"某种黑箱"。
- **依赖**：`numpy`（已预装）+ `matplotlib`。
- **可抄样板**：`keyword-search`（"做法 + 对照 + 指标"型，`postings_checksum` 那套"口径钉死"的写法可直接搬）。
- **教学向注意**：别只让学生"照公式抄一遍" —— 题目必须要求**解释现象**（消融前后对比 + 图 + `takeaway`），
  这与正文"注意力是门控思想的扩编"的讲法呼应。

### 4.5 批次 2 · 第 16 章《记忆系统 Memory》

**正文实况**（chapter id `8cf8c4fc-52c4-4059-b244-fbd810f60e7e`）：分层记忆（工作 / 短期 / 长期 /
情景 / 程序）→ **四大操作**（写入 Store / 检索 Retrieve / 更新 Update / 遗忘 Forget）→ 医学典型用途 →
**教学示例**："给随访助手加上记忆"三步（设计记忆条目 → 写入 → 检索注入，提到 `mem0`）→
**课堂讨论**（隐私 vs 连续性照护、错误记忆 = 错误病史、遗忘的价值）→ 小结 / 思考题。

**建议任务形态（对齐正文的"四操作"，不要只做"三种策略"）**：给一段**多次随访对话**（含过敏史、
用药变更、一次"上次记错了"的更正、若干无关闲聊）+ 一组后续提问，要求学生：
① 抽取**记忆条目**（格式钉死：`{patient_id, fact, category, time, importance}`）；
② 实现**三种上下文组织策略** —— **窗口**（只留最近 N 条）/ **摘要**（压成一段）/ **检索**（按提问取相关条目）；
③ 每个提问输出"用到哪些记忆条目"（条目 id 列表）；
④ 处理一次**更新**（"二甲双胍停用、换用达格列净"）与一次**遗忘**（按重要性 / 时效阈值丢弃），
   报告更新 / 遗忘**前后**检索结果的变化。

- **产物契约草案**：
  `{"memory":{"window":[…ids],"summary":"…","retrieved":[{"query_id","entry_ids":[…]}]}, "answers":[{"query_id","answer","used_entry_ids":[…]}], "updates":{"applied":[…],"forgotten":[…],"before_after":[…]}, "metrics":{"recall_at_k_window","recall_at_k_summary","recall_at_k_retrieval"}, "figures":[…], "notes":"…"}`
- **判据草案**：
  - 断言：三种策略各自的 `recall@k` 与 expected 一致、每个提问命中的条目 id 集合一致、
    **"更新后旧条目不再命中、新条目开始命中"** 这类**行为性条件**（照批次 1 的"边界口径"思路设计）、
    遗忘后 `retrieved` 里不再出现被遗忘的条目 id、`before_after` 有实际差异、图与 `notes`；
  - judge：三种策略**各解决什么问题**（窗口省 token 却记不住久远信息、摘要丢细节、检索依赖判断相关性）、
    遗忘的代价与合规意义（数据最小化留存）、"错误记忆 = 错误病史"这条风险。
- **依赖**：零新增（纯标准库 + `matplotlib`）。
- **可抄样板**：`keyword-search`（多策略对照 + 指标 + 口径钉死）。
- **要同步**：正文教学示例里的 `mem0` 在本环境装不了 → 实验里改成"本地条目表 + 自己实现的检索"，
  正文补一句说明（见 §7）。

### 4.6 批次 2 · 第 19 章《智能体综合实践：分子医学学习助手》（**收官**）

**正文实况**（chapter id `8fb368bb-e56a-4cd5-8e93-c0761792ec99`）：项目目标（读实验数据 → 规划并执行
分析 → 检索文献 → **生成实验报告** → 记住学生进度与薄弱点）+ 四模块架构（感知 / 大脑 / 行动 / 记忆，
含一张架构图）+ 三阶段实施路径（阶段二用 **mem0 / MCP 工具 / LangChain-LangGraph 编排 / 报告生成 Skill**）
+ 验收标准（功能闭环 / 可溯源 / 安全边界 / 工程规范 / 演示答辩）+ **医疗安全红线**（定位、隐私、幻觉防控、
  人在回路）。

**形态特殊性（迁移检验位置）**：按 FRAMEWORK §3.5 的建议，这里**尽量不给答案** —— 只给需求 + 数据 +
交付契约，考察学生能否把前面学过的东西（记忆 + 工具 + 技能 + 检索 + 出处）自己组装起来。
这也是本课程的**收官实验**，判分口径需要教师先定（§6 第 4 / 9 项）。

**建议任务形态（最小闭环，五个"必须发生"）**：输入是一组固定的"学生提问 + 实验数据"，输出一份结构化
报告，其中必须出现：
① 一次**记忆**读写（跨两轮对话记住学生的薄弱点，并在第二次提问时应用）；
② 一次**工具调用**（本地 mock 工具名册：按 schema 校验参数、记录调用日志、失败要如实记 rejected）；
③ 一次**技能流程**（按报告模板生成"目的 / 方法 / 结果 / 讨论"四节）；
④ 一次**检索 + 出处**（引用段落号或数据文件名，格式钉死）；
⑤ **安全边界**（不下诊断结论；碰到危急值场景给出固定话术 / 升级动作，而不是照答）。

- **产物契约草案**：
  `{"report":{"sections":[{"name","content"}],"template_used":…}, "tool_calls":[{"tool","args_valid","result_summary"}], "memory":{"written":[…],"applied":[…]}, "citations":[{"kind","ref"}], "safety":{"refusals":[…],"escalations":[…]}, "figures":[…], "notes":"…"}`
- **判据草案**：
  - 断言：四环**都真的发生**（`tool_calls` 非空且 `args_valid` 全为真、`memory.written`/`applied` 非空、
    `report.sections` 覆盖模板要求的四节、`citations` 非空且 `ref` 非空）；**安全边界被触发**
    （`safety.escalations` 命中危急值场景、`refusals` 命中"要求下诊断"的提问）；`key_facts` 类字段
    与 expected 逐条一致；图与 `notes` 长度；
  - judge：每一环的**选择理由**是否说清、报告有没有把"检索结果"当"结论"、有没有正视局限
    （"记住一切"不现实、mock 工具不是真 MCP、没接大模型生成）。
- **依赖**：零新增（纯标准库 + `matplotlib`）。
- **可抄样板**：`qa-prototype`（多模块组装 + 逐题 `key_facts` + `sources` 形态 + 路径比对）——
  它的 `answers[].sources` 就是本实验 `citations` 的成熟写法。
- **⚠️ 两个必须先定的口径**（见 §6 第 4 / 9 项）：骨架给到什么程度、判分是否全自动。
- **要同步**：正文阶段二的 `mem0` / MCP 工具 / LangChain-LangGraph 在本环境都跑不通 → 正文补一句
  "实验环境用本地等价物（本地记忆表 / 本地 mock 工具 / 自己的编排脚本）"，题干里也要明说（见 §7）。

### 4.7 批次 3（可选）· 第 17 章《工具扩展：MCP 服务》

- **现实**：正文让学生**真搭一个 MCP 服务器**，但镜像里没有 MCP SDK、也没有外网 → 做不到。
- **折中形态**：给一段 **tool-call 记录**（JSON）→ 解析并**按 schema 校验参数** → 路由到本地 mock 工具
  → 支持**组合调用**（如"华法林 + 阿司匹林"要连查两个工具）→ 输出结果与调用日志。
- **判断**：可以做，但与正文的落差要**明说**（题干里写"本实验用本地 mock 代替真实 MCP 服务"），
  否则会让学生以为学的是协议实现。**建议先做批次 2，再决定要不要做它。**

---

## 5. 每个实验的通用落地步骤（照 CREATION-GUIDE，附本仓库实测命令）

```sh
# 0) 抄样板（按形态挑，见本文件开头那四个）
cp -r server/fixtures/keyword-search server/fixtures/<新实验名>    # "做法 + 对照 + 指标"型（4 章 / 16 章）
cp -r server/fixtures/qa-prototype  server/fixtures/<新实验名>    # "多模块组装 + 逐字段"型（19 章）
cp -r server/fixtures/lab-report-reader server/fixtures/<新实验名> # 技能 / 智能体类（口径钉死 + 技能卡）

# 1) 造数据（显式写死或固定种子，可重跑）
python3 server/fixtures/<fx>/tools/gen_data.py

# 2) 用参考实现重算 expected（**必须与复验同镜像**：统一用 pkg6）
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/<name>.py --regen-expected

# 3) 打包 + 结构/依赖自检（不烧 token，退出码 0 才算过）
cd server/fixtures/<fx> && rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 4) 参考实现复验（证明"题目可解 + 判据不误杀"，应 2/2）
cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low \
  -v "$PWD/server/fixtures/<fx>:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/<fx>.json --timeout-ms 300000

# 5) 上传 + 建项目 + 发布（教师账号；**先问操作人**）
TOKEN=$(curl -s -X POST http://127.0.0.1:3100/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | jq -r .data.accessToken)
curl -s -X POST http://127.0.0.1:3100/api/files -H "Authorization: Bearer $TOKEN" -F "file=@problem.zip"
curl -s -X POST http://127.0.0.1:3100/api/files -H "Authorization: Bearer $TOKEN" -F "file=@skill-template.zip"
# 用两个 fileId + chapterId 建项目，再 publish（字段文案见实验 README 的「项目字段文案」）
#   POST /api/projects   →  { title, chapterId, problemFileId, skillTemplateFileId,
#                             objectives, background, description, references, faq, evalConfig, rubric }
#   POST /api/projects/<id>/publish
```

**批次 1 用过的项目字段口径（照抄即可）**：`evalConfig = {model: "deepseek-flash", reasoningEffort: "low",
timeoutSeconds: 600}`；`rubric` = 复验通过率 50 / 能力边界与踩坑记录 30 / 判据语义项 20；
`unlockRule` 留空（走平台默认解锁规则）。

**每个实验的"完成定义"**（四条都做到才算完）：

1. `--check` 退出码 0（断言条数、用例齐全、依赖可用）；
2. 参考实现复验 **2/2 通过**、`hardChecks.failed` 为空、rationale 无"矛盾"类问题；
3. 平台侧已上传 + 绑定 + `published`（**上线前先问操作人**）；
4. 实验 README 里有「判据设计要点」+「出题时的实测依据（含日期与实测数值）」+「项目字段文案」。

**只有改客户端文案时才需要**（批次 2 大概率不需要）：改 `dsh/nju-lab-client` → 重建
`nju-lab-workspace:0.2.0-rc.2-pkg<N+1>` → 改 `workspace.config.ts` → `server npm run build` + kill 重启 →
重打 kit（`cd dsh/kit && PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh`）→ 投放
`/var/www/lab/kit/`。流程与坑见 `UPGRADE-playbook.md`。

---

## 6. 需要先决定的事（**开工前请教师/维护者拍板**）

| # | 事项 | 现状 / 选项 | 影响 |
|---|---|---|---|
| 1 | 第 18 / 16 / 19 章的引导流程 | ✅ **已决定并落地**（2026-10-10 加了第三条「智能体 / 技能类」分支，已进 pkg8 + kit） | 批次 2 不必再动客户端 |
| 2 | `VERIFY_MAX_CASES` | 仍为 `1`（只跑 case01）；(a) 保持；(b) 改 `0` 跑全部 case | 改了就影响**所有**实验，需要重启服务 |
| 3 | 第 9 / 17 章正文修订 | ✅ 第 9 章已改（Neo4j → `networkx`），第 7 / 8 / 18 章也已各补一句；**第 17 章未改**（批次 3 再说） | — |
| 4 | **第 19 章的判分口径** | (a) 全自动（断言 + judge）；(b) 自动 + 教师 rubric 权重更高 | 迁移检验型任务给不给参考实现，直接决定难度 |
| 5 | 第 17 章要不要平台加依赖 | (a) 做解析型简化；(b) 镜像加 `mcp` SDK 后再说 | 选 (b) = 重建两个镜像，且仍受"无外网"限制 |
| 6 | 测试账号遗留数据 | (a) 留着（作链路证据）；(b) 清掉（直接删 `submissions` / `evaluations` / `assignments` / `progress` 行） | 没有平台级"撤销提交"接口 |
| 7 | **第 4 章实验要不要含“温度 / 锐化系数”** | ✅ **已决定 (b)**（2026-10-10）：注意力 + 消融 + 下一个 token 的概率分布与采样；题干用「**锐化系数**」的名义引入 | 已落地为 `attention-ablation`（正文没讲“温度”，未新造概念） |
| 8 | **第 16 章是否要求实现“更新 / 遗忘”** | ✅ **已决定 (b)**（2026-10-10）：三种策略 + 更新 + 遗忘（对齐正文四操作） | 已落地为 `memory-strategies`，判据含“更新后旧条目不再命中”“遗忘后三种策略都取不到” |
| 9 | **第 19 章给不给骨架 / 参考实现** | ✅ **已决定**（2026-10-10）：折中 —— 学生侧只给空壳骨架，教师侧另建 `solution/`（不进 ZIP、不下发）跑复验 | 已落地为 `learning-assistant`：既保住迁移检验，又保住“题目可解 + 判据不误杀”的机器证明 |

---

## 7. 附录：章节正文里需要修订的措辞（做对应实验时一并改）

| 章 | 正文里写的 | 问题 | 状态 |
|---|---|---|---|
| 7 | 「动手实践」建议 Milvus Lite / Qdrant | 无外网装不上 | ✅ 2026-10-10 已补"实验里用离线可复现的等价实现" |
| 8 | 「动手实践」建议 Neo4j 社区版 | 无外网装不上 | ✅ 已补"用本地图库（`networkx`），见本章实验" |
| 9 | 「动手实践」让用 SQLite + **Neo4j** + 向量库 | 同上，且这章卡住代价最大 | ✅ 已改为 `networkx` + 词表/字符 2-gram 等价实现 |
| 18 | 「动手实践」里的 `hooks` 拦截危急值 | 平台无 hooks 运行时 | ✅ 已补「课堂说明」：实验里用 `critical_alerts` + 就医提示代替 |
| 16 | 教学示例用 `mem0` 存记忆 | 无外网、装不了 | ✅ 2026-10-10 已补「课堂说明（关于实验环境）」：实验用“本地条目表 + 自己实现的检索” |
| 19 | 阶段二用 `mem0` / MCP 工具 / LangChain-LangGraph / 文献 PDF | 这几个在本环境都用不了 | ✅ 2026-10-10 已补「课堂说明（关于实验环境）」：改成“本地记忆表 / 本地 mock 工具 / 自己的编排脚本”，并说明与真实工程方案的差距 |
| 4 | 全章没有「动手实践」节 | 实验做出来后学生找不到入口 | ✅ 2026-10-10 已在章末补「九、动手实践」，指向本章实验（注意力 + 消融 + 采样） |
| 17 | 「动手实践」让真搭 MCP 服务器 | 无 SDK、无外网 | ⏳ 批次 3 再决定（改成本地 mock 版，或明说环境限制） |

> 改这些正文属于**教师向内容维护**（不算历史快照，`docs/ACCEPTANCE-*.md` 等不动，见 `AGENTS.md`）。
> 改法照批次 1：用 `.kimi-code/skills/update-chapter`（`node … --id <chapterId> --file <新正文>`），
> 先 `mysql` 导出原文 → 精确替换 → 写回 → 回读校验。

---

## 8. 开新 session 的第一小时（批次 2 版）

> **批次 2 已落地（见 §0.2）**：若只是要把它上线，直接看 §5 步骤 5；若要开**批次 3（第 17 章）**，
> 从下面第 1 步重新走一遍（草案见 §4.7）。

1. 读 `AGENTS.md` + 本文件（重点 §0.2 落地记录 + §0.3 经验、§2 约束、§4.7 草案）+ `HANDOFF.md` 顶部（运行态）；
2. **先问操作人 §6 里仍未定的事项**（第 2、5、6 项；第 7 / 8 / 9 项已随批次 2 决定）；
3. 通读可抄样板（别只读一份）：
   ```sh
   cp -r server/fixtures/keyword-search /tmp/sample-metrics && \
   cp -r server/fixtures/qa-prototype  /tmp/sample-assembly
   ```
   各通读 `problem/{task.md,judge.md,manifest.json}` 与 `problem/reference/`（读参考实现比读文档快）；
4. 从 §5 步骤 0 起目录骨架 → 先写 `tools/gen_data.py`（**造数据时就把两端的成绩量出来**）→
   写参考实现 → `--regen-expected`；
5. 每个实验走完 §5 的 1→4（`--check` 退出码 0 + 复验 **2/2**），**先问操作人**再上传发布；
6. 收尾：实验 `README.md`（判据要点 + 实测依据 + 项目字段文案）→ `server/fixtures/README.md` 表格加行 →
   `HANDOFF.md` 顶部加一条（用户要求 / 选定口径 / 实测数值 / 产物与部署 / 未做）→ `git commit && push`；
7. 正文修订照 §7 附录（16 / 19 章的 `mem0` 等本地等价物说明、4 章补「动手实践」节）。
