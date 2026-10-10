# NJU-Lab 开发交接（Handoff）

> 写给接手对话：本文档包含继续开发所需的全部上下文。先读本文件，再按需读 `nju-lab-craft.md`（系统设计总文档）。
> 更新时间：2026-09-28（工作台交接）

## 0. 一句话现状

**2026-10（批次 2：第 4 / 16 / 19 章）：三个实验包 + 三章正文修订 + 平台上线（均已实测）** ——
**用户要求**：按 `docs/PLAN-2026-10-experiment-roadmap.md` 的**批次 2**（4 LLM 原理 → 16 记忆系统 →
19 智能体综合实践）依次落地。**用户选定三件口径（路线图 §6 第 7/8/9 项）**：
① 第 4 章实验**含**"下一个 token 的概率分布 + 采样"（正文没讲"温度"，题干用「**锐化系数**」的名义引入，
不新造概念）；② 第 16 章**做满正文的"四操作"**（写入 / 检索 / **更新** / **遗忘**），
不只是"三种上下文策略"；③ 第 19 章走**折中方案** —— 学生只拿空壳骨架（`problem.zip` 里**没有** `reference/`），
教师侧另建 `solution/`（不进任何 ZIP、不下发）用于跑复验。

- **三个实验包**（`server/fixtures/`，形态与前两批一致，**零新增镜像依赖**）：

  | 实验 | 应用 | 断言 | 参考实现复验（本机实测 2026-10-10） |
  |---|---|---|---|
  | `attention-ablation` | 手写缩放点积注意力 + 三档消融（去 √d 缩放 / 去因果掩码）+ 下一个 token 的采样 | 14 | **2/2 pass、硬性 14/14**，单轮 58s / 33s |
  | `memory-strategies` | 随访记忆四操作 + 窗口 / 摘要 / 检索三策略对照 + before/after | 13 | **2/2 pass、硬性 13/13**，单轮 58s / 45s |
  | `learning-assistant` | 四环闭环 + 行级/段级出处 + 安全边界（收官 · **迁移检验**） | 12 | **2/2 pass、硬性 12/12**，单轮 64s / 49s |

  实测口径（各实验 `README.md` 有完整表）：`attention-ablation` case01 校验和 `8d16d6b80dda`、
  去缩放 `max_row_weight` **0.2761 → 0.4329**、行熵 **2.2074 → 1.7238**、去掩码 `mean_future_weight` **0.4725**、
  采样 `top1_ratio` **0.745 / 0.540 / 0.360**（锐化系数 0.5 / 1.0 / 2.0）；
  `memory-strategies` case01 7 条条目（4 active / 1 superseded / 2 forgotten）、
  三策略 `recall@k` **0.3 / 0.7 / 0.8**、`before_after` 里 Q04 `[M02,M06] → []`；
  `learning-assistant` case01 6 次调用（**4 executed / 2 rejected**：`missing_required` + `type_mismatch`）、
  2 行越界（`R02` / `R06`）、引用 4 条（2 data + 2 passage）、拒答 1 条（Q03）。

- **关键设计决策（写后续实验时照做）**：① 第 4 章把输入**全部写死**（小数固定 3 位）⇒
  注意力校验和与 `top_attend`（每行最关注的列号）**跨平台逐位可比**；连续量（消融统计量）用
  **容差 + 方向性**双判（后者比数值更能说明读懂了口径）；② 第 16 章把"**更新后旧条目不再命中**、
  **被遗忘的条目在三种策略里都取不到**、**before/after 至少有一题不同**"做成**行为性判据**，
  并设了一处**边界口径**（遗忘**只处理 `active`** ⇒ 被更正的 `superseded` 不会被顺带遗忘）；
  ③ 第 19 章的**迁移检验**用教师侧 `solution/` 保住完成定义里的"参考实现复验 2/2"
  （已用 `unzip -l problem.zip` 核对：题包里**没有** `solution/`、也**没有** `reference/`）；
  ④ 三章正文修订照批次 1 的 `.kimi-code/skills/update-chapter`（导出 → 精确替换 → 写回 → 回读校验）。

- **章节正文修订（2026-10-10，教师向内容维护，非历史快照）**：
  第 4 章章末**新增「九、动手实践」**一节，指向本章实验（手写注意力 + 消融 + 采样，说明只用
  `numpy`/`matplotlib`、不联网、不训练）；第 16 章教学示例补「**课堂说明（关于实验环境）**」——
  `mem0` 装不上 ⇒ 实验用"本地条目表 + 自己实现的检索"，四种操作与三种策略照正文口径做一遍；
  第 19 章阶段二末尾补同类说明 —— 本地记忆表（代替 mem0）/ 本地 mock 工具（代替 MCP）/
  自己的编排脚本（代替 LangChain-LangGraph），并点明"换到真实工程时替换即可、接口一一对应"。
  三章回读校验：13549→15273 / 4827→5421 / 4958→5794 字节。

- **产物与部署（2026-10-10，教师账号上传 + 绑定 + 发布，**已实测**）**：三个包已上传（各拿 `fileId` 与
  `sha256`）并建成项目，分别挂在课程《分子医学人工智能理论与实验》的**第 4 / 16 / 19 章**下，
  `status=published`、`unlockRule=NULL`（默认解锁规则）、
  `evalConfig = {model: deepseek-flash, reasoningEffort: low, timeoutSeconds: 600}`、
  `rubric` = 复验通过率 50 / 能力边界与踩坑记录 30 / 判据语义项 20：

  | 项目 | id | 章节 | 题目包 sha256（前 12 位） | Skill 模板 sha256（前 12 位） |
  |---|---|---|---|---|
  | 大语言模型实验：手写缩放点积注意力 + 三档消融 + 下一个 token 的采样 | `75fcf6fe-2680-4ddd-aecc-8a6fbd1aadca` | 第 4 章 | `178a75a45e84` | `f84f8b51457c` |
  | 记忆系统实验：记忆四操作 + 三种上下文策略的对照（窗口 / 摘要 / 检索） | `104ecd33-589a-4eb0-b0e0-c9d53b0a03b3` | 第 16 章 | `db9ed7311db2` | `a5e1d27926f7` |
  | 综合实践（收官）：分子医学学习助手 —— 四环闭环 + 出处 + 安全边界 | `a42bb532-364e-4872-8b2f-6e47dd433048` | 第 19 章 | `e92cf6d8737b` | `770165ab0a28` |

  复核：`GET /api/projects?courseId=cd11ea33…` 返回 **17 个项目**（含本批 3 个，均 `published`、
  两个 `fileId` 绑定与上传结果一致）。本批**不需要**改学生端引导文案 ⇒ **不动 workspace 镜像、不重打 kit**
  （仍为 `pkg8` / `20261010-1456-ef6e154`）。
- **未做**：批次 3（第 17 章 MCP）；`VERIFY_MAX_CASES` 仍为 `1`（平台只跑 case01，**本次经操作人确认保持**）；
  测试账号遗留数据未清理。

---

**2026-10（批次 1：第 18 / 5 / 9 章）：三个实验 + 学生端第三条引导分支 + 平台上线（均已实测）** ——
**用户要求**：按 `docs/PLAN-2026-10-experiment-roadmap.md` 的**批次 1**（18 技能 → 5 知识库 → 9 综合实践）
依次落地；**一路做到平台上传 + 绑定章节 + 发布**；学生端引导**新增第三条「智能体 / 技能类」分支**。

- **三个实验包**（`server/fixtures/`，形态与既有实验一致：模板 + 题目包 + 参考实现随包下发 + 骨架留 TODO）：

  | 实验 | 应用 | 断言 | 参考实现复验（本机实测 2026-10-10） |
  |---|---|---|---|
  | `lab-report-reader` | 检验报告解读 Skill（口径比对 + 危急值拦截 + 技能卡） | 12 | **2/2 pass、硬性 12/12**，单轮 68s / 55s |
  | `keyword-search` | 文献库关键词检索（倒排索引 + BM25 + 字符 2-gram 对照） | 12 | **2/2 pass、硬性 12/12**，单轮 98s / 35s |
  | `qa-prototype` | 分子医学知识问答原型（四形态各用一次 + 出处可溯源） | 12 | **2/2 pass、硬性 12/12**，单轮 85s / 99s |

  实测口径（各实验 `README.md` 有完整表）：`lab-report-reader` case01 报告单 15 行 → 13 项（12 可判定 + 1 表外）、
  丢弃 1 非法 + 1 重复、危急值 3 个（`K` 6.2 / `PLT` 28 / `WBC` 1.2）、含 2 个"恰好等于边界"的项；
  `keyword-search` BM25 `recall@3` **0.875 / 0.75** vs 字符 2-gram **0.0 / 0.0**（校验和 `5cf9366e3cbe` / `2b737e9fc1ed`）；
  `qa-prototype` 路由分布 sql 1 / keyword 1 / vector 1 / graph 2，Q04 是 3 跳链（`BRCA1` → … → `olaparib`）。
  三个包 `--check` 均 ok（退出码 0）。

- **关键设计决策（写新实验时照做）**：① **口径钉死 → 逐字段可比**（技能类的 `skill_card`、检索类的
  `postings_checksum`、综合题的逐题 `key_facts` 都是钉死的字段，判据才逐条可比）；② **把"不确定"与
  "安全边界"做成判据**（参考区间表里没有的项目必须判 `unknown`、危急值必须进 `critical_alerts` 并写出依据阈值、
  不许下诊断断言）；③ **对照组本身是要交的东西**（`recall_at_3_bm25 > recall_at_3_bigram` 是硬性断言，
  而差距来自语料结构：每个主题 1 篇短精准 + 3 篇长综述）；④ 全程**零新增镜像依赖**。

- **学生端引导（`dsh/nju-lab-client/src/host/guidance.ts`）**：常驻段与 skill 手册**新增第三条分支**
  「智能体 / 技能类」（看清需求 → 摸清材料与判定口径 → 搭最小闭环（`SKILL.md` + `scripts/`）→ 逐个模块跑一遍 →
  用例自测 + 补「能力边界 / 实测档案」→ 结论），并加了三条提醒（`description` 是触发路由、
  确定性任务下沉脚本、安全边界要落成输出字段）。`npm run typecheck` / `build` / `test` 通过
  （**59 pass / 0 fail / 6 skip**，与既往一致）。

- **产物与部署（已实测）**：
  - 新建 **`nju-lab-workspace:0.2.0-rc.2-pkg8`**（`docker build -f server/workspace-image/Dockerfile -t … .`）；
    容器内 `lib/host/index.js` 含新文案（`智能体 / 技能类` 命中、`数据库 / 知识库类` 4 处、`引导监督模式` 2 处）；
    **pkg7 保留作回滚点**；
  - `workspace.config.ts` 默认镜像切到 **pkg8** → `server` `npm run build` + kill 重启（systemd `Restart=always`
    拉起新 PID 1901176）；冒烟：`/lab/` **200**、起工作台容器打印 `[nju-lab-client] host half loaded` +
    `WORKSPACE_READY port=9090` ✓；
  - **学生 kit**：`cd dsh/kit && PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh` →
    `kit-version=20261010-1456-ef6e154`；已备份旧版（`…zip.20261010-1010-97f36b6.bak`）后投放到
    `/var/www/lab/kit/nju-lab-student-kit.zip`（HTTP 200、与本地产物逐字节一致）。

- **已上线（2026-10-10，教师账号上传 + 绑定 + 发布）**：三个项目分别挂在课程《分子医学人工智能理论与实验》的
  **第 18 / 5 / 9 章**下，`status=published`、`unlockRule=NULL`（默认解锁规则）、
  `evalConfig = {model: deepseek-flash, reasoningEffort: low, timeoutSeconds: 600}`、
  `rubric` = 复验通过率 50 / 能力边界与踩坑记录 30 / 判据语义项 20：

  | 项目 | id | 章节 | 题目包 sha256（前 12 位） | Skill 模板 sha256（前 12 位） |
  |---|---|---|---|---|
  | 技能实验：检验报告解读 Skill（口径比对 + 危急值拦截 + 技能卡） | `72a0cbb7-7067-4e59-bf3b-b17fc6e6976b` | 第 18 章 | `a314355bcdb4` | `9bb65fd78915` |
  | 知识库实验：倒排索引 + BM25 检索（含字符 2-gram 对照与 recall@3） | `b27248e8-76dc-4518-ad01-0758a40e433b` | 第 5 章 | `b5a728f2495e` | `e4f57bfa60ca` |
  | 综合实践：分子医学知识问答原型（四形态各用一次 + 出处可溯源） | `2ea22105-7c73-41fe-a93f-eb66eff3a400` | 第 9 章 | `90be4011e5b1` | `f57dfa31308d` |

- **章节正文修订（2026-10-10，教师向内容维护，非历史快照）**：第 18 章补「hooks 是宿主平台的能力」课堂说明
  （实验里用 `critical_alerts` + 就医提示代替拦截）、动手实践第 2 条改成"危急值提示"；第 9 章把
  Neo4j / Milvus / Qdrant 换成 `networkx` + 字符 2-gram 等价实现；第 7/8 章各加一句"实验里用离线可复现的
  等价实现，见本章实验"。
- **未做**：路线图批次 2（第 4 / 16 / 19 章）与批次 3（第 17 章）未开工；`VERIFY_MAX_CASES` 仍为 `1`
  （平台只跑 case01）；测试账号遗留数据未清理。

---

**2026-11（数据库章）：第 6/7/8 章（关系数据库 / 向量数据库 / 知识图谱）各落地一个实验 —— 三个实验包 + 学生端引导分支 + 平台上线（均已实测）** ——
**用户要求**："在关系数据库、向量数据库、知识图谱课程下增加新的实验课程，目的是入门 —— 通过我们的 dsh
智能体搭建基本的运行环境，然后通过课程教练辅助用户实现对数据的增删改查"。**用户选定三件事**：
① 挂到课程《分子医学人工智能理论与实验》的**第 6/7/8 章**（`63d6f6bc` / `3d52759a` / `f156b286`）各一个实验；
② **零新增镜像依赖**（关系库用标准库 `sqlite3`、向量库用词表计数 + `math`、图谱用镜像已有的 `networkx`）；
③ **改造学生端「引导监督模式」**（按实验类型分支）+ 重建 workspace 镜像与 kit。

- **三个实验包**（`server/fixtures/`，形态与既有实验一致：模板 + 题目包 + 参考实现随包下发 + 骨架留 TODO）：

  | 实验 | 应用 | 断言 | 参考实现复验（本机实测 2026-10-10） |
  |---|---|---|---|
  | `sql-crud` | 检验数据登记与查询（建库 + SQL 增删改查） | 12 | **2/2 pass、硬性 12/12**，单轮 dsh 59s / 65s |
  | `vector-search` | 相似病例语义检索（向量化 + Top-K + 关键词对照） | 12 | **2/2 pass、硬性 12/12**，单轮 40s / 40s |
  | `kg-alerts` | 用药安全预警（三元组建图 + 多跳路径） | 11 | **2/2 pass、硬性 11/11**（case02 judge 0.95），单轮 63s / 93s |

  实测口径（各实验 `README.md` 有完整表）：`sql-crud` 入库 39/43/101（case01，丢弃 19 无效 + 10 重复）；
  `vector-search` 向量 recall@3 **0.6464** vs 关键词 **0.1278**（case01）；`kg-alerts` 禁忌预警 **5→4**、
  相互作用 **5→6**（case01，撤销医嘱 / 补录患者各体现一处变化）。三个包 `--check` 均 ok（退出码 0）。

- **关键设计决策（写新实验时照做）**：
  ① **"没有外网"决定技术方案**：工作台与复验容器都在 `--internal` 网络里，**不能联网装包** ——
     "dsh 搭运行环境"只能落成「镜像预装 + 学生脚本自己搭」（`sqlite3` 建库文件 / 词表向量化后存起来 /
     三元组建图）；题干里明确写了这一条，否则学生会在工作台里试着 `pip install neo4j` 而卡住；
  ② **把"约束会拒绝坏数据"做成硬判据**：`sql-crud` 的更正单里故意放一条引用不存在就诊的报告
     （正确实现必须被外键拒绝 → `rejected_orphan_labs === 1`）；`kg-alerts` 的更新单里放一条违反本体的更新
     （→ `rejected_updates === 1`）—— 这比"能跑通"更能证明学生真的建了约束；
  ③ **口径钉死 → 逐字段可比**：这类实验不需要达标线，把清洗 / 更新 / 查询口径写死在 `task.md`，
     结果唯一确定，`assertions` 逐条比对（`sql-crud` 因此成为"口径驱动 + 参考实现随包下发"的新样板）；
  ④ **判据分层不变**：算术/事实给 `assertions`，语义（设计是否合理、机制是否讲清、局限）给 `judge.md`；
     本轮还**统一了 judge 的措辞**：结论里的数字**允许四舍五入**（否则"0.43 vs 0.4345"会被误判为矛盾 ——
     实测真的误杀过一次）；精确数值一律由断言负责。
- **学生端引导（`dsh/nju-lab-client/src/host/guidance.ts`）**：常驻段与 skill 手册改为**按实验类型分支** ——
  ML / 深度学习走原六步；**数据库 / 知识库类**走「看需求 → 摸清数据（或看懂词表 / 本体）→ **搭结构与环境** →
  **增删改查** → 验证查询（JOIN / 相似度 / 多跳）→ 结论」，并加了两条提醒（**环境要能由脚本重建**、
  **约束拒绝是现象不是 bug**）。`npm run typecheck / build / test` 通过（**59 pass / 0 fail / 6 skip**，
  与既往一致 —— 6 条 L2 因本机无 `DSH_BIN` 静默 skip）。
- **产物与部署（已实测）**：
  - 新建 **`nju-lab-workspace:0.2.0-rc.2-pkg7`**（`docker build -f server/workspace-image/Dockerfile -t … .`，
    体积 2.29GB，与 pkg6 持平）；容器内 `lib/host/index.js` 含新文案（`数据库 / 知识库类` 命中 4 处、
    `引导监督模式` 2 处、旧硬禁令 0 处）；**pkg6 保留作回滚点**；
  - `workspace.config.ts` 默认镜像切到 **pkg7** → `server` `npm run build` + kill 重启（systemd `Restart=always`
    拉起新 PID）；冒烟：`/lab/` **200**、起工作台容器打印 `[nju-lab-client] host half loaded` +
    `WORKSPACE_READY port=9090`、`enter` → **302（种 cookie）** → 带 cookie **200** ✓（冒烟容器已 stop）；
  - **学生 kit**：`cd dsh/kit && PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh` →
    `kit-version=20261010-1010-97f36b6`；已备份旧版（`…zip.20261010-0925-a9436ff.bak`）后投放到
    `/var/www/lab/kit/nju-lab-student-kit.zip`（与本地产物逐字节一致，HTTP 200）。
- **已上线（2026-10-10，教师账号上传 + 绑定 + 发布，用户确认口径为「默认解锁规则」）**：
  三个项目分别挂在课程《分子医学人工智能理论与实验》（`course-cd11ea33`）的**第 6/7/8 章**下，
  `status=published`、`unlockRule=NULL`（默认规则：完成该章之前的全部已发布章节）、
  `evalConfig = {model: deepseek-flash, reasoningEffort: low, timeoutSeconds: 600}`、
  `rubric` = 复验通过率 50 / 能力边界与踩坑记录 30 / 判据语义项 20：

  | 项目 | id | 章节 | 模板 / 题目包 sha256（前 12 位） |
  |---|---|---|---|
  | 关系数据库实验：检验数据登记与查询 | `b17ab3b1-5ec2-4ef3-83dd-ee1d69abd12b` | 第 6 章（`63d6f6bc`） | `625a2337f6f1` / `4aa462d8fed3` |
  | 向量数据库实验：相似病例语义检索 | `4162a62f-a19d-4333-b1b2-55f225d647d8` | 第 7 章（`3d52759a`） | `e0cd457c410b` / `8ecbcedda3c7` |
  | 知识图谱实验：用药安全预警 | `d2dd45f9-5168-4070-96cb-b2f7389dbc3e` | 第 8 章（`f156b286`） | `b5e626aeb9f1` / `ac3c18259490` |

  · 三个项目发布时已给学生分发 `assignments`（1 位学生 3 条 `pending`）。
  · **验证**：用教师 token 下载 6 个 fileId 与本地 zip 逐字节比对，**全部一致** ✅。
  · **闭环验证（2026-10-10，用测试账号 student1 走的真实链路，不是本地模拟）**：
    ① 用**真实插件**（`dsh/nju-lab-client/lib/host/index.js` 的 `apply` + `nju_lab_claim` /
    `nju_lab_submit`，直接打真实平台）把三个实验各提交一次 —— 模板与题目包下载 **sha256 校验通过**、
    打包 + `.dshc` + 上传 + 提交都成功；
    ② **解锁规则实测生效**：完成第 1~5 章前第 6 章实验 `unlocked=false` → 完成第 6 章后第 7 章才解锁，
    以此类推（`POST /api/chapters/:id/complete` 是学生可用的正常功能，测试里就是这样推进的）；
    ③ 教师 `POST /api/submissions/:id/verify` 触发**平台侧容器复验**：三个实验 `successRate=1`、
    `exitCode=0`、单 case 43~67s，`integrityCheck = {capsuleHashVerified: true,
    selfReportVsRerun: "consistent", filesMatched: 2}`；教师 `grade` 也走通（teacherScore 95），
    学生端能读到反馈 ✅。
    · ⚠️ 平台当前 `server/.env` 里 **`VERIFY_MAX_CASES=1`**，所以**平台侧每个提交只跑 case01**
    （本地教师自检跑的是 2/2）。要让平台跑全部 case，把该值改成 `0`（成本控制开关，本次未动）。
  · 未做：`deadline` 未设；上述提交留在测试账号（student1）名下，作为链路证据。
- **文档同步（2026-10-10 续）**：FRAMEWORK / PACKAGE-SPEC / `server/README.md` / `fixtures/README.md`
  里的镜像 tag 从 `pkg4` 统一为当前的 `pkg6`（PACKAGE-SPEC §4 补了"预装集未变"的版本沿革说明）；
  各**历史实验自带 README 里带日期的实测记录仍保留 pkg4**（AGENTS.md 纪律：历史快照不改）。
- **纪律**：`docs/ACCEPTANCE-*.md`、带日期的实测快照、已存在的镜像制品名一律保留原样；
  三个新实验的 `tools/`（造题工具）**不打包、不下发**。

**2026-11（续）：工作区 LLM 从「教练模式」改成「引导监督模式」—— 学习过程，不是考察过程** ——
**用户提出的口径**："不要太死板，就是要引导学生走一个流程，但不要求学生必须做一些重要决定，
目的是为了引导学生熟悉一个过程 —— 如何分析应用场景、最后如何获得结果和交付；本质上还是**学习**
的过程，而不是**考察**的过程。" **做法**（用户选定：只改学生端 LLM 人设 + 全仓库统一改称
「引导监督模式」）：
① `dsh/nju-lab-client/src/host/guidance.ts` 的常驻 system prompt 段与 skill 手册重写为**四条分寸** ——
   **引导**（六步每一步先说清"这一步在干什么、为什么要有这一步"）、**不必卡决定**（选模型 / 定基线
   他拿不准就**直接给建议甚至替他定好**，并说清理由）、**别把流程糊掉**（每一步真的跑、结果真的
   看得见，不能一口气做完只回一句"已完成"）、**监督是流程层面的**（跳步 / 漏了评估或结论 /
   交付物不齐 → 直接指出并说明为什么要补，是提醒不是评分）。
   旧「教练立场」里的硬禁令（"第一个回应必须是提问""不给整段实现""要答案先反问""判断由学生自己写"）
   **撤掉** —— 考试式的逼问、"必须学生自己想出来"不再是要求。
② **"监督"落在流程与交付，不落在判分**：`notes` / `figures.takeaway` / `SKILL.md` 实测档案
   **最好由学生写**，模型给结构、给例子、帮他改（原文口径是"由学生自己写、不许代写"）。
③ **文档同步更名**：FRAMEWORK §3.5 第 8 件改写为「引导监督模式」（定位一段重写）；
   CREATION-GUIDE §1 第 2 条与坑表（`教练指令污染复验` → `引导指令污染复验`）跟着改。
   **带日期的历史条目（2026-10-31 / 2026-11）保持原样**，按 AGENTS.md 纪律不动。
④ **隔离不变**：`nju-lab-client` 只装学生端，**复验容器不装**（verify profile 里没有它）。
⑤ **产物与上线（已实测）**：
   - 客户端 `npm run typecheck / build / test` 通过 —— **59 pass / 0 fail / 6 skip**
     （6 条 L2 因本机无 `DSH_BIN` 静默 skip，与既往一致）；
   - **workspace 镜像 `nju-lab-workspace:0.2.0-rc.2-pkg6`**：`server/workspace-image/Dockerfile` 的
     `FROM` 同步升到 `nju-lab-verify:0.2.0-rc.2-pkg6`（与复验同运行时），体积 **2.29GB**，
     **pkg5 保留作回滚点**；`workspace.config.ts` 默认镜像切到 pkg6 → `npm run build` + kill 重启
     （systemd 按 `Restart=always` 拉起）。容器内已验证 `lib/host/index.js` 含新文案、旧硬禁令为 0；
   - **学生 kit**：`cd dsh/kit && PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh` →
     `kit-version=20261010-0925-a9436ff`；已先备份 + 投放到 `/var/www/lab/kit/nju-lab-student-kit.zip`
     （与 `dsh/kit/dist/` 逐字节一致）；
   - **冒烟**：`http://127.0.0.1/lab/` → **200**；本地起 pkg6 容器打印
     `[nju-lab-client] host half loaded` + `WORKSPACE_READY port=9090`，
     token → 303（种 cookie）→ 带 cookie **200** ✓。
   - ⚠️ 重启会让已有工作台容器走 reclaim（镜像变了），**在线学生的会话需重新进入**。

**2026-11（深度学习章）：第三章「深度学习」三个实验落地 + 复验镜像 pkg6（judge token 预算）** ——
**用户要求**："参考 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §3.5 设计第三章 深度学习课程的相关实验"，
交付形态选定"**直接落成可上传的完整实验包**"，范围选定"**MLP + CNN + 序列**"，
数据选定"**通用公开型小数据**"（其中序列实验按用户意见从"文本分类"改为"**传感器时序 + LSTM**"：
分词/词表/OOV 太琐碎，时序更贴"序列建模"这个知识点，CPU 开销也更小）。

- **三个实验**（`server/fixtures/`，形态与 `aq-forecast` 一致：应用驱动 + 参考实现随包下发 + 骨架留解释层）：
  每一个都是"**一个应用问题 + 完整六步流程**"（① 看清需求 → ② 看一眼数据并画图 → ③ 定基线 →
  ④ 训练模型 → ⑤ 评估并画图 → ⑥ 写结论），差别在**应用与数据**：
  | 实验 | 应用与数据 | 规模/特点 | 达标线（参考实现水平） |
  |---|---|---|---|
  | `dl-train-diagnose` | 产线**来料自动分检**（表格数据二分类） | 公开数据集 `load_breast_cancer`（按"形态测量量"使用）；569/320 件，第二批模拟"另一台测量仪"（量程差两个数量级、缺陷件 22%） | case01 recall ≥0.90、case02 ≥0.85，precision 均 ≥0.80（参考 0.96/0.94） |
  | `dl-cnn-images` | 表单**手写数字分拣**（8×8 小图十分类） | 公开数据集 `load_digits`；1797/1639 张，第二批平移 1px + 噪点 + 0/8 更少 | macro F1 ≥0.93 / ≥0.85，逐档召回 ≥0.85 / ≥0.65（参考 0.982 / 0.946） |
  | `dl-rnn-forecast` | 车间**设备温度提前一分钟估计**（传感器时序） | 合成教学时序；1500/1200 分钟，工作循环 45/37 分钟 | MAE ≤0.55×基线 / ≤0.60×基线（参考比值 0.18 / 0.40） |
- **判据分层**（§5.1）：每个实验 **13 条确定性断言**（达标线、防退化、基线可信、**`training.history` 逐轮 `loss`/`val_loss` 硬性要求**）+ `judge.md` 语义项。
  "必须真的训练"因此成了机器可查的条件（一次求解的模型给不出逐轮 `val_loss`）。
- **实测（不是推测）**：三个实验都在**同一个镜像**里用参考实现跑过端到端复验，**6/6 case pass、硬性断言 13/13**；
  单轮 dsh 耗时 46~208s（贴 300s 单轮上限的浮动风险见各 README）。
  每个 README 都带一张"**出题时的实测依据**"表（同一切分下量出不建模 / 只看当前行 / 用窗口等各档差距），
  用于复核"达标线能分开不做与真做"。
- **平台侧改动：复验镜像 `nju-lab-verify:0.2.0-rc.2-pkg6`**（`docker-evaluation-runner.ts` 默认镜像已切，服务已 build + 重启）：
  judge 请求的 `max_tokens` **2048 → 4096**。原因：deepseek-flash 带 reasoning 时 2048 会被**推理**吃满，
  返回 `finish_reason=length`、`content` 为空 → 整轮报 `judge output not parseable`，且随判据/产物体积波动而**偶发**
  （实测实验一通过、实验二/三在临界区抖动）。构建方式：`FROM pkg5` 只覆盖 `run-eval.mjs`（体积持平 2.17GB，无需压平），
  细节见 `server/verify-image/README.md` 与 `docs/UPGRADE-playbook.md` §5。**pkg5 保留作回滚点**。
- **2026-11（续）按 `docs/EXPERIMENT-CREATION-GUIDE.md` 对齐**：
  ① 实验一场景改为**产线来料自动分检**（数据不变，只把标签 `malignant` → `defect`、去掉医学措辞，符合指南"零领域门槛"）；
  ② 三个骨架 `scripts/train.py` 的 TODO 收成**两处**（基线 + 串联流程），绘图等由学生自己写；
  ③ 三个 `judge.md` **去掉数值达标线**（数字只由 `assertions` 判，见指南 §3.3）；
  ④ README 的复验命令补 `--timeout-ms 300000` 与 `-e VERIFY_REASONING_EFFORT=low`；
  ⑤ 三个实验的"偷懒解另一端"（全判缺陷 / 全判多数类 / 常数预测）**实测并写进 README**（防退化两端都验过）。
- **已上线（2026-11，教师账号上传 + 发布）**：三个项目挂在课程「分子医学人工智能理论与实验」的
  **第 3 章「深度学习基本原理和实践」**（`chapterId=36e3d1cc-f725-4cdb-962e-99fdd0bed50c`）下，均已 `published`：

  | 项目 | id | 包 sha256（模板 / 题目包，前 12 位） |
  |---|---|---|
  | 深度学习实验一：来料自动分检 | `feb2d8a0-69f3-443a-a078-a8918239f5d8` | `1ffbc97ea652` / `61dd8a7f23e0` |
  | 深度学习实验二：手写数字分拣 | `7b4e1bc8-9427-42bf-9e02-15381123d832` | `acba9ab7cb0b` / `97149e175a51` |
  | 深度学习实验三：传感器时序下一值估计 | `98faec69-da72-4acb-a170-baf8d7697cb3` | `5afffe5a41be` / `7f08eb5ed115` |

  · `evalConfig = {reasoningEffort: high, timeoutSeconds: 900}`（torch 实验建议容器内存 2g）；
    `rubric` = 复验通过率 50 / 能力边界与踩坑记录 30 / 判据语义项 20；截止时间**未设**（由教师按课程安排补）。
  · 五个教学字段（`objectives`/`background`/`description`/`references`/`faq`）已写入，文案源在各实验 `README.md`。
  · **学生端验证（只到领取为止，未产生提交/成绩数据）**：测试学生 `student1` 三个任务均 `status=claimed`（2026-10-09），
    领取下发的 `skill-template.zip` / `problem.zip` 的 sha256 与本地逐个一致；任务对 `student1` 已是 `unlocked`。
  · 未做：提交 → 复验 → 批改这段闭环（由真实学生或教师用真账号走）；`deadline` 未设。

**2026-10-31（续）：把工作区 LLM 改成「教练模式」—— 学生不再被"带着走完流程"（已上线）** ——
**用户提出的问题**："学生在使用这套流程的时候，好像 LLM 一下把所有的流程走完了，学生在中间没起到
什么训练作用。" **诊断**：六步里每一步都有 LLM 的代劳路径（读需求、看图、定基线、填 TODO、读指标、
写 notes），而"判断与解释"这些真正该练的能力，材料里**没有强制要求**。
**做法**（用户选定：改工作区 LLM 人设；过程记录只留档不判分）：
① 在**学生端**注入"教学立场"（`dsh/nju-lab-client/src/host/guidance.ts`）：
   - **常驻 system prompt 段**（每次请求都在）：学生说"帮我做完"时**第一个回应必须是提问**；
     不给整段实现、不把 `problem/reference/` 抄给学生；学生问"对不对"时先让他自己跑并贴输出；
     他直接要答案时先反问；`notes` / `figures.takeaway` / `SKILL.md` 实测档案**由学生自己写**。
   - **skill 手册**新增「怎么陪学生做这个实验」：逐步的"你可以帮 / 必须学生自己做"对照表、
     禁止做法（给整份实现、代跑、代写结论）、推荐问法（"你打算先用什么模型？""跑出来和你估的差多少？"）。
② **隔离**：`nju-lab-client` 只装在学生工作台与本地 kit，**复验容器不装**（verify profile 里没有它）——
   所以教练指令不会让复验的 agent 拒绝干活 ✅ 复验仍走 `nju-lab-verify` + `run-eval.mjs`。
③ **产物**：重建 **workspace 镜像 `nju-lab-workspace:0.2.0-rc.2-pkg5`**（`workspace.config.ts`
   默认镜像已切、server 已 build + 重启）；客户端 `typecheck / build / test` 通过（59 pass / 0 fail / 6 skip）；
   学生 kit 同步重建（本地 DSH 走同一套引导）。
**未做（用户明确选择）**：不加"必写的分析记录"、不把参考实现降级成半成品/含错示范、不拆成两次提交；
过程记录只留档、不进入自动判分。

**本阶段的边界（用户 2026-10-31 决定，记下来免得反复讨论）**：**先不加"无 AI 兜底"的检验环节** ——
迁移检验实验（不给参考实现/骨架）、首答行为统计、过程留档汇总页，都暂不做。理由是改动大，且本阶段
目的是让学生**掌握做实验的思路**（"知道该怎么思考"本身就是最大收获），学生带着这个思路再去迁移到
具体应用。**已知错位**（留待将来）：教练指令是软约束、自动判分只看产物，学生理论上仍可外包而系统
发现不了；将来若要检验"是否真学会"，首选"不给参考实现与骨架的综合任务"。

**2026-10-31：实验用「图」说话 —— 去掉"多方案对比"，改为"看数据画图 + 评估画图"（已上线）** ——
用户反馈："多个方案我觉得不太需要，不要把教学任务搞复杂了；看数据时能调用 plot 画出图示就好了，
最后结果也要展示训练和评估结果的图示。" 据此调整（三个实验一致）：
① **流程仍是六步，但环节换掉了**：① 看清需求 → ② **看一眼数据（画图）** → ③ 定基线 →
   ④ **训练模型**（不再要求比多个方案）→ ⑤ **评估（画图）** → ⑥ 写结论。
② **图怎么判**：judge 看不到图片本身（只读文本），所以把图的结论放进报告的 **`figures` 字段**
   （`[{"path": "figures/xxx.png", "takeaway": "一句话"}]`），并新增 1 条断言核对
   "至少 2 张图、每张都有 `path` 与 ≥10 字 `takeaway`"；`judge.md` 语义项判断
   "是否看图说话 + 图里的数字与 `metrics` 是否自洽"。
③ **画图的落地细节**：`matplotlib` 已预装（3.11.2，用 `Agg` 后端）；**图上的标题与轴标签必须用英文** ——
   镜像里没有中文字体，中文会渲染成方框（第一版实测就是一片方框，已写进题干提醒）。
④ **顺手抓到的一个真 bug**：B 的 case02 首次被判**不通过**，判据说"评估图里『提醒名单 81 人』
   与 `metrics.precision` 对不上（应为 69）" —— 查证属实，是**参考实现**里混淆矩阵算式写错，
   已改为直接由混淆矩阵计算。**新判据的自洽性检查抓出了示范本身的错误。**
**实测**：三个实验 `--check` 通过（断言 8 / 10 / 10 条）；参考实现复验 **A 2/2（8/8）、
B 2/2（10/10）、C 2/2（10/10）**；三个项目已重新绑定 + `description` 换成含画图的六步流程。
⑤ 规范：FRAMEWORK §2.6 第 4 条改写为"**小 ≠ 省环节，但也不要加环节**"，并补"用图说话"的三条配套。

**2026-10-30（续）：三个实验改为「完整小项目」—— 六步流程 + 报告比较过程（已上线）** ——
用户纠正："每个实验应该作为独立的实验，即使很小也要保持整个流程的流畅"（把实验定位成"只练一个决策点"
会让流程断裂）。改动落到三个实验：
① **题干加「实验流程（六步）」**：① 看清需求 → ② **看一眼数据**（此前缺）→ ③ 定基线 →
   ④ **建模并比较（至少两个方案，此前缺）** → ⑤ 评估（含"哪类样本错得多"）→ ⑥ 写结论（理由 + 不足）；
   交付格式的 `notes` 示例也改成体现比较的写法。
② **参考实现自己走完六步**：三者都加了 `look_at_data` / `build_candidates` / `compare_candidates` /
   `compose_notes`，真的比较多个方案并把结果写进 `notes`（A 比 4 个；B 比 3 个含"默认模型"；
   C 比 3 个含"不标准化就上逻辑回归"这个坑）；选优逻辑体现业务口径（B：recall 达标中 precision 最高；
   C：**先排除未收敛的方案**再比 macro F1 —— 否则 case02 会选中没收敛的那个）。
③ **判据**：`judge.md` 语义项改为"`notes` 是否体现完整流程"（含 ≥2 个方案比较与对结果的判断）——
   这一条**不进** `assertions`（"分析是否完整"不是可写死的数字）；硬性达标线不变。
④ **规范**：FRAMEWORK §2.6 增补第 4 条纪律「每个实验都是完整的小项目（六步流程）」，明确"小 ≠ 省环节"。
**实测**：A 2/2（`hard=7/7`，124.5s / 62.0s）、B 2/2（`9/9`，29.4s / 45.8s）、C 2/2（`9/9`，137.0s / 81.4s）；
三个项目已重新绑定并更新 `description`（六步流程）。

**2026-10-30：三个应用驱动实验全部上线（A 回归 / B 二分类 / C 多分类）** ——
用户明确方向：**场景用通用直观的**（对学生不需要任何领域知识，"看一眼就懂在做什么"），
不要领域化的场景。三个实验都按 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6 范式做，
判据都是"**`manifest.assertions` 硬性达标 + `judge.md` 语义**"。
① **A `aq-forecast`（回归）**：估算下一小时 PM2.5；决策点 = 连续量预测 + **基线意识**
   （现有做法"沿用上一小时"）；达标线 `MAE ≤ 0.8 × 基线`。
② **B `noshow-predict`（二分类 · 不平衡）**：门诊预约失约预测；决策点 = **不能只看准确率**
   （"一律认为会来"accuracy 有 7 成但 recall=0）；达标线 `recall ≥ 0.65` **且** `precision ≥ 0.40`
   —— 两条线正好对应"全判会来"与"全判失约"两个退化解。
③ **C `customer-tier`（多分类）**：会员价值分级（低/中/高）；决策点 = **macro 视角 + 逐档召回**
   （"全判多数类"accuracy 0.40 但 macro F1 只有 0.19）；达标线 `macro F1 ≥ 0.60` **且每档召回 ≥ 0.50**，
   后者专防"只保大类"。附带教学点：**不标准化时多分类逻辑回归收敛不了**。
④ **实测（pkg5）**：三者 `--check` 全通过（各识别到 9 条断言）；参考实现复验 **A 2/2（hard=7/7）、
   B 2/2（9/9）、C 2/2（9/9）**；三个项目均已创建并发布（`problem.zip` sha256 与本地一致），
   各写入 5 个教学字段。原 `ml-basics` 项目已删除下线。
**下一步（可选）**：A 的 `task.md` / 教学字段把领域术语讲浅一点 —— **已于 2026-10-30 完成**
（题干与 `background` 改成大白话，重测 2/2 通过、平台已重新绑定）；如需更多实验，
按 §2.6 加一个"新决策点"（例如无监督分组、过拟合与正则化），仍遵循"通用直观 + 基线 + 防退化"三条纪律。

**2026-10-21：第二个应用实验落地 —— `noshow-predict`（门诊预约失约预测 · 类别不平衡）** ——
按 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6 范式做的第二个实验；场景面向**医学院学生**
（患者预约管理，不涉及 AI 诊断）。
① **场景**：门诊预约制下提前找出会失约的预约（运营团队据此打电话提醒、调整排班）。
   现有做法 = "一律认为患者会来" → accuracy 有 7 成，但 **recall = 0**（一个都没抓到）——
   "**类别不平衡时准确率会骗人**"是本实验的核心一课。
② **判据（9 条断言，重点是防退化）**：`recall ≥ 0.65` **且** `precision ≥ 0.40` ——
   只卡 recall 会被"全判失约"刷满（其 precision 只有 0.28），只卡 precision 会被"全判会来"刷满（recall 0）；
   另外核对 `baseline.recall ≤ 0.05`（现有做法抓不到任何人）与 `baseline.accuracy`（±15%，防填假基线）。
③ **数据标定调了三轮**：初版失约率 29%/43% 太高（"不平衡"教学点被削弱）且参考实现 recall 只有 0.61；
   最终失约率 27.5% / 33.5%，参考实现 recall 0.727 / 0.760、precision 0.465 / 0.551，达标线两端都留余量。
   另测：不加 `class_weight` 时逻辑回归的 recall 只有 0.17（模型学会"全判会来"）—— 正是要教的。
④ **实测**：`--check` 通过（识别到 9 条断言）；参考实现复验 **2/2 通过**（`hard=9/9`，79.5s / 48.4s）；
   平台已创建并发布「实验：门诊预约失约预测（二分类 · 类别不平衡）」（`problem.zip` sha256 与本地一致）
   + 5 个教学字段。
**待办**：第三个实验 **C（多分类 · 风险分级）** 按同范式落地；A 的 `task.md` / 教学字段可再把领域术语讲浅一点。

**2026-10-10：实验范式转向「应用驱动」—— 新实验 `aq-forecast` + 判据分层（驱动改动，镜像 pkg5）** ——
**问题**：此前的 `ml-basics` 是"一个实验塞 5 个算法变体"，学生只需把 `params.json` 抄成代码 ——
学到的是 API 用法，不是"面对问题怎么选"。
① **新范式落地**：`server/fixtures/aq-forecast/`（**应用驱动样板**）—— 从一个真实需求出发
   （估算下一小时 PM2.5，要求"比现有做法好 ≥20%"），**模型 / 特征 / 切分由学生自己决定**；
   两批数据（常规季节 / 冬季重污染）都要达标；判据 = 硬性 `assertions`（达标线、切分占比、基线可信度）
   + 语义 `judge.md`（说清选择、自洽性、可疑地过于好）。
② **驱动改动（新镜像 pkg5）**：`run-eval.mjs` 新增 **`manifest.assertions`**（确定性断言，代码判定；
   不写则行为与历史完全一致），judge 的 `max_tokens` 1024→2048 + 重试时要求短 JSON
   （修"长 rationale 被截断 → `judge output not parseable`"）。镜像已构建+压平，
   `docker-evaluation-runner.ts` 默认镜像切到 pkg5，服务已重启。
③ **两条实测教训**（已写进规范 §2.6 / §5.1）：
   - **达标线不能让 LLM 算**：写进 `judge.md` 时，同一个"不建模"的产出被 LLM 判**通过**；
     改由 `assertions` 判定后拦截是确定性的（实测收紧到达不到 → `pass=false score=0.5 hard=6/7`，
     rationale 指明哪条断言不成立）。
   - **"负样本"不能用脚本构造**：被测 agent 是照 `task.md` 干活的 —— 你想让它交差方案，
     它会自己写好的。验证判据要从**判据侧**做（收紧阈值看是否拦住）。
④ **平台**：新建并发布项目「实验：下一小时 PM2.5 估算（回归应用）」（`1fad61f6-6e27-4677-b5eb-df7d3619626e`）；
   原「机器学习基础模型构建与运行」（`509af0d0-…`）**已删除下线**（尚未发给学生）。
⑤ **规范**：`EXPERIMENT-DESIGN-FRAMEWORK.md` 新增 **§2.6 应用驱动实验设计**（四步 + 三条纪律 + 新旧对照）、
   改写 §2.5（参考实现随包下发后的取舍）；`EXPERIMENT-PACKAGE-SPEC.md` 增加 `assertions` 字段说明。
**实测**：数据可分性（持久性基线 → 参考实现：6.07→3.56 / 7.94→4.75，比值 0.59 / 0.60）；
基线跨切分浮动 6.5%~8.7% → 断言容差 ±15%；`--check` 通过；参考实现复验 **2/2 通过**（`hard=7/7`）。
**待办**：按同一范式铺开另两个实验方向 —— **二分类筛查（类别不平衡 + 召回优先）**、
**多分类分型（K 类 + macro 视角）**。

**2026-10-08（再续）：ml-basics 改为「教学向样板」—— 参考实现随包下发 + 教学字段写实（已上线）** ——
**设计原则纠偏**：平台的目的是**让学生理解知识**，判分只是"他做完了"的确认手段，
不再为"区分学生"制造陷阱（此前几轮把重心放在了考核上）。
① **参考实现并入题目包**：`skill-solution/` → `problem/reference/`，随 `problem.zip` 下发给学生
   （**先读后仿**），同时仍是教师"题目可解性"自检的输入。`skill-solution/` 在 ml-basics 退役；
   `csv-cleaner` / `sales-report` 待按新规范跟进（`server/fixtures/README.md` 有一致性说明）；
② **骨架留解释层**：`skill-template/SKILL.md` 从"4 条 TODO 提示"改为"**原理一句 + 最小示例 + 你要做的**"，
   并指向 `reference/`；case05 的叙述从"照妖镜"改为"值得亲手跑一遍的观察点"；
③ **题目包 README 改导学**（学什么 / 怎么走 / 包内有什么 / 卡住看哪），用例表"考点"→"这个 case 想让你观察什么"；
④ **项目字段写实**（学生端 `ExperimentDetail.tsx` 会渲染）：`objectives`（学完能讲清的三件事）/
   `background`（概念地图）/ `description`（8 步导学，并修掉"虚拟机里应该已经准备好"这类过时内容）/
   `references`（sklearn 文档）/ `faq`（5 条）；
⑤ **规范**：`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` 头部写入**教学优先**原则 + 新增 **§3.5 教学向设计清单（七件事）**，
   §2.4 标注"教学优先时这一节可以放轻"；`docs/EXPERIMENT-PACKAGE-SPEC.md` 的 §1/§2/§7/§8 同步
   （参考实现由"教师私有"改为"随包下发"，检查表增加教学项）。
**实测**：`--regen-cases` 路径修正后期望值**逐字节未变**（5 个 case）；`--check` 通过（problem.zip 已含 `reference/`）；
参考实现跑复验 **5/5 通过**（52.8s）；平台侧重新绑定（problem.zip sha256 `87fcd6bd…`，与本地一致）+ 写入 5 个教学字段。
**取舍（明确记录）**：参考实现随包下发后，复验成功率不再区分"自己写的 / 抄来的" —— 教学优先下接受；
原创性由 `SKILL.md` 的能力边界/踩坑记录与 `.dshc` 证据包体现（那部分抄不来）。
⚠️ 顺带发现（非本轮引入、未修）：复验容器把 `problem.zip` **只读挂载在 `/inputs/problem.zip`**，
agent 若主动去找，能读到里面的 `expected.json` / `reference/`。若希望复验仍能反映 Skill 质量，
建议后续把挂载改为"只给 cases 输入"。

**2026-10-08（续）：ml-basics 全面优化 —— 扩到 5 个 case + 判据放宽到 K×K + 学生侧引导（已上线）** ——
① **新增两个"陷阱"用例**（`tools/gen_cases.py`，固定种子可重跑）：**case04** K=3 多分类 + `stratify=false` +
   `test_size=0.2` + `random_state=7`（期望 `acc=0.75`、混淆矩阵 **3×3**）；**case05** 回归 +
   `model_params={"fit_intercept": false}`（期望 `R²=0.4907` —— **照妖镜**：漏传参数会跳到 ≈0.98）；
② **判据同步放宽**：`problem/judge.md` 的混淆矩阵从写死的 2×2 改为 **K×K**；`task.md` 补"多分类"与
   "`stratify` 为假时**不要**传"；（case01–03 的期望值逐字节不变）；
③ **学生侧引导**：骨架 `SKILL.md` 的 TODO 具体化（`stratify` 分支 / `**model_params` 解包透传 / K×K），
   实测档案加"踩坑记录每条写一行"提示并改成**非列表格式**（避免污染信号：骨架 `pitfallsRecorded` 1 → **0**）；
   `problem/README.md` 的**自测命令修正**（原文写成 `train.py input.csv params.json out.json`，与骨架 CLI 不符）
   并补 5-case 批量比对脚本；`references/checklist.md` 同步；
④ **平台侧**：ml-basics 项目重新上传绑定（sha256 与本地一致）+ `evalConfig` 补 `model: deepseek-flash`（原先缺省）。
**实测（2026-10-08）**：`--check` 通过（5 cases、依赖 ok）；**满配 Skill 复验 5/5 通过**
（60.1s / 3543+446 tokens，`pitfallsRecorded=5`）；
⚠️ **骨架也 5/5 通过**（145.7s，token 相近 —— 模型在骨架下现场写出正确实现，连 3×3 混淆矩阵与
`fit_intercept` 都对）。**结论：这次优化提升的是"考点覆盖与实现难度"，没有提升"对模型的区分度"** ——
题干自包含（平台要求：学生自测与复验同口径）+ 模型能力足够 ⇒ 裸做成功率一样高。
真正能拉开差距的方向（按代价排序，分析记在 `server/fixtures/ml-basics/README.md` 实测记录）：
**过程分**（能力边界 / 踩坑 / 证据一致性 —— 骨架这几项是空的）> 让任务超出模型一步 > 恢复 baseline 对照。

**2026-10-08（续）：命名统一为「题目包 / problem」—— 平台、驱动、客户端、DB 全链路（已上线）** ——
项目尚未发给学生，故**直接改名而非兼容**（上一 commit 只改了仓库目录与 zip 名，这次打通内部命名）：
① **DB**：`experiment_projects.testDatasetFileId` → `problemFileId`（迁移 `RenameProblemFileId1790720000000`，
   `migrationsRun: true` 重启即生效；已核实列名只剩 `problemFileId` / `skillTemplateFileId`）；
② **驱动**：CLI `--dataset` → `--problem`、`resolveProblemRoot` / `problemRoot`、`taskPromptSource: 'problem/task.md'`、
   容器内挂载名 `/inputs/problem.zip`（镜像 **`nju-lab-verify:0.2.0-rc.2-pkg4`**，基底复用 pkg3 只覆盖驱动）；
③ **服务端/接口**：`project.problemFileId`、claim 与项目详情返回 `problem`、dossier 快照键 `problem`、
   错误文案「项目未绑定题目包」；
④ **前端**：教师端「题目包」上传与展示、学生端下载按钮、批改页 `result.problem`；
⑤ **客户端插件**：`ArtifactLabel = 'skillTemplate' | 'problem'`、面板按钮与 guidance 文案改为不写死文件名
   （镜像 **`nju-lab-workspace:0.2.0-rc.2-pkg4`**，基于 pkg4 重建；kit 重打并投放）。
**实测（2026-10-08）**：`server` / `web` `npm run build` 通过；客户端 `npm test` **59 pass / 0 fail**
（6 skipped = 需 `DSH_BIN` 的 L2）；三项目 `--check`（新参数）全过、`taskPromptSource=problem/task.md`；DB 列名与迁移记录已核实；
**端到端复验（平台链路，student1 的历史提交 v5）**：`POST /api/submissions/:id/verify` →
**24.5s**，`baselineResult: null`、`treatmentResult.problem=37e13044…`、`package.problemRoot=/tmp/nju-verify-problem-…`、
`successRate=1`、`tokenCost=456`、建议分 **95**、dossier 无 baseline 字段（链路含 pkg4 + 新参数名 + 新列名）。
三个示例项目已用新 zip 名重新上传并绑定（见 `server/fixtures/README.md` 的绑定现状表）；
`deploy deploy-web-lab.sh` 通过；kit 重打（版本 `20261009-0021-78e945f`）并投放 `/var/www/lab/kit/`。
部署：`kill` MainPID → systemd 拉起，PID 1398576 → **1598175**。

**2026-10-08：实验项目结构统一为「题目包 + Skill 两态」—— 参考实现升级为满配 Skill（只改仓库结构，未动平台代码）** ——
原 `template/ + dataset/ + reference/` 改为语义化四块：
`problem/`（题目包 → `problem.zip`）、`skill-template/`（学生起点 → `skill-template.zip`）、
`skill-solution/`（**满配 Skill = 标准答案**，不打包、不下发）、`tools/`（造题工具，可选，不下发）。
三个示例项目（`csv-cleaner` / `sales-report` / `ml-basics`）统一改造，`reference/` 目录名退役。
配套改动：
① **满配 Skill 可被复验直接当 Skill 装入**（驱动接受目录）—— 跑通即"题目可解性 + 模板契约可行"的机器证明，
写进上线流程与自查清单（`docs/EXPERIMENT-PACKAGE-SPEC.md` §7/§8、`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §3）；
② csv-cleaner 新写满配 `skill-solution/scripts/clean.py`（此前没有参考实现），并**修正 CSV 行尾**：
骨架与满配都显式 `lineterminator="\n"`（`csv.writer` 默认 CRLF，会让"看起来一样却 diff 不通过"）；
③ ml-basics：`reference/solve.py` → `skill-solution/scripts/train.py`（函数划分与骨架对齐）、
`reference/gen_cases.py` → `tools/gen_cases.py`；sales-report：`reference/report.py` → `skill-solution/scripts/report.py`；
④ 仓库内 6 个 zip 重打为 `skill-template.zip` / `problem.zip`，旧的 `template.zip` / `dataset.zip` 从仓库移除。
**实测（2026-10-08）**：三项目 `--check` 全过（csv-cleaner 仍 `source=builtin` —— 内置回落基线性质保住）；
三个满配 Skill 复现期望值 **9/9 逐字节一致**（`cmp`）；csv-cleaner 满配跑真复验 **3/3 通过**
（`successRate=1`，30.3s / 1407 tokens）。
⚠️ **骨架也通过了**（`--skill skill-template.zip` → case01 pass）：题面与规则足够清楚时，模型能临场把
清洗做对、用不上脚本里的 TODO —— 说明该样例**区分度有限**（已记入 `server/fixtures/csv-cleaner/README.md`；
这与"取消 baseline 后难度只看成功率"的取舍一致）。
**未改平台代码、未重建镜像**：平台文件位名、驱动 CLI 参数名（`--dataset`）、客户端文案仍是历史称法
（"标准测试数据集" / `testDataset`），只是仓库里的目录与 zip 名语义化了 —— 详见
`docs/EXPERIMENT-PACKAGE-SPEC.md` §1 的"命名说明"。线上示例项目仍绑定 2026-10-01 上传的旧包，
要让新结构生效需按各项目 README 重新上传并绑定。

**2026-10-06：复验取消 baseline 轮 —— 每个实验不再多跑一轮"只给题干"的对照（已上线）** ——
面向学生的练习不是严格考试，评判只保留"学生交付的 Skill 能否在标准用例上跑出正确结果"，不再度量 `lift`。
① 驱动 `server/verify-image/run-eval.mjs` 只跑**一轮**（题干 + 学生的 Skill），`--skill` 成为必需输入；
结果 JSON 去掉 `summary.baseline` 与 `cases[].rounds`（`evalVersion: docker-3`，每个 case 一条扁平记录）。
② `DockerEvaluationRunner` / `MockEvaluationRunner` 去掉 `lift` 与 `baselineResult`；`tokenCost` 改为单轮、
`invocationCount` = case 数、`dossierSnapshot` 去掉 `baselineSuccessRate`/`lift`。
③ 建议分公式：**成功率 40 → 55**（原 lift 的 15 分并入），token 阈值 **30000 → 15000**（单轮减半）；
其余两项（能力边界 20/10、证据一致 10/5）不变 —— 上限仍是 `min(100, …)`。
④ 前端：教师批改页去掉 Baseline 卡片（改为单个「复验（使用学生的 Skill）」卡片）、学生端去掉「Baseline 成功率」行；
`baselineResult` 作为**历史字段**保留在实体与类型里（旧记录仍可读，新复验不再写入）。
镜像 **`nju-lab-verify:0.2.0-rc.2-pkg3`**：只覆盖驱动 + `export/import` 压平（不重装依赖），
**pkg2 保留作回滚点**；workspace 镜像本次不重建（工作台不跑复验驱动），仍基于 pkg2。
文档同步：`docs/EXPERIMENT-DESIGN-FRAMEWORK.md`（五信号 → 四信号、§2.2/§2.4 按单轮口径改写、§5.2 公式）、
`docs/EXPERIMENT-PACKAGE-SPEC.md`、`server/README.md`、`server/verify-image/README.md`、两个 fixtures 的 README 与模板脚本注释；
`nju-lab-craft.md` 加"现状注记"（其中其余 baseline/lift 表述属**原始设计**，保留作历史）。
验证（2026-10-06 本机实测）：
① `server` `npm run build` + `web` `npm run build` 通过；
② pkg3 镜像端到端直跑：`--skill fixtures/csv-cleaner --dataset fixtures/dataset --max-cases 1` → 日志只有**一次** `[run]/[done]`
（无 baseline），`evalVersion=docker-3`、`summary` 扁平（`passCount/runs/successRate/avgScore/tokens/durationMs`）、
`cases[0]` 扁平无 `rounds`；26.6s / 486 tokens（对照两轮时代 ≈ 翻倍）；
③ 不传 `--skill` → **退出码 2** + `--skill is required：baseline 轮已取消…`（不再静默只跑 baseline）；
④ 服务端映射（`mapResult`）喂入上述真实 result.json：顶层**无** `baselineResult`、`tokenCost=486`（单轮）、
`invocationCount=1`、建议分 `85`（1×55 + 10 + 10 + 10）；
⑤ 部署：`server` build → `kill` MainPID（3757030 → **1398576**）→ 冒烟 `POST /api/auth/login` **201**
（3100 直连与经 nginx 的 `/lab/api/...` 均 201）、`/lab/` **200**；前端 `deploy/deploy-web-lab.sh` 部署通过（md5 校验 + 6/6 资源探测）。
⚠️ 重启打断了一次活跃工作台会话（容器按 `adoptOrReclaim()` 处置）。
**取舍说明**：关掉 baseline 后平台答不出"用 Skill 比裸做强多少"（原卖点），
换来的是每个 case 的 token 与时间**减半**、出题与判分口径更简单（`task.md` 自包含从"硬要求"降级为良好习惯）。
真要恢复对照，按 `docs/UPGRADE-playbook.md §5` 重建一版驱动即可。

**2026-10-06（续）：教师端课程管理优化 + 课程转让（已上线）** —— ①「课程管理」卡片整行等高
（与 student 端同一套 flex 链路），**简介固定占两行高度**（`min-height: 3.15em`，不足两行也撑满），
卡片新增「授课教师」行（`GET /api/courses` 列表补返回 `teacherName`；⚠️ 用解构剔除 `teacher` 实体本身，
防止 `passwordHash` 随响应泄漏）；② **管理员可把课程转让给其他教师**：`UpdateCourseDto` 新增
`teacherId`（服务层校验：仅管理员、目标须为 teacher/admin 角色，教师自己 PATCH → 403），
新增 `GET /api/users/teachers`（仅管理员，**含管理员账号**——否则 owner 是管理员的课程在下拉里
回显 UUID）；课程「编辑」弹窗新增「授课教师（转让课程）」下拉，仅管理员可见。
验证：`web/tools/verify-course-pages.mjs` 扩到 22 项断言（学生/教师/管理员三角色），curl 负向实测
（教师访问 teachers 名单 403、教师转让 403、转让给学生 400）。

**2026-10-06：学生端课程页版式优化（已上线）** —— ①「我的课程」卡片新增**授课教师/学期**与**课程简介**（2 行省略 + 悬停全文）：`GET /api/me/courses` 补返回 `description`/`teacherName`（`courses.service.ts` 关联 `teacher` 取昵称），前端 `MyCourse` 类型同步；② **课程章节页卡片宽高统一**：`List grid` 改 `Row/Col` + flex 满高（`align="stretch"` + Col `display:flex` + Card `height:100%` 链路），「进入学习」对齐卡片底部，章节标题单行省略 + 悬停全文，标题下补授课教师/学期。验证走 `web/tools/verify-course-pages.mjs`（Playwright，12 项断言：逐行等高/等宽/标题不折行/教师展示），前后端均已部署（后端 kill MainPID 由 systemd 拉起，前端 `deploy-web-lab.sh` 自检通过）。

NJU-Lab（"课程 + 实验"一体化 Skill 工程教学平台）**端到端已验收通过（2026-09-21，见 `docs/ACCEPTANCE-2026-09-21.md`）**：学生本地 DSH（插件）登录 → 看任务 → 领取（真实下载 + sha256 校验 + 解压 + 条件钉死）→ 开发 Skill → 自测 3/3 → 提交（真实 ZIP + `.dshc` 证据包 + 审计事件）→ 服务端真实容器复验（deepseek-flash，baseline/treatment + LLM judge）→ 教师批改 → 学生看反馈，全程一次跑通、零代码修复，总成本 ≈59k tokens / ≈100s。生产化关键项也已落地：容器 SNI 白名单网络隔离、evalConfig.model 逐项目映射、修改密码、migrations、systemd 常驻、CSV 成绩导出。**剩余为后续阶段功能**（第 5 节）。

**2026-09-24：njuserver 接入南大统一认证（CAS 3.0）** —— 校园网关放开全站后，认证改由应用自负：`/lab` 走标准 CAS ticket 重定向流，角色由 CAS 属性 `containerId`（`ou=JZG` = 教职工）自动判定，登出接 CAS 登出，已用真实账号实测走通；前端产物已按 `VITE_BASE=/lab/` 重建并部署。详见 §2.1 与 §3.4。

**2026-09-28：教师端「课程报名审批」独立页并入课程详情「学生管理」页签**（纯前端整理，后端接口与数据模型未动）—— 报名申请与选课名单合成**一张统一表格**（每行一名学生，状态区分 待审批/已通过/已驳回/已入册，行内直接批准/驳回/移出），删除独立路由 `/teacher/courses/:courseId/applications` 与页面文件 `web/src/pages/teacher/CourseApplications.tsx`；「公开报名」页签（名额上限/申请开放时间等**课程设置**）保持不变，其「去处理报名申请」按钮改为切到「学生管理」页签。

**2026-09-28：njuserver 存储扩容** —— 根分区 49G→**98G**（可用 9G→**60G**），新增 LVM 数据盘 `/data` = **957G**（1T 的 `sda` 整盘做 PV 加入 `ubuntu-vg`，`-l 95%FREE` + `mkfs.ext4 -m 1`）。此前"根分区仅剩 9G"是该机最高风险项（写满会拖垮同机的生产 MySQL），已解除；为后续「平台侧兜底实验工作台」预留空间。详见 §2.1 与 `docs/OPS-2026-09-28-storage-expansion.md`。

**2026-09-28：平台侧实验工作台 —— 后端与容器已端到端实测，nginx 与浏览器待验** —— 给"本地装不上 DSH"的学生提供浏览器即可用的实验环境。已落地：**工作台镜像**（`server/workspace-image/`）、**工作台后端**（`server/src/workspace/`）、**通用容器运行时**（`server/src/container-runtime/`，与复验共用同一份隔离策略）。~~前端入口页未做、nginx 反代未在真实环境验证、浏览器实测未做~~ —— **均已完成**
（2026-09-28/29：入口页、nginx 片段落地、浏览器中 claim 与对话交互验证通过；剩「提交 → 复验」）。设计与遗留见 **§8**（新接手者必读）与 `docs/DESIGN-2026-09-28-platform-workspace.md`。

**2026-10-01：复验改「包驱动」+ 镜像预装教学依赖集 —— 新增实验类型不再改代码、不再重建镜像** ——
原先「任务是什么」写死在 `server/verify-image/run-eval.mjs`（题干、CSV 清洗规则、judge prompt、`input.csv`/`output.csv` 文件名），
于是每加一个实验类型都要改驱动 + 重建镜像 + 部署。现改为**题目与判据随数据集包走**：数据集 ZIP 根可放
`manifest.json`（`outputFile`/`inputs`/`judgeMode`/`maxCases`/`requires`）、`task.md`（题干，**baseline 轮的唯一事实源**）、
`judge.md`（评分细则，填进平台固定的判分外壳）；三者皆无时**逐字回落**内置 CSV 清洗语义（老包与在跑实验零影响，已回归验证）。
优先级：命令行（项目 `evalConfig`）> 包内 manifest > 内置默认 —— 故 `DockerEvaluationRunner` **未显式配置时不再下发**
`--judge-mode`/`--max-cases`。驱动新增 `--check`：只解析与校验包（结构 + 依赖），不跑模型、不烧 token，供上传前自检。
运行时依赖（容器无外网、镜像层只读，装包只能在构建期）改为「**镜像预装教学依赖集 + 包内声明自检**」：
新镜像 `nju-lab-verify:0.2.0-rc.2-pkg2` 预装 pandas/numpy/openpyxl/python-dateutil/requests/beautifulsoup4/lxml/PyYAML/tabulate/pytest + `jq`。**pkg2 追加 ML 依赖集**：scikit-learn（含 scipy）/statsmodels/matplotlib + **torch 2.14.1+cpu（CPU 版）** —— PyPI 上 linux 的 torch wheel 是 CUDA 版（wheel 554MB + `nvidia-*`/`triton`，装完数 GB，容器内存限额扛不住），官方 `download.pytorch.org` 本机不通，故走镜像站 CPU 索引（`mirror.sjtu.edu.cn/pytorch-wheels/cpu/`，`+cpu` 本地版本号只有它有 → 与 PyPI 并挂也不会误装 CUDA 版）；代价是 **verify 镜像 ~2.3GB**（torch 目录 773MB），ML 实验建议把 `VERIFY_DOCKER_MEMORY` 从 1g 调到 2g。
包内 `manifest.requires` 声明、驱动开跑前自检，缺失**明确失败**（不静默降级）；冻结清单在镜像 `/opt/verify/PYTHON-PACKAGES.txt`。
复验产物新增 `package`（包声明摘要：输出文件名/题干与细则来源/依赖）与 `dependencyCheck` 快照，进 `Evaluation.dossierSnapshot` 等字段，供批改页追溯评测口径。
新增示例包 `server/fixtures/sales-report/`（第二个任务类型：销售数据汇总，3 个 case，`requires.python=["pandas"]` 用来压测预装+自检链路，含教师自用参考实现与独立交叉校验）；面向教师的规范见 `docs/EXPERIMENT-PACKAGE-SPEC.md`。
**实测（本机，2026-10-01）**：旧 CSV 包回落路径 1/1 通过；`sales-report` manifest 路径 1/1 通过（judge 用的是包内 `judge.md` 细则）；pkg2 的 ML 依赖：`torch 2.14.1+cpu`（`cuda=None`）/`sklearn 1.9.1`/`statsmodels 0.15.0`/`matplotlib 3.11.2` 的 import + matmul + 训练一步均 OK，声明这四者的包依赖自检通过。

**2026-10-01：本次改动已部署到生产（就是这台机器）** —— `server/` `npm run build` → `kill $(systemctl show nju-lab -p MainPID --value)`（`Restart=always` + `RestartSec=5` 拉起，旧 PID 1116643 → 新 PID 3555145）→ 冒烟通过：`POST 127.0.0.1:3100/api/auth/login` **201**；经 nginx `Host: medai.nju.edu.cn` 的 `/lab/` **200**、`/lab/api/auth/login` **201**；编译产物确认运行中的服务使用 `nju-lab-verify:0.2.0-rc.2-pkg2` 与 `nju-lab-workspace:0.2.0-rc.2-pkg2`（`pkg1` 镜像保留作回滚点）。前端产物未动（本次只改 `server/`），无需重新部署。

> **⚠️ 环境澄清（2026-10-01 实测，纠正 §2 与 §2.1 的并列叙述）**：**njuserver 就是这台机器本身** —— `/data` 957G（`ubuntu--vg-lab--data`）、Node 在 `~/opt/node24`、静态产物 `/var/www/lab`、服务单元 `WorkingDirectory=/home/ubuntu/nju-lab/server`、**系统 MySQL**（无 mysql 容器）、nginx 唯一站配置 `sites-enabled/cms.conf`（`server_name medai.nju.edu.cn`，`/lab` 由 `snippets/medai-lab.conf` 提供；`lab.xiaohe.biz` 只是落到同一台 nginx 的另一 Host）。因此**不存在需要跨机 `docker save | load` 的第二部署点**；本机沙箱里也没有 `ssh njuserver` 的凭据与 config 条目（`~/.ssh/config` 无该 Host、`known_hosts` 无记录、该机只接受密码认证）。§2 中「docker `nju-lab-mysql` / `sites-enabled/lab.conf` / 根分区仅剩 10G」等描述**与当前实测不符**，勿据此判断现状。**待办影响**：学生工作台的旧容器（`nju-lab-workspace:0.1.5-rc.2`）会在这名学生下次进入时被 reclaim 重建为 pkg2，其会话上下文丢失。

**2026-10-01（续）：推理档位白名单 + ML 实验包 + 复验内存 2g** ——

① **推理档位必须用 dsh 的取值集合**（原先按 DeepSeek **官方 API** 给的下拉框会把学生端卡死）：
`dsh-llm-deepseek` 实际只接受 `off|low|high|max`（源码判定 `["low","high","max"].includes(effort) || thinking==="disabled" && effort==="off"`），
2026-10-01 在 pkg2 镜像内实测 `off`、`low` 都能跑通复验；而教师端选项是官方 API 的 `none|minimal|low|medium|high|xhigh|max`
→ 选到 `none/minimal/medium/xhigh` 会让学生 claim 之后**每个请求**抛 `UNSUPPORTED_REASONING_EFFORT`，实验直接做不了。
已修：`web/src/pages/teacher/ProjectDetail.tsx` 的 `EFFORT_OPTIONS` → `off/low/high/max` + 文案订正；
后端新增 `ProjectsService.assertEvalConfig` 白名单（create / update 两条路径都拦，实测 PATCH `medium` → 400 且报错明确）；
`seed.ts` 里「deepseek-official 完全不支持 reasoningEffort」的过时注释已订正。

② **新增第三个示例实验包** `server/fixtures/ml-basics/`（机器学习基础建模，包驱动 + ML 依赖）：
由 `params.json` 驱动口径（`task`/`model`/`model_params`/切分），产出 `output.json` 的 `model`/`n_train`/`n_test`/`metrics`；
3 个 case（`LinearRegression` r2=0.9861 · `LogisticRegression` accuracy=0.90 · `class_weight="balanced"` 不平衡 accuracy=0.92，
指标都非满分）；`requires.python=[sklearn,pandas,numpy]`；数据用固定种子生成、`expected.json` 在 pkg2 镜像内计算（sklearn 版本一致）；
端到端实测 baseline 1/1 + treatment 1/1。**可直接绑定到 draft 项目「机器学习基础模型构建与运行」**（该项目当前模板与数据集均未绑定）。
注意其 baseline 也能通过 —— 题面自包含的固有代价，已在包 README 说明。

③ **复验容器内存**：`server/.env` 设 `VERIFY_DOCKER_MEMORY=2g`（本机 31Gi/16 核，`1g` 跑 torch/sklearn 容易 OOM；`.env` 不入 git）。

④ **前端重新部署**：沙箱里 `/home/ubuntu` 与 `/var/www` 均只读（§2.1 注意⑦），故用 `docker run --user 1000:1000` 等价执行
`deploy/deploy-web-lab.sh` 的 2–5 步（备份 → **先写 assets** → md5 校验 → **最后切 index.html**），
再按脚本第 6 步逐个探测线上 index.html 引用的资源（4 个全为 200 + `application/javascript`/`text/css`），
线上 index.html md5 与 `web/dist` 一致。后端随之重启（PID 3555145 → 3572017）。

⑤ **ml-basics 已绑定并把项目归位**：上传 `template.zip`（fileId `7de02091-2fcd-4585-96d2-7d5959300aae`）与
`dataset.zip`（fileId `e5e5ccf5-885a-441e-b84d-395d995267b3`），PATCH 到项目「机器学习基础模型构建与运行」
（`509af0d0-0242-4262-abda-3f300728be20`）；同时该项目从课程「人工智能基础概论」的 order=1「什么是人工智能」
**移到 order=2「什么是机器学习」**（原先挂错章节）。

⑥ **新增「移动实验项目到其它章节」能力**（原先 `UpdateProjectDto` 没有 `chapterId`，只能进 DB 改）：
`UpdateProjectDto.chapterId`（可选 UUID）+ `ProjectsService.assertChapterInCourse`（章节须存在且属**同一课程**，
跨课程 → 400，已实测）；教师页编辑弹窗新增「所属章节」下拉（选项取自 `GET /courses/:id` 的 `chapters`）。
**顺带修坑**：教师页保存项目会抹掉 `evalConfig.judgeMode` / `maxCases`（表单不编辑这两项、PATCH 又是整体替换）——
现在提交时从 `project.evalConfig` 原样带回；前端 `EvalConfig` 类型补齐这两项。前端已按 ④ 的流程重新构建部署
（4 个引用资源 200 + 正确 MIME，index.html md5 与 `web/dist` 一致）。

⑦ **章节编号统一按「位置」（修复"展示与 order 不同步"）**：原先三处渲染是**两种口径** ——
教师端课程详情（`teacher/CourseDetail.tsx`）与学生端（`student/CourseDetail.tsx`）用 `idx + 1`（位置），
而**公开课程目录页**（`courses/CourseDetail.tsx`）用 `ch.order`。于是 `order` 重复/跳号时同一章节在不同页面编号不同：
实例 课程「人工智能基础概论」`order=[1,2,3,3,4,…,12]` 共 13 个章节，目录页会把第 4 个章节显示成「第 3 章」。
现统一为位置编号：目录页改 `idx + 1`（并显式按 order 排序）、教师端侧栏 `ChapterEdit` / `ChapterSlides` 的
`{item.order}.` 改 `{index + 1}.`、教师页「所属章节」下拉同理；新建章节表单的「排序号」补了说明
（"只决定先后顺序；页面上的『第 N 章』按实际位置自动编号"）。
**`order` 的语义保持"仅排序依据"**，分配规则与数据均未改 —— 因此它**仍可能重复**。

⚠️ **仍未修（已知风险）**：新建章节的 `order = count + 1`（后端）/ `chapters.length + 1`（前端），
**删章后再新建会撞号**（那两个重复的 order=3 就是这么来的）；而解锁规则用
`chapter.order < ownChapter.order` 判定"前置章节"，order 相同时两章互为"之后" → 领取条件可能算错。
若要修：改成 `max(order) + 1` 并给教师提供重排/上下移，或把前置判定改成"按 order 排序后的位置比较"。

⑧ **已按方法 1 修掉 ⑦ 的隐患：order 分配改 `max(order) + 1` + 新增重排接口** ——
- 后端 `upsertChapter` 新建章节不再用 `count + 1`（删章后会与已有 order 撞号），改用 `MAX(order) + 1`；
- 新增 `POST /api/courses/:id/chapters/reorder`（`ReorderChaptersDto { chapterIds: string[] }`）：
  按传入顺序把 `order` 重写为 `1..N`，**必须传该课程全部章节 id**（漏传 / 重复 / 不属于本课程 → 400），
  顺带把历史遗留的重复/跳号 order 规范化；
- 教师端章节行新增**上移 / 下移**按钮（交换位置后整体重排）；新建章节「排序号」默认值改为 `max(order) + 1`；
- **数据已规范化**：5 门课各 reorder 一次 —— 「人工智能基础概论」`order` 从 `[1,2,3,3,4,…,12]` → `1..13`，其余本就是 `1..2`；
- **实测**：规范化后 order 连续；漏传章节 → `400 章节列表不完整：本课程有 13 个章节，收到 1 个`；
  在测试课程新建章节 `order = max + 1 = 3`（临时章节已删）；
- 后端重启 + 前端重新构建部署（4 个引用资源 200 + MIME 正确 + index.html md5 一致）。
  → ⑦ 里"order 重复会让解锁规则判定错乱"的风险随之解除（order 不再有重复值）。
**顺带发现（既有问题，未修）**：驱动 `extractUsage()` 统计的 token 明显偏低（一个 case 两轮仅 ~400 input），旧镜像 `0.2.0-rc.2` 复跑结果相同 → 与本次改造无关；因 `tokenCost < 30_000` 参与 `autoScoreSuggestion`，建议后续单独排查 session 日志的 usage 帧匹配。

## 1. 仓库布局

```
/home/ubuntu/nju-lab/
├── nju-lab-craft.md          # 系统设计总文档（含实现现状 §13）
├── HANDOFF.md                # 本文件
├── docs/                     # ACCEPTANCE-2026-09-21 / OPS-2026-09-28（存储扩容）/ DESIGN-2026-09-28（工作台设计）
├── server/                   # NestJS + TypeORM + MySQL 后端（端口 3100）
│   ├── src/container-runtime/  # 通用容器运行时（复验与工作台共用；隔离策略唯一来源）
│   ├── src/workspace/         # 平台侧实验工作台后端（见 §8）
│   ├── verify-image/          # 复验镜像（headless bundle + run-eval.mjs）
│   └── workspace-image/       # 工作台镜像（web-app bundle + entrypoint.mjs）
├── web/                      # Vite + React 18 + AntD v5 前端
└── dsh/                      # DSH 本地侧构件
    ├── README.md             # dsh 目录总说明 + 快速开始
    ├── nju-lab-client/       # 定制客户端双半插件（host + client），README 有详细实现状态
    ├── profiles/
    │   ├── nju-lab-student/  # 学生本地 profile（web + nju-lab-client）
    │   └── nju-lab-verify/   # 平台复验 profile（headless，approval=never）
    ├── dev/overlay.yml       # 本地调试 overlay（TS 源直载）
    └── scripts/smoke.sh      # 插件加载冒烟
```

## 2. 运行环境与账号

| 项 | 值 |
|---|---|
| 线上入口 | https://lab.xiaohe.biz（nginx → 静态 `/var/www/nju-lab/dist` + `/api/` → `127.0.0.1:3100`） |
| nginx 配置 | `/etc/nginx/sites-enabled/lab.conf`（改后 `sudo nginx -t && sudo service nginx reload`） |
| 数据库 | Docker 容器 `nju-lab-mysql`（MySQL 8.0，127.0.0.1:3306，库 `nju_lab`，用户 `nju_lab`，密码 `nju_lab_dev`，utf8mb4） |
| 账号 | `admin/admin123`（管理员，全权限）、`teacher/teacher123`、`student1/student123`（另有 student2/student3） |
| 后端启动 | **生产常驻：`systemctl start nju-lab`**（unit `/etc/systemd/system/nju-lab.service`，`node dist/main.js`，Restart=always，MemoryMax=800M；改代码后 `npm run build && sudo systemctl restart nju-lab`）；开发调试用 `npm run start:dev` |
| 前端部署 | `cd web && npm run build && sudo rm -rf /var/www/nju-lab/dist && sudo cp -r dist /var/www/nju-lab/ && sudo chown -R www-data:www-data /var/www/nju-lab` |
| 端口注意 | 本机 3000/5173 被其他项目占用，所以后端用 3100；服务器内存紧张（~1.4G 可用）、磁盘紧张（~10G） |
| DSH 版本 | 锁定 `@deepseek-ai/dsh@0.2.0-rc.2`（rc 阶段官方明示破坏性变更，学期内不升级） |

### 2.1 第二部署点：njuserver（`http://medai.nju.edu.cn/lab`，2026-09-22）

与本机**并存**运行，数据是 2026-09-22 时点的全量拷贝，之后两边独立演化。

| 项 | 值 |
|---|---|
| 机器 | `ssh njuserver`（124.221.233.118:6001，ubuntu，sudo 有密码） |
| 入口 | `http://medai.nju.edu.cn/lab/`（**HTTP，无 443**；公网流量经校园网关到本机 :80，网关只认 Host） |
| 统一认证 | **CAS 3.0，由应用自负（2026-09-24 起）**：校园网关已放开全站，`/lab/api/auth/cas/login` → 302 到 `https://authserver.nju.edu.cn/authserver/login` → 回调 `/lab/api/auth/cas/callback?ticket=` 服务端校验后签发平台 JWT，再 302 回 `/lab/login/cas?token=`；登出 `/lab/api/auth/cas/logout`。角色由 CAS 属性 `containerId` 判定（`ou=JZG`=教职工）。详见 §3.4 |
| nginx | `/etc/nginx/sites-enabled/cms.conf` 的 medai server 块内新增 3 个 location：`/lab/api/`→`127.0.0.1:3100/api/`（去前缀，read_timeout 660s）、`/lab/`→`root /var/www`（SPA + `/lab/kit/` 安装包，try_files 回退 `/lab/index.html`）、`= /lab`→301。改动前备份在 `~/cms.conf.bak-20260922` |
| 代码/数据 | `~/nju-lab/server`（含 uploads、.env 已改为本机 DB 密码与 `PUBLIC_BASE_URL=http://medai.nju.edu.cn/lab`）；Node v24.14.0 在 `~/opt/node24`（用户态，系统 Node 是 22） |
| git | **GitHub 为唯一远端：`git@github.com:jilongcui/nju-lab.git`（remote `origin`，main 跟踪 origin/main）**——本机 `ubuntu` 的 SSH key 已登记到 GitHub，`fetch`/`push` 直连可用；**仓库根即 `~/nju-lab` 本身**，部署目录 `~/nju-lab/server`（仓库的子目录，systemd 指向它；`dist`/`.env`/`uploads`/`node_modules` 均在 `.gitignore`）。纪律：所有改动先提交再 push 到 `origin`，**禁止直接在部署目录改代码**——2026-09-23 发现网关 CAS 登录改动（gateway-cas.ts 等 3 个文件）只在 njuserver 部署目录存在、未入 git，已收编回本仓库；部署目录以 git 为准。~~本地裸仓库 `~/nju-lab.git`（旧「njuserver 部署 remote」）已于 2026-09-26 退休删除~~ ——它是 GitHub 仓库建成前的中转；无脚本/hook/其他仓库引用、无独有内容，备份 `~/nju-lab.git.bak-20260926.tar.gz` |
| 目录收敛 | **2026-09-26**：原先并列的工作副本 `~/nju-lab/repo` 已**提升为仓库根**（`repo/` 这一层取消），`~/nju-lab` 现在既是 git 仓库根、也是部署目录树，与 §1 布局一致。`server/` 原地保留运行态（`dist`/`.env`/`uploads`/`node_modules`），只把 `src` 换成仓库最新版（此前是旧版、与 `dist` 漂移，有回退选课功能的风险）；`WorkingDirectory` 路径未变故**无需重启**（服务同一 PID 持续运行）。过时产物（`kit/`、`web-dist/`、`server/dist.bak-*`）移出到 `~/nju-lab-attic-20260926/`；部署配置副本 `nju-lab.service`、`lab-nginx-snippet.conf` 纳入仓库；迁移前备份 `~/nju-lab-migrate-bak-20260926.tar.gz` |
| 静态产物 | `/var/www/lab/`（`index.html`+`assets`+`kit/`）。**前端须用 `VITE_BASE=/lab/ npm run build` 构建**（先在 `web/` 里 `npm install`）；部署走仓库脚本 **`bash deploy/deploy-web-lab.sh`**（构建 → 备份 → **先写 assets 新 chunk、最后换 index.html** → md5 + Content-Type 自检，失败自动回滚）。⚠️ **2026-09-29 起 `index.html`/`assets/` 属主已从 `www-data`(33) 改为 `ubuntu`(1000)**，可直接 `cp`，不再需要 sudo；若属主再次变回非当前用户（会话里 `ls` 显示 `nobody:65534`），按 §2.2 第 5 条「属主修复」处理。历史 docker 绕过（`cp -rf /source/. /target/ && chown -R 33:33 …`）只在需要把属主恢复成 www-data 时用；只动 `index.html`+`assets/`，别碰 `kit/`。纪律见 §2.2 |
| 数据库 | 系统 MySQL 8.0（127.0.0.1:3306），库/用户 `nju_lab`（随机密码在 server/.env） |
| 服务 | `systemctl` 单元 `nju-lab.service`（`~/nju-lab/nju-lab.service` 有副本）。**不要加 PrivateTmp/ProtectSystem**——runner 靠 `/tmp` 给容器 bind-mount，PrivateTmp 会导致挂载为空、复验全挂（2026-09-22 踩过） |
| Docker | ubuntu 在 docker 组；docker.io 直连不通，走 `swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/<img>` 拉取后 tag 回原名（`nginx:alpine` 已就位）；**`nju-lab-verify:0.1.5-rc.2` 是生产的 `docker save/load` 拷贝**——异地重建会因 `node:22-slim` 漂浮 tag 拿到老基底导致 sharp 加载失败、复验全挂（Dockerfile 已改钉 `node:22.23.2-slim`，但跨机仍以 save/load 为准） |
| 注意⑦ | **agent 会话（Reasonix）跑在"只读根 + 仅 workspace 可写"的沙箱里**：用受限会话自己的 shell 看 `/proc/mounts`，会看到 `/` 与 `/data` 都是 `ro`（还会多出一条 `udev … /home/ubuntu/.reasonix/.env devtmpfs ro`）——**那是沙箱的视图，不是宿主状态**（宿主一直是 `rw`，见 `mount` 实测）。**要判定宿主文件系统/权限，一律用 docker**（`docker run --rm -v /data:/d …`）或看服务日志。⚠️ 2026-09-29 曾据此误报"根分区被内核降级为只读"，实际是假象，已更正。另外 `/data` 属 `root:root`，后端以 `ubuntu` 跑，所以 **`/data/workspaces` 需要一次性建好并 chown 给 ubuntu**（已用 docker 完成） |
| 存储 | **2026-09-28 扩容**：根分区 49G→**98G**（可用 9G→**60G**）；新增 LVM 数据盘 `/data` = **957G**（1T 的 `sda` 整盘做 PV 加入 `ubuntu-vg`，`lvcreate -l 95%FREE`、`mkfs.ext4 -m 1`、fstab 用 UUID + `nofail`），VG 余量 51.2G。此前"根分区仅剩 9G"是最高风险项，已解除；清单见 `docs/OPS-2026-09-28-storage-expansion.md` |
| 学生安装包 | 变体 kit（serverUrl 指向 `http://medai.nju.edu.cn/lab/api`）：`cd dsh/kit && PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh`，产物放 `/var/www/lab/kit/` |
| 注意 | ① 该机 :80 上 dify 的 `/api`、`/agent` 等 502 是**部署前既有状态**（dify 未运行，与本次无关）；② 本机（lab.xiaohe.biz 这台）DNS 解析不到 medai.nju.edu.cn，公网验证须从校园网做；③ ~~该机 CPU 是 QEMU vCPU（无 SSE4.2/POPCNT）~~ **【2026-09-29 复核：已不成立】** 实测 CPU 为 **INTEL XEON GOLD 6530**（`sse4_2` / `popcnt` / `avx2` 齐备），内存 31Gi，所以「sharp prebuilt 被拒 / 无法跑 Chromium 类工具」的前提**都不存在了**；镜像 `nju-lab-workspace:0.1.5-rc.2-no-sse42`（禁 5 个插件的旧版）仅作回滚保留。注意 `nju-lab.service` 的 `MemoryMax=800M` 是**后端服务**限额，与「跑浏览器做验证」是两件事，别混为一谈（此前混过）；④ **校园网关 `219.219.115.199`**（medai 与 authservertest 解析到同一 IP、按 Host 分发；正式认证机是另一个 IP `219.219.115.211`）策略为"校内/VPN 直通、校外强制认证"；**`authservertest` 是网关配置里指的测试认证机（对 medai 返回"应用未注册"），不是我们的** —— 我们代码/配置里搜不到它，`.env` 的 `CAS_BASE_URL` 一直是正式机。判定 302 是谁发的：公网响应无 `Server:` 头（网关发的）、直连本机有 `Server: nginx/1.18.0` + `X-Powered-By: Express`（我们的）；⑤ **该机不支持嵌套虚拟化**（无 `/dev/kvm`、无 kvm 模块，2026-09-28 实测）——**不能跑 KVM 虚拟机**，"每人一台 VM"在该机不可行，只能走容器；⑥ dify 遗留容器仍在运行（`docker-sandbox-1`/`db-1`/`redis-1`/`weaviate-1`/`ssrf_proxy-1`，Up 3 months），其中 **`docker-sandbox-1` 占约 8.2G 内存且 `--memory 0`（无限额）+ `restart=always`**，是内存侧唯一会突然挤爆的隐患，`~/dify` 另占磁盘 8.5G —— 处置前须确认学院无人使用 |


常用验证：

```bash
mysql -h 127.0.0.1 -u nju_lab -pnju_lab_dev nju_lab          # 进数据库
curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}'        # 登录拿 token
# 经 nginx 测线上：curl -sk --resolve lab.xiaohe.biz:443:127.0.0.1 https://lab.xiaohe.biz/...
```

### 2.2 前端产物部署纪律（2026-09-29 踩坑，别再踩）

同步 `/var/www/lab` 用 `bash deploy/deploy-web-lab.sh`（普通用户即可，不需要 sudo）。脚本固化的就是下面五条，
手工部署时同样必须遵守：

1. **顺序铁律：先写 `assets/` 新 chunk，最后才换 `index.html`。**
   `/lab/` 是 `try_files $uri $uri/ /lab/index.html` 的 SPA 回退 —— 若 index.html 先换、chunk 还没到位，
   浏览器要的 `/lab/assets/x.js` 会拿到 **`200` + `text/html`**（回退成 index.html 正文），ES module 按 MIME 解析即失败
   → **页面白屏，而 curl 看状态码一切正常**。实测：
   `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Host: medai.nju.edu.cn' http://127.0.0.1/lab/assets/NONEXISTENT.js` → `200 text/html`。
   2026-09-29 就是这么把线上短暂搞白过一次（发现后先回滚 index.html，再按正确顺序重做）。
2. **验证铁律：不能只看状态码。** 按**线上 index.html 实际引用的资源**逐个探测，要求 `Content-Type: application/javascript`，
   并与本地 `web/dist` 核对 md5。脚本第 4、6 步做的正是这两件事，自检失败会把 index.html 自动回滚成备份。
3. **旧 chunk 不删。** `assets/` 里同时保留几代 hash，缓存着旧 index.html 的浏览器才不会 404。
4. **会话里看到的 `nobody:65534` 就是宿主上的 `www-data`，别当成陌生属主。** Reasonix 会话跑在 user namespace 里，
   `cat /proc/self/uid_map` = `1000 0 1`（只有这一个映射）：除 uid 1000 外的属主一律显示为 overflow id `65534`，
   而且 **ns 内的权限检查会拒绝写入 —— 宿主上是 root 身份也没用**，`danger-full-access` 也无效（它只放开沙箱路径白名单，
   不改 inode 属主）。判定宿主真实属主用 docker：
   `docker run --rm -v /var/www/lab:/d nginx:alpine stat -c '%A %U:%G %n' /d /d/assets`（本机 docker.io 不通，用已就位的 `nginx:alpine`）。
   同理**沙箱内的报错不一定等于宿主结果**：2026-09-29 一次 `mv` 在会话里报了 6 条 `Permission denied`，宿主上其实已移动完成
   —— 结论一律以 docker / HTTP 实测为准（同 §2.1 注意⑦）。
5. **属主修复**（仅当 `assets/` 再次不属于当前用户、脚本提示不可写时）：
   `mv /var/www/lab/assets /var/www/lab/assets.pre-deploy-<ts>`（rename 只需父目录写权限）→
   `mkdir -m 755 /var/www/lab/assets` → 从旧目录补回历史 chunk → 再跑部署脚本（顺序仍是 chunk 先、index.html 后）。

## 3. 关键架构与纪律（踩坑沉淀，务必遵守）

1. **统一响应格式**：后端所有接口返回 `{code, data, message}`（code=0 成功）；前端 axios 拦截器统一解包。
2. **登录返回字段是 `accessToken`**（不是 token）——这个坑修过一次。
3. **新接口必须先定契约再两端实现，联调以 curl 实测为准**。前后端并行开发曾产生 10 类字段/结构不匹配（详见 craft 文档 §13），不要凭想象写字段名。
4. **认证：本地账号 + 南大统一认证（CAS 3.0）双轨**（njuserver 生产用 CAS，2026-09-24 起）
   - **本地**：`AuthProvider` 接口 + `LocalAuthProvider`（bcryptjs），只服务示例账号与开发。
   - **CAS**（`server/src/auth/cas.client.ts`）：标准 ticket 重定向流 —— `GET /api/auth/cas/login` → 302 `{CAS_BASE_URL}/login?service=` → 回调 `GET /api/auth/cas/callback?ticket=` 调 `/p3/serviceValidate` 校验 → `AuthService.loginWithCas()` 找/建用户 → 签发平台 JWT → 302 `{前端基路径}/login/cas?token=`。登出 `GET /api/auth/cas/logout` → 302 `{CAS_BASE_URL}/logout?service=`。配置：`CAS_BASE_URL` / `CAS_VALIDATE_PATH` / `PUBLIC_BASE_URL`（service 回调 = `${PUBLIC_BASE_URL}/api/auth/cas/callback`，**须在认证机管控台注册**）。
   - **角色判定**（`resolveRoleFromCasAttributes`）：CAS 3.0 的 `<cas:attributes>` 里 `containerId` 是 LDAP OU —— **`ou=JZG` = 教职工 → `teacher`**，其余（ou=XS 学生 / ou=YJS 研究生…）及拿不到时一律 `student`。**别用工号位数兜底**：实测南大工号有 7 位（如 `0611010`）、规律不可靠，误判成 teacher 是权限放大。新用户按此建号；已存在用户**只升不降**（管理员手工设的 teacher 不会被降回学生）。
   - ⚠️ **不要再加「读网关头直接签发」的路径**：上游网关拦截时代它会注入 `CAS-USER`/`CAS-USER-CN`，据此直接签发平台 token 的写法曾存在、网关放开后已移除 —— 请求头客户端可任意伪造（`curl -H 'CAS-USER: 任意学号'` 就能冒充任意账号，含管理员）。除非同时加来源 IP 白名单。
5. **角色**：`admin`（RolesGuard 放行一切 + 各服务归属校验豁免）、`teacher`、`student`。公开注册只允许 teacher/student。
6. **复验抽象**：`server/src/submissions/evaluation-runner.ts` 的 `EvaluationRunner` 接口，两种实现：`MockEvaluationRunner`（确定性假数据，无 Docker/key 的开发环境用）与 `DockerEvaluationRunner`（真实容器复验），`EVALUATION_RUNNER=mock|docker` 环境变量切换（默认 mock，当前 .env 为 docker）。
7. **部署纪律**：禁止把 Vite dev server 挂 nginx 当生产（HMR WebSocket 必挂）；前端产物放 `/var/www/nju-lab/dist`（不能放 `/home/ubuntu`，750 权限）；`sites-enabled/` 下所有文件都会被 nginx 加载，备份文件必须移出。**线上 `/lab` 前端静态产物同步的顺序与校验见 §2.2**（先 chunk 后 index.html；缺 chunk 会被 SPA 回退伪装成 `200 text/html`）。
8. **TypeORM migrations**：`synchronize: false` + `migrationsRun: true`（启动自动执行）；初始迁移 `src/migrations/1790002605000-InitialSchema.ts`（已在既有库手工登记、在空库实测建表后 schema:log 零 diff）。改实体后：`npm run typeorm migration:generate -- src/migrations/<Name>` 生成迁移并核对 SQL，新环境启动即自动建表。
9. **DSH 侧**：`agent/request` 是 waterfall，只能钉 provider/model/reasoningEffort/maxTokens；**钉工具集要用 `ctx.tools.restrict()`**；client 半由 client-modules 服务按 `package.json` 的 `dsh.client` 自动扫描挂载；slot 组件拿不到 ctx。
10. **复验安全姿态**（verify profile）：一次性容器 + 断网 + `approval=never` + 资源限额。容器是唯一信任边界（DSH 沙箱不挡网络与进程）。
11. **给模型的引导**（system prompt 段、skill）由**插件注册**即可随 profile 生效：`ctx.systemPrompt.section()` + `ctx.skills.register()`（见 `nju-lab-client/src/host/guidance.ts`），不必改 profile 文件。磁盘 `SKILL.md` 路线要额外配 `customSkillDirs` / `bundledSkillDir`，**profile 目录不是默认 skill 发现根**，且 `bundledSkillDir` 按进程 cwd 解析。skill 来源优先级（越小越优先）：project 100/200 · runtime 250 · custom 300 · user 400/500 · bundled 600。
12. **L2 测试要带 `DSH_BIN`**：`npm test` 在 PATH 上找不到 `dsh` 时，L2 用例是 **skip**（TAP `ok … # SKIP`）而不是失败，看起来全绿但什么都没验。另外 L2 启动 `dsh` 必须给临时 `cwd`，否则插件的默认 `workspaceDir`（`process.cwd()`）会把 `nju-lab/` 落盘目录写进仓库。
13. **容器隔离策略只有一份实现**：复验与工作台共用 `server/src/container-runtime/`（限额 / internal 网络 / SNI 白名单 / 挂载顺序都在 `buildRunArgs` 里定义一次）。**不要在业务模块里另写一套 docker 参数**——两处漂移就是安全配置漂移。
14. **评估条件必须跨进程持久化**：`evalConfig` 不能只存插件闭包 —— DSH 每次启动都是新进程（headless 每条任务一个），重启后工具面会重新放开，等于"学生自测条件 ≠ 平台复验条件"。插件做法（`nju-lab-client/src/host/eval-state.ts`）：claim 时写 `<workspace>/nju-lab/pinned-eval-config.json`，`apply()` 启动时读回并**优先于配置里的默认值**；平台本次未下发条件时**清掉旧值**，避免上一个实验的限制被继承。文件损坏/形状不对只警告并忽略（不能因为状态文件起不来）。

## 4. 距端到端的缺口清单（按建议实施顺序）

端到端定义：学生本地 DSH **登录 → 看任务 → 领取（真实模板+数据集、条件钉死）→ 开发 Skill → 自测 → 提交（真实 ZIP + .dshc + 审计事件）→ 服务端真实容器复验 → 教师批改 → 学生看反馈**。

### 第 1 步：平台文件上传/下载 —— ✅ 已完成（2026-09-21，curl 全链路实测）

- 后端 files 模块（`server/src/files/`）：`POST /api/files`（multipart，≤100MB，服务端算 sha256 为权威值）、`GET /api/files/:id`（登录即可，UUID 能力凭证；细粒度鉴权留待生产化）。存储在 `server/uploads/`（`UPLOAD_DIR` 可配），按 sha256 前缀分目录
- 项目实体：`skillTemplateRef`/`testDatasetRef` 字符串引用已删除，改为 `skillTemplateFileId`/`testDatasetFileId`；创建/编辑项目校验文件存在
- claim 接口返回 `skillTemplate`/`testDataset` 文件信息对象（`{fileId,url,originalName,size,sha256}`）+ evalConfig；学生端 `GET /api/projects/:id` 仅领取后带文件信息
- submit 接口支持 fileId 模式（`skillZipFileId`/`capsuleFileId`，须本人上传否则 403；服务端 sha256 为准，自报不符 400；ref 记为 `file:<id>`），兼容旧 ref+sha256 直填
- Web：教师编辑项目弹窗改为上传控件；项目详情/学生实验页（领取后）可真实下载（axios blob 带 JWT）
- 踩坑：文件流必须经 `StreamableFile` 返回，`TransformInterceptor` 对 `StreamableFile` 原样放行（直接 `stream.pipe(res)` 会被统一响应包装覆盖）
- 示例材料（真实 ZIP）已上传并绑定两个示例项目；源文件收在 `server/fixtures/`（模板 `csv-cleaner/` + 数据集 3 case，已验证自洽，改版方法见其 README）

### 第 2 步：插件 token 获取 + 提交工具 —— ✅ 已完成（2026-09-21）

**完整需求与契约见 `dsh/nju-lab-client/REQ-2026-09-21-submit-pipeline.md`**（claim 新响应结构、files API、submit fileId 模式、端到端验收标准）。要点：

- token（平台侧 ✅，D-lite+ 方案）：`POST /api/me/tokens` 签发 365 天 token（payload 带 `ver`）；`POST /api/me/tokens/revoke` 吊销（`User.tokenVersion`+1，全部 token 含 Web 登录态失效，JWT validate 逐请求比对）；Web 右上角头像菜单「API Token」弹窗可生成/复制/吊销。**插件侧已完成**：DSH 设置页的 `nju-lab` 节（`ctx.settings.installSection`，改动即时生效）+ `NJU_LAB_TOKEN` 双来源；缺失/被拒给可读指引，不裸 401
- `nju_lab_submit` 工具 ✅：自检（经 `resolveSkillRoot` 探测真正的 Skill 根）→ 逐文件 sha256（`fileHashes`）→ 纯 JS 打包 ZIP → 生成 `.dshc` → 分别 POST /api/files 上传 → 以 fileId 模式提交；真实平台联调后库里是 `skillZipRef=file:<id>`
- ClaimPanel ✅：从占位变真实面板（拉任务列表、领取/提交按钮、钉定条件展示），并做过交互与错误提示打磨
- claim 工具 ✅：真实下载模板/数据集 + sha256 校验 + 纯 JS 解压 + Skill 根探测；`evalConfig.tools` 经 `ctx.tools.restrict()` 钉白名单（claim 后对**已存在**的 agent 补一刀，保证同一会话内立即受限）
- **评估条件跨进程持久化 ✅**（2026-09-21 补）：`evalConfig` 不再只存闭包 —— claim 时写 `<workspace>/nju-lab/pinned-eval-config.json`，`apply()` 启动时读回并优先于配置默认值；平台本次未下发条件时清掉旧值。否则学生重启 DSH（headless 每条任务一个进程）后工具面会重新放开，等于"自测条件 ≠ 复验条件"。见 `src/host/eval-state.ts`；L2 用**两趟独立进程**验证第二趟一启动就被收窄

### 第 3 步：复验实证 + 真实执行器 —— ✅ 已完成（2026-09-21）

**实证已完成（2026-09-21，dsh/verify-poc/）**，核心结论：

- **dsh-teach 不存在（npm 404）→ 自写驱动脚本路线，已跑通**：`dsh/verify-poc/run-eval.mjs`（零依赖 Node 脚本）输入 skill 目录 + dataset 目录，每 case 跑 baseline（无 Skill）/treatment（有 Skill）两轮，与 expected.csv 比对，汇总结构化 JSON。真实模型运行（case01）：baseline ✅ / treatment ✅，单 case 两轮 ~25k input tokens、~90s
- **设计文档 §7 有两处错误**（已实测纠正）：headless **没有** `--json` NDJSON 模式、**不支持** stdin 传 task；结构化数据要从 session 持久化日志采集（`$DSH_HOME/sessions/**/session.v3.jsonl.zstd`，多帧 zstd 用 `zstd -dc` 解）
- **模型 provider**：`llm-deepseek` 的 `apiKeyEnv` + `baseURL` 可指任意 OpenAI 兼容端点；当前用 `MOONSHOT_API_KEY`（kimi-k2.6）跑通；将来换 DeepSeek 官方 key 只需改回默认 baseURL + DEEPSEEK_API_KEY（cordis.patch.yml 注释已写明）
- **profile patch 坑（已修）**：`workspace-write + approval=never` 不匹配任何内置权限预设，必须在 `permission` 行显式声明 `verify` 预设并钉 `defaultPreset: verify`；且 patch config 是整段替换非深合并
- **approval=never 实测生效**：工作区外写入被确定性拒绝，session 日志首三条事件为 `permission/preset: verify` / `sandbox/mode: workspace-write` / `approval/policy: never`
- 容器镜像注意：需带 `zstd` CLI、设 `DSH_TELEMETRY_DISABLED=1`（默认遥测外发 deepseeksvc.com）；轮数/成本无内建上限，靠容器 timeout + maxTokens 双重限制
- ⚠️ 评分标准决策点：Python csv.writer 默认 CRLF，逐字节 diff 会判负——PoC 同时报 `pass`（归一换行）与 `passStrict`（逐字节），平台需明确用哪个（见下）

**真实 EvaluationRunner 已实现并端到端实测通过（2026-09-21）**：

- 镜像 `nju-lab-verify:0.1.5-rc.2`（512MB，`server/verify-image/`：node:22-slim + dsh 锁定版 + zstd/unzip/python3 + 驱动脚本 run-eval.mjs + nju-lab-verify profile）
- `server/src/submissions/docker-evaluation-runner.ts`：file 引用 → uploads 真实路径 → `docker run --rm --memory 1g --cpus 1` 只读挂载 → LLM judge（{pass, score, rationale} 落库）→ 写 Evaluation；`EVALUATION_RUNNER=mock|docker` 环境切换（默认 mock，当前 .env 为 docker）
- 端到端实测：student1 提交真实 skill.zip → teacher verify → 107.6s / 22.7k tokens → Evaluation 写入真实数据（successRate=1、judge rationale、integrityCheck 自报哈希逐条对照、dossier 正确识别能力边界未填）
- 成本量级：1 case ≈ 23k tokens / ~108s；3 cases ≈ 68k / ~5min
- **已知遗留**：① ~~容器未断网~~ 已解决（2026-09-21）：SNI 白名单代理——`nju-verify-egress` internal 网络（无外网路由）+ 双宿主 nginx stream 代理（ssl_preread，白名单 api.deepseek.com / api.moonshot.cn），runner 每次复验前幂等确保；非白名单 DNS 黑洞、直连 IP 无路由均已负向实测；边界：按域名不按路径，学生代码可用自己的 key 调 DeepSeek（README 已标注）② judge 请求不能传 temperature:0（kimi 拒绝）③ exact 模式实现未 e2e ④ verify() 失败状态语义已修（runner 抛错 → submission 置 FAILED，可重新提交/复验）
- **模型事实源（2026-09-21 官方 API 实测）**：可用模型 `deepseek-flash` / `deepseek-v4-pro`；`reasoning_effort` 合法值 `none|minimal|low|medium|high|xhigh|max`。DeepSeek key 已存 `server/.env`（DEEPSEEK_API_KEY，管理员侧）；容器路由已切官方（Moonshot 回退方法见 profile patch 注释）；`agent/request` 钉 reasoningEffort 会被 dsh-llm-deepseek 拒绝（UNSUPPORTED_REASONING_EFFORT），effort 只能 profile config 层生效
- deepseek-flash e2e 实测：verify 34.9s / 24.4k tokens，judge rationale 与 integrityCheck 全部真实

### 第 4 步：证据包与审计真实化 —— ✅ 已完成（2026-09-21）

- `evidence.ts` 的 `buildCapsule()` 已是真实实现：经 `ctx.sessionPersistence` 取**本工作目录下各会话**（按 `header.cwd` 归属，跨多次 DSH 启动）→ 按 `approval/`、`permission/` 前缀筛审计事件 → 递归脱敏（字符串 200 / 数组 50 / 深度 6）→ 产出 `nju-lab.capsule/v1`（`sessions` + `auditEvents` + sha256 `integrity`，`note` 不入哈希）落盘 `evidence.dshc`
- 审计事件（`approval/*`、`permission/*`）从会话事件**自动提取**，随提交一并交给平台，替代学生手填 JSON
- 上传与提交：`evidence.dshc` 与 `skill.zip` 分别 `POST /api/files`，再以 fileId 模式提交（`capsuleFileId` + `auditEvents` + `fileHashes`）
- 工具集钉死：`ctx.tools.restrict()` 实现 evalConfig.tools 白名单（claim 后对已存在的 agent 补一刀）
- 实测（真 `dsh --profile headless` + fake LLM，L2）：17 个会话事件 → `permission/preset`、`approval/policy` 两条审计事件，无降级；`test/dsh-e2e.test.mjs` 的 `.dshc` 用例通过
- 客户端侧实现见 `dsh/nju-lab-client/src/host/evidence.ts`；平台侧消费（`capsuleSha256` 对照 + `auditEventsReceived` 计数）在 `server/src/submissions/`

### 第 5 步：体验打磨 —— ✅ 已完成（2026-09-21）

- ~~profile 内加 skill / system prompt~~ 实现为**插件注册、随 profile 生效**（`dsh/nju-lab-client/src/host/guidance.ts`）：常驻 system prompt 段（`nju-lab:workflow`，order 1800）+ 通过 `ctx.skills.register()` 注册的 `nju-lab-experiment` skill（模型目录 + 按需加载全文 + 学生可 `/nju-lab-experiment` 调用）。选它而非磁盘 `SKILL.md` 的理由与实测见 `dsh/nju-lab-client/README.md` §4（skill 来源优先级 project 100/200 · **runtime 250** · custom 300 · user 400/500 · bundled 600，越小越优先）
- ClaimPanel：列表 / 领取 / 提交 / 钉定条件展示，并做过交互与错误提示打磨（未解锁 / 无 token / 未领取时按钮禁用并给出原因；已领取后领取按钮变「已领取」、提交才可用；动作结果渲染成可关闭的成功/失败横幅，摊开落盘目录、下载物名称/大小/路径、Skill 根、submission id、两个 sha256 前缀）
- 验证：L2「引导与 skill 到达模型」在真 `dsh --profile headless` 下通过 —— 引导文字出现在请求的 `system` 消息里，skill 出现在模型目录里，`skill` 工具返回 `<skill_content name="nju-lab-experiment">` 正文

### 工作量估计

第 1-5 步均已完成（2026-09-21）：插件侧由 `nju-lab-client` 承担（61 条测试 = 55 L1 + 6 L2，`DSH_BIN=… npm test` 在真 DSH 下全绿），平台侧第 1、3 步已上线，端到端验收通过（`docs/ACCEPTANCE-2026-09-21.md`）。生产化补齐：容器 SNI 白名单网络隔离（负向实测）、`evalConfig.model` 逐项目映射（v4-pro 实测）、verify 失败置 FAILED。剩余小项：评分口径（`pass` vs `passStrict`，当前 LLM judge 已覆盖主路径）、`exact` 模式 e2e。

## 5. 后续阶段（端到端之后，见 craft 文档 §10）

- ~~修改密码接口~~ ✅（2026-09-21：`POST /api/me/password`，成功后 tokenVersion+1 全端失效；Web 头像菜单弹窗）、~~数据库 migrations~~ ✅（见第 3.8 条）、~~后端常驻化~~ ✅（systemd，见第 2 节）、~~CSV 成绩导出~~ ✅（`GET /api/projects/:id/grades.csv`，项目详情页"导出成绩 CSV"按钮）
- ~~统一认证（CAS 3.0 双轨）~~ ✅ **已完成并上生产**（2026-09-21 接入，2026-09-24 **真实账号实测通过**）：`GET /api/auth/cas/login` → 南大 authserver → `/api/auth/cas/callback` 校验 ticket（`/p3/serviceValidate`）→ **按 CAS 属性 `containerId` 定角色**（`ou=JZG`=教职工→teacher，其余→student；**已不再一律注册为学生**，教师也不用管理员手工提权）→ 签发平台 JWT；登出 `GET /api/auth/cas/logout` 接 CAS 登出。配置 `CAS_BASE_URL`/`CAS_VALIDATE_PATH`/`PUBLIC_BASE_URL`（均指向正式机 authserver.nju.edu.cn）。详见 §3.4
- ~~学生端安装包/手册~~ ✅（2026-09-21）：`dsh/kit/build-kit.sh` 打包（profile + 插件产物 + install.sh + 手册）→ 静态托管 `https://lab.xiaohe.biz/kit/nju-lab-student-kit.zip`（nginx `location /kit/` 独立目录）；Web 学生菜单「客户端下载」页。插件更新后需重跑 build-kit + 部署
- ~~提交多版本~~ ✅（2026-09-22）：`submissions.version`（迁移 `SubmissionVersions1790002700000`，存量按 submittedAt 回填）；重复提交生成 v2、v3…，上限 10 版，仅最新版 `verifying` 中拒绝（原「非 failed 拒绝重复提交」废止）；每版本独立复验/评分；版本历史 `GET /api/assignments/:id/submissions`（学生限本人/教师限课程 owner）；项目提交列表、待批改、成绩 CSV、学生任务列表一律按**最新版**归并（修了 `listProjectSubmissions` Map 键覆盖取到最旧版的 bug）；Web 学生「我的提交」可交新版本+反馈 Drawer 版本切换，教师批改页版本切换；插件面板显示 `v{n}` +「提交新版本」。全链路真机实测（含真实容器复验 v4）
- 机房预装镜像
- nju-lab-client 提交前自检（skillforge 规范检查）
- SkillLibrary 参考技能库、章节自测题、成绩汇总
- ~~章节在线幻灯片（reveal.js，按章节用大模型生成在线演示）~~ ✅ **已上线**，LLM 生成已达「商业可用」验收线（deepseek-flash，prompt v3 + 版式系统升级 + 盲评通过，见 §9）

## 6. 课程目录、选课申请与工作台 —— ✅ 已完成（2026-09-24）

完整设计见 **`docs/DESIGN-course-application-2026-09-24.md`**（含当天的方向修订，见其 §10）。要点：

**背景**：改造前 `/lab` 全站在 `RequireAuth` 后，未登录访客什么都看不到；学生只能看到教师手工加进名单的课（未入册时返回**空列表**），既不能发现课程也不能自己选课。

**⚠️ 当天二次决策（务必知悉）**：初版把课程目录做成「**无需登录的公开区**」（独立 `PublicLayout` + `@OptionalAuth()` 匿名放行 + `/api/public/courses`）。当天下午按产品决策**收回为登录后可见**：

| | 初版 | 现行 |
|---|---|---|
| 未登录访客 | 能浏览课程目录/详情 | **直接落登录页** |
| 接口 | `/api/public/courses[/:slug]` + `@OptionalAuth()` | `/api/browse/courses[/:slug]`，需登录（`@OptionalAuth()` 已删） |
| 布局 | 独立 `PublicLayout`（深色顶栏） | 并入平台内布局（与工作台同壳） |

**现行形态**：

```
门户（FoxCMS，公开）→「实验平台」外链栏目 → /lab/  （未登录则落登录页）
/lab（需登录）
   · 工作台：学生 /student/home、教师 /teacher/dashboard（登录后的落地页）
   · 选课：/browse 课程目录 → /course/<slug> 课程详情 → 申请
   · 学习与实验：章节、实验、提交、复验、成绩
```

**核心语义**（未变）：`Course.status = published` 只表示「别人能看到」；**能否申请由 `applicationOpenAt` / `applicationCloseAt` / `capacity` 独立决定**（支持"先展示、到点开放申请"的热门课策略）。`applicationState` 由后端算（依赖已批准人数，前端算不出），取值 `open`/`not_open_yet`/`full`/`closed`/`not_published`。

**数据层**：
- 新增 `course_applications`：**不给 `Enrollment` 加状态**——保持它「已批准入册」的语义，可见性/内容授权/任务分发三处依赖它的代码**零改动**，且"容量按批准数"天然对齐
- 生成列 `pendingFlag = IF(status='pending',1,NULL)` + 唯一索引 `uq_course_application_pending`（利用 MySQL 唯一索引允许多个 NULL）→ **允许重复申请，但同一课程同一学生同时只能有一条 pending**；申请历史完整保留
- `courses` 新增 `slug` / `capacity` / `applicationOpenAt` / `applicationCloseAt`；迁移 `CourseApplications1790224400979`（含既有课程 slug 回填）

**关键实现点（踩坑）**：
1. **`@OptionalAuth()` 第三态**：原先只有「全拦」与 `@Public()`「全放」两种；公开课程页需要「带 token 识别身份、不带也放行」，否则登录用户看不到自己的申请状态
2. **补发 Assignment 必须用独立方法，不能复用 `publishProject()`**：后者开头就把 `project.status` 改回 `PUBLISHED`（对已发布项目等于重新发布）、**不校验当前是否 draft**（会误发布草稿）；且 `ProjectStatus.CLOSED` 虽是纯预留、目前从未被任何代码设置，一旦将来启用「截止关闭项目」，那里的检查会让补发抛错。现为 `CourseApplicationsService.backfillAssignments()`，只挑 `status = PUBLISHED` 的项目补建
3. **批准在事务里锁课程行**（`pessimistic_write`）：逐个批准下两个标签页同时批最后两个名额不会超额
4. **满员不清空队列**：`full` 只阻止**新申请**；已提交的 pending 保留，退课释放名额后可继续补批（实测：退课 → state 回 `open` → 补批成功并补发任务）
5. **CAS returnTo 用 sessionStorage**（`web/src/session.ts`）：后端 `service` 固定不接受外部传入（防开放重定向，别动），所以「课程页点申请 → CAS 登录 → 回到那门课」只能前端携带
6. **`path: '*'` 兜底重定向**改掉了：原先一律去 `/`（在 RequireAuth 下），未登录访客会被弹到登录页；现为匿名→`/browse`、已登录→角色首页
7. 顺带修正一处**既有 schema 漂移**：`submissions` 的复合索引 `IDX_submissions_assignment_version` 只在迁移里手建、实体没声明，导致 `migration:generate` 每次都生成一条无关的 `DROP INDEX`。已在 `Submission` 实体补 `@Index('IDX_submissions_assignment_version', ['assignmentId','version'])`

**接口**：
```
课程目录与详情（需登录）
  GET  /api/browse/courses            目录 + 检索(keyword/term)
  GET  /api/browse/courses/:slug      课程详情（章节只给标题，不含教学内容；附 myApplication/myEnrollment）
学生
  POST   /api/courses/:courseId/applications        申请
  DELETE /api/courses/:courseId/applications/:id    撤回（仅 pending）
  GET    /api/me/applications                       我的申请
教师
  GET  /api/courses/:courseId/applications          列表（按 createdAt 升序＝先到先得）+ 名额/队列信息
  POST /api/courses/:courseId/applications/:id/approve   批准（建入册 + 补发任务，返回 assignmentsCreated）
  POST /api/courses/:courseId/applications/:id/reject    驳回（可选 note）
```

**前端**：
- **学生工作台** `/student/home`（新增）：统计卡（我的课程/待办实验/待审批申请/章节完成度）+ 待办实验列表 + 「去选课」入口。学生与教师的登录落地页都是工作台
- 选课 `/browse` → 课程详情 `/course/:slug`，与平台其他页面共用 `AppLayout`（不再是独立公开站）
- 教师端课程详情新增「公开报名」页签：名额上限、申请开放/截止时间、当前状态、公开链接
- 学生菜单新增「选课」「我的申请」；教师报名审批（逐个批准/驳回、显示待审批/已批准/剩余名额）——**2026-09-28 并入课程详情「学生管理」页签**（报名申请与选课名单合为一张统一表格），原独立页 `/teacher/courses/:courseId/applications` 已取消
- 被驳回后可重新申请（列表提示 + 可再次提交）
- 深链被 `RequireAuth` 拦下 → 登录（含 CAS）后回到原页面（`web/src/session.ts` 的 returnTo）

**端到端实测（2026-09-24，curl）**：浏览课程目录 → 教师配置名额与开放时间 → 学生申请 → 重复申请被拒 → 教师批准（补发 1 个任务，学生任务列表出现）→ 驳回（带理由，学生可见）→ 重新申请成功 → 收名额至满（`full`）→ 满员批准被拒「名额已满」→ 满员新申请被拒 → 退课释放名额 → 队列中的申请补批成功。

**收回归档后的接口验证**：未登录 `GET /lab/api/browse/courses` → **401**；旧路径 `/api/public/courses` → **404**；登录后正常返回目录。

**门户接入**：FoxCMS 新增栏目「实验平台」（`fox_column` id=128，`column_attr=1` 外链，`out_link=/lab/browse`），`templates/foxui01/nav.html` 的 `typeid` 加入 128；顺带删掉导航里指向不存在栏目的死项 `typeid='3,4'`。栏目记录在 `foxcms/sql/column-lab-entry.sql`（便于他处复用）。未登录点它会被 `/lab` 的登录页接住。

## 7. 协作方式备忘

**仓库与远端（2026-09-26 收敛后）**
- **仓库根就是 `~/nju-lab` 本身**（原先并列的 `repo/` 工作副本已取消，见 §2.1「目录收敛」）；**单一远端 `origin` = GitHub**（`git@github.com:jilongcui/nju-lab.git`），SSH key 已登记、`fetch`/`push` 直连可用
- git 提交身份已配好（local + global 均为 `jilongcui <jilongcui@163.com>`），`git commit` 无需再带 `-c`
- 部署目录 `~/nju-lab/server` 是仓库子目录，`dist`/`.env`/`uploads`/`node_modules` 均在 `.gitignore`；**禁止直接在部署目录改代码**

**改代码 → 编译 → 同步 → 提交**
- 后端：`cd ~/nju-lab/server && npm run build && sudo systemctl restart nju-lab`（`restart` 已配免密 sudo，见 `/etc/sudoers.d/nju-lab`）。开发期用 `npm run start:dev`（ts-node 直跑 `src/`，手动前台、不走 systemd，**需先停 systemd 服务**以免抢 3100 端口）
- 前端：`cd ~/nju-lab/web && VITE_BASE=/lab/ npm run build`（**必须带 `VITE_BASE=/lab/`**，否则 base 不对、子目录部署白屏）→ 把 `web/dist` 同步到 `/var/www/lab`（属 www-data）：有 sudo 时 `sudo cp -rf web/dist/. /var/www/lab/ && sudo chown -R www-data:www-data /var/www/lab`，无 sudo 时按 §2.1 的 docker 绕法。**只动 `index.html`+`assets/`，别碰 `kit/`**
- 提交：`cd ~/nju-lab && git add -A && git commit -m "…" && git push origin main`
- 改了实体（entity）→ `npm run typeorm migration:generate -- src/migrations/<Name>`；服务启动时 `migrationsRun: true` 自动执行

**环境注意**
- ⚠️ 线上跑的是**正式版**（systemd → `node dist/main.js`，`NODE_ENV=production`）：改 `src` 不生效，必须 build + restart；开发版是 `start:dev`
- ⚠️ 受限会话（含 agent）带 `no_new_privs`，`sudo` 无法提权，跑不了 `systemctl restart` 等需 root 的操作；这类步骤一律在持有 sudo 的终端执行
- 前后端联调纪律见第 3.3 条；每完成一块同步更新 `nju-lab-craft.md` §13 与本 HANDOFF，代码提交进 git（main 分支）

## 8. 平台侧实验工作台 —— ✅ 已上线：原生 WebSocket 端到端打通（2026-09-29，见 §8.7）

### 8.1 一句话

给「本地装不上 DSH」的学生提供浏览器即可用的实验环境（一人一容器，单用户单会话）。
**设计文档必读**：`docs/DESIGN-2026-09-28-platform-workspace.md`（含两条并行路径与全部取舍）。

**当前状态（2026-09-29）**：兜底环境**已在浏览器中可用** —— 领取任务与对话交互由使用方验证通过
（见 §8.5 第 3 条）；剩「提交 → 平台复验」未跑。以下 09-28 的记录保留作背景。

**2026-09-28 三次更新**：后端 + 容器 + **nginx 反代**已端到端实测通过
（`enter` 种 cookie → 页面 200 / 静态资源 / 10.9MB 插件包 / RPC / **WebSocket 101** / SSE /
伪造 cookie-key 被拒 / 无会话流量原样回落 FoxCMS）。

**反代形态定案（关键）**：原设计的朴素子路径 `/lab/ws/<key>/` **已证伪**（dsh 的运行时路径
锚定 origin 根，§8.3 第 4 条）；而「独立域名/端口」在 medai 上**不可得**（学生只能走 80 端口、
Host 只能是 `medai.nju.edu.cn`）→ 采用等价形态：

> **页面认路径**（`/lab/ws/<wsKey>/…`）+ **dsh 写死的根路径认 cookie**
> （`/api/**`、`/plugins/**`、`/open-in-app/**` 由会话 cookie `nju_ws` 认领容器，
> **没有会话的流量原样回落 FoxCMS**）。cookie 由后端 `GET /lab/api/workspace/enter?k=<wsKey>` 种下。

**仍缺**：① 浏览器里跑通完整实验流程；② ~~宿主机 nginx 真实部署~~ ✅ **2026-09-29 核对：宿主机 nginx 片段已部署完毕**
（`/etc/nginx/snippets/` 两份与仓库 `deploy/nginx/` 逐字节一致，`nginx.conf`/`cms.conf` 均已 include，见 §8.5 第 1 条；
前端入口页已完成）→ 工作台侧遗留只剩 §8.5 第 1.5 条的**校园网关 WebSocket 透传**。
⏳ **网关不接受 WebSocket 的绕行方案（B）已就位**：容器内 WS→HTTPS 桥 + 页面适配，端到端实测通过，
靠 `WORKSPACE_WS_BRIDGE` 一个开关即可切回原生 WS —— 见 §8.5 第 1.5 条与设计文档 §4.6.1。

✅ **2026-09-28 另：路径 B 已落地** —— VM CPU 改为 host-passthrough（Xeon Gold 6530，SSE4.2/POPCNT/AVX2），
sharp 恢复、路径 A 禁用段退役、工作台镜像已重建为**完整功能**（文件上传/附件/交付物面板/会话控制器）。
详见 §8.4 与设计文档 §2.3。

### 8.2 已完成

| 组件 | 位置 | 验证程度 |
|---|---|---|
| 通用容器运行时 | `server/src/container-runtime/` | ✅ 复验行为**逐字节等价**（假 docker 对比 HEAD 与现状） |
| 工作台镜像 | `server/workspace-image/` | ✅ 端到端（起容器 → dsh web → 200 + UI 主干加载）；✅ **2026-09-28 已重建为完整功能版**（路径 A 退役，见 §8.4） |
| 工作台后端 | `server/src/workspace/` | ✅ 端到端（start → 16s 就绪 → 200 → stop）+ per-session authority + `enter` 入口（§8.3 第 5 条） |
| 重启后的容器接管 | `workspace.service.ts` 的 `adoptOrReclaim()` | ✅ 实测：重启后端后容器仍在、`status=running`（`wsKey` 重生成），环境可继续用（设计文档 §4.7.1） |
| 工作区持久卷 | `studentMounts()` | ✅ 实测：`<根>/<userId>` → `/work`、`…/dsh-sessions` → `$DSH_HOME/sessions`；删容器重建后文件仍在（设计文档 §4.8）。⚠️ 依赖 `<根>` 可写（默认 `/data/workspaces`） |
| nginx 反代 | `deploy/nginx/medai-workspace-{http,server}.conf`（带取舍说明版 `lab-nginx-snippet.conf`） | ✅ **配置形态已实测**（真实后端+镜像：enter 种 cookie → 页面/RPC/**WebSocket 101**/SSE/10.9MB 插件包/伪造凭据被拒/无会话回落 FoxCMS）；✅ **2026-09-29 已在宿主机部署并核对**（`/etc/nginx/snippets/` 两份与仓库逐字节一致，`nginx.conf`/`cms.conf` 均已 include） |

> 反代实测方式（可复现）：临时后端实例（`PORT=3000 npx ts-node -T src/main.ts`，
> 带 `WORKSPACE_PUBLIC_BASE='http://{key}.ws-test.local:18080'`）+ 容器内 nginx
> （`--resolve` 模拟子域）+ `curl`。测完的临时 nginx 与容器均已回收。

### 8.3 六条实测结论（踩过，别再踩）

1. **`--internal` 网络的容器不会建立端口发布** —— `docker run -p` **静默失效**（`docker port` 为空）。
   对外访问**只能走容器 IP**（宿主对 `br-xxxx` 的 `172.18.0.1/16` 有直连路由）。
   设计文档 §4.5 早期写的是"端口映射"方案，**已被实测推翻并更正**。
2. **dsh web 硬禁 `--host 0.0.0.0`**（理由："会把远程代码执行暴露到网络"）→ 容器内必须有一层 TCP 转发，
   已实现在 `server/workspace-image/entrypoint.mjs`（纯 TCP 层，不解析 HTTP）。
3. **dsh 的 browser-trust fence 只信任显式声明的 authority** —— 连它自己绑的 `127.0.0.1:<port>` 都不默认信任。
   必须传 `--trusted-host`，否则**一律 401**。entrypoint 会自动把自己网卡的 `IP:PROXY_PORT` 加进信任列表。
4. **反代不能走子路径**（**2026-09-28 反代实测，推翻了原设计**）：浏览器里的 dsh 把运行时路径
   全锚定在 **origin 根** —— RPC `new URL("/api/…", location.origin)`、
   WebSocket `wss://<origin>/api/remote.mux`、SSE `/plugins/events`、插件包 `/plugins/??…`。
   子路径 `/lab/ws/<key>/` 下页面**能开**（`sub_filter` 改写 HTML 生效），但这些绝对路径会打到
   宿主根 `/api`（njuserver 上是 dify → **502**）/404 → **功能全废**。
   → 「每会话独占一个 authority」（子域/独立端口）是最干净的通用解，但 medai 上不可得
   （见第 6 条）；配置形态见 `lab-nginx-snippet.conf` 注释（形态 A / 形态 B 都写在里面）。
5. **`Host` 必须传外部 authority，`wsKey` 必须大小写安全**（同上实测）：
   - nginx `proxy_set_header Host $http_host`（**不能传容器 IP**）：dsh 的 WebSocket 会校验
     `Origin` 与它看到的 `Host` 是否受信任 —— 传容器 IP 时 HTTP 全通、**WebSocket 一律 403**；
     同时后端要按 `WORKSPACE_PUBLIC_BASE` 的 `{key}` 把该 authority 传进容器的 `--trusted-host`。
   - `wsKey` 作为**子域**出现，而 URL 规范/浏览器/`new URL().host` 都会把 hostname 小写化：
     用 base64url 时 key 被改写 → `auth_request` 查不到会话 → **403**。现用 16 字节 hex。
8. **校园网关还会掐掉任何"流式响应"（约 20 秒）**（2026-09-29 实测）：
   即使把 WS 换成 SSE 长连接也一样 —— **宿主直连**的 SSE 能活满 50 秒（心跳正常），
   而**经网关**的同一个流每 16–24 秒就被 `client aborted`，且把心跳从"注释行"改成"真实事件"
   也拦不住（说明不是空闲超时，而是网关对流式响应的硬性时限）。
   ⇒ 工作台的下行**改用 1 秒短轮询**（`GET /wsbridge/poll?id=&since=`，对长连接零假设），
   上行仍是 POST；SSE 端点保留在代码里，将来网关放开长连接可切回（`_openStream`）。
   代价：流式回复有 ~1 秒颗粒感。

7. **校园网关不透传 WebSocket 升级**（2026-09-28 实测）：
   浏览器侧 `wss://medai.nju.edu.cn/api/remote.mux` 一直失败（dsh 前端报 `connection lost, retry #N`），
   access.log 里对应的是 **404 / 45 字节**——既不是 dsh 的 404（9 字节 `not found`），也不是本机 nginx 的
   403/502，说明**升级请求没有以"升级"形态到达本机**。
   对照实验（绕开网关，直连本机 nginx，带完整升级头）→ **101 Switching Protocols**；
   同一 URL 若剥掉 `Upgrade`/`Connection` → dsh 回 404 `not found`（9 字节）。
   ⇒ 本机 nginx / cookie 分流 / 容器全部正常；需要**网关侧开启 WebSocket 透传**
   （或改走不带 TLS 终止的入口）。注意 WS 是 dsh 会话事件流的唯一通道（`/api/remote.mux`），
   SSE `/plugins/events` 只是插件热重载，**没有 WS 时 UI 只能打开、不能真正交互**。

6. **单 Host（medai）下的定案形态：页面认路径 + 根路径认 cookie**（2026-09-28 实测）：
   独立域名/端口不可得（学生只能走 80 端口、Host 只能是 medai），于是把会话标识**拆成两半** ——
   页面 `/lab/ws/<wsKey>/…` 用**路径**里的 key；dsh 写死的 `/api/**`、`/plugins/**`、
   `/open-in-app/**` 用**会话 cookie**（`nju_ws`，由后端 `GET /lab/api/workspace/enter?k=<wsKey>` 种下）
   认领容器；**没有会话的流量回落原系统**（204 无 header → FoxCMS，dify/FoxCMS 完全不受影响）。
   三个 nginx 坑（都实测踩过）：① `auth_request` 的 URI **不支持变量**（→ 让 auth 子请求
   自己读 `$cookie_…`）；② **不能用 `if` 判断 auth 结果**（`if` 在 rewrite 阶段、
   `auth_request_set` 在 access 阶段 → 恒为空，必须用 `map` 惰性求值）；③ `rewrite … break`
   会**终止同一 location 里后续的 `set`**。
   边界：会话 cookie 只有一个 ⇒ **同一浏览器同时只能进一个工作台会话**。

### 8.4 两条并行路径 —— ✅ 均已收敛（路径 B 落地，2026-09-28）

njuserver 原先的 QEMU vCPU 无 SSE4.2 → `sharp` 崩 → `dsh web` 起不来。当时的对策：

- **路径 A（已退役）**：profile 里禁 5 个消费者插件
  （`server/workspace-image/profile/nju-lab-workspace/cordis.patch.yml`）。
  代价是**无 UI 文件上传 / 附件显示 / 交付物面板 / 会话控制器**。
  ⚠️ 该禁用段现已**删除**；文件里保留了注释形式的"恢复方法"——
  **只在目标机器无 SSE4.2/POPCNT 时才需要它**。
- **路径 B（✅ 已完成）**：VM 的 CPU 模型改为 `host-passthrough` 并重启
  （`/proc/cpuinfo` = `INTEL(R) XEON(R) GOLD 6530`，含 sse4_2/popcnt/avx/avx2；
  `require('sharp')` OK，libvips 8.18.6）→ 禁用段删除、**镜像已重建**，恢复完整功能。

**验证口径（可复现）**：删段后 dsh web 于是就绪、无 pending；index 26279 → **28110** 字节，
4 个 client 插件回到 UI 清单；`--dump-config` 的 `disabled: true` 从 **31 → 26**（全为 dsh 默认）；
WebSocket 101、SSE 200 正常。

### 8.5 遗留清单（接手者按序看）

1. ~~**宿主机 nginx 未部署（最高优先，配置形态已实测）**~~ ✅ **2026-09-29 核对：已部署完毕，本项关闭** ——
   `/etc/nginx/snippets/` 下的 `medai-workspace-http.conf` / `medai-workspace-server.conf` 与仓库
   `deploy/nginx/` 版本**逐字节一致**，且 `/etc/nginx/nginx.conf:12` 的 `http{}` 与
   `/etc/nginx/sites-enabled/cms.conf:51` 均已 include。工作台侧唯一遗留即下面的第 1.5 条。
   重做参考（只在换机器/重装时用）：`sudo cp deploy/nginx/*.conf /etc/nginx/snippets/` →
   在 `nginx.conf` 的 `http{}` 加 `include /etc/nginx/snippets/medai-workspace-http.conf;` →
   在 `sites-enabled/cms.conf` 的 server 里加 `include /etc/nginx/snippets/medai-workspace-server.conf;` →
   `sudo nginx -t && sudo systemctl reload nginx`。
   （这两个片段已在容器里按**现网 cms.conf 的真实结构**拼装做过 `nginx -t` 校验，syntax ok。）
   完整取舍说明见 `lab-nginx-snippet.conf` 与设计文档 §4.5.2。
1.5 **（2026-09-28 新增，最高优先）网关 WebSocket 透传** —— ✅ **已结案（2026-09-29，见 §8.7）**：见 §8.3 第 7 条 ——
   📄 **可直接转发给网络中心的说明与配置：`docs/OPS-2026-09-29-gateway-websocket.md`**（2026-09-29 整理，
   含现象/证据、网关 nginx 四步改法、验证方法，以及网关开好后我方关桥的步骤与顺序要求）。
   本机链路已实测 101，需网络中心在**校园网关**上开启 WS 升级透传
   （若网关是 nginx，**手工 4 步**：
   ① `http{}` 里加 `map $http_upgrade $connection_upgrade { default upgrade; '' close; }`；
   ② 承载 medai 的**每个** server 块（80 与 443 各一个）里加 `proxy_http_version 1.1;` +
      `proxy_set_header Upgrade $http_upgrade;` + `proxy_set_header Connection $connection_upgrade;`；
   ③ ⚠️ 若该 server/location 里**已有** `proxy_set_header Connection close;`（或 `""`），
      它会覆盖②新增的那行 —— 必须删掉或改成 `$connection_upgrade`，这是最常见的漏改点；
   ④ `nginx -t && nginx -s reload`。若是其他反代/负载设备，开"WebSocket 支持"开关）。
   **当前处置（2026-09-28）**：已实现**方案 B** —— 容器内 `bridge.mjs` 把 dsh 的 WS
   拆成「下行 SSE + 上行 POST」（都是网关放行的普通 HTTPS），页面注入 `/wsbridge/client.js`
   做适配，**全体仍是 https**。端到端实测通过（详见设计文档 §4.6.1）。
   · 切回原生 WS（网关开好之后）：注入 `WORKSPACE_WS_BRIDGE=0` 即可，不用改前端/nginx
   · 涉及改动：镜像新增 `bridge.mjs`/`ws-bridge-client.js` + entrypoint 起桥；
     后端 `WORKSPACE_WS_BRIDGE`（默认开）与 `X-Workspace-Bridge-Upstream`；
     nginx 片段新增 `location ^~ /wsbridge/` + 页面注入一行 script
   · 已知边界：桥让**上行**帧变成"一帧一个 POST"（下行一条 SSE）；若网关连 SSE 长连接也掐，
     桥侧会话 linger 60s，客户端重连即可（会有短暂空窗）
   **实测进展（2026-09-29，抓包）**：内网方向的链路只有一跳 ——
   `客户端 → 219.219.122.131（反解 paper.nju.edu.cn）→ 10.28.128.56:80`；
   校外那台 CAS 网关 **`219.219.115.199` 不在这条路上**（它对校外源一律 302 到
   `authservertest`，从本机测也是 302）。抓包结果：`Upgrade: websocket` 与
   `Connection: upgrade` **已透传成功** ✅，但 **`Host` 被写成 `10.28.128.56`** ❌
   —— 上游 nginx 未显式设 `proxy_set_header Host`，用了默认的 `$proxy_host`。
   按 §8.3 第 5 条，`Host` 不在 dsh 的 `--trusted-host` 里会让 **WebSocket 一律 403**
   （HTTP 全通 = "页面能开、一直 connection lost"）。**上游已修复（2026-09-29 抓包复验：
   上游传进来的 Host 已由 `10.28.128.56` 变为 `medai.nju.edu.cn`）**。复现命令与判读见
   `docs/OPS-2026-09-29-gateway-websocket.md`「当前实测状态」。
   **本机侧兜底已实现并部署（2026-09-29 10:27）**：新增 `map $http_host $ws_out_host`
   （`deploy/nginx/medai-workspace-http.conf:21`），转发到容器的 5 处 `proxy_set_header Host`
   从 `$http_host` 改为 `$ws_out_host` —— 非 `medai.nju.edu.cn` 的 Host 一律纠正回对外
   authority。已用 `nginx -t` + 真实请求验证（上游传 `10.28.128.56` 时容器收到
   `medai.nju.edu.cn`）。**部署**：`sudo cp deploy/nginx/*.conf /etc/nginx/snippets/ &&
   sudo nginx -t && sudo systemctl reload nginx`（已执行，线上与仓库逐字节一致）。
   **线上抓包复验通过**：同一请求经 122.131（`Host: 10.28.128.56`）→ 本机转发给容器时
   已是 `Host: medai.nju.edu.cn` ✓。上游改对后此兜底退化为恒等映射。
   ⚠️ 兜底只救工作台这条链路；上游把 Host 改写成内网 IP 是全局行为（生成链接/重定向/日志/
   将来的子系统都受影响），所以**上游那行仍要补**。
   ✅ **端到端 101 已实测通过（2026-09-29 11:39，见 §8.6）** —— 原判定方法保留在下面备查。
   ⏳ ~~截至 2026-09-29 10:28，端到端 101 仍未被实测~~（`access.log` 里 `101` 计数 = 0，
   且当时无活跃工作台容器）—— 需有人在内网真正进一次实验环境才算确认。
   **判定方法（等实际使用时跑一次即可）**：
   `grep -a "remote.mux" /var/log/nginx/access.log | tail -5` +
   `grep -a -c " 101 " /var/log/nginx/access.log`。判读：
   `101` → ✅ 原生 WebSocket 通了；
   `404` + 9 字节 → 到了容器但没升级（升级头又在某一跳被剥掉）；
   `200`/85 或 `403`/21 → 会话 cookie 失效（重新走一次「进入实验环境」；注意**后端重启会让
   wsKey 重生成、浏览器里的旧 cookie 全部失效**，2026-09-29 07:08 那次重启后 07:29–09:43
   的全部失败都是这个原因，不是网关）。
2. **独立域名/端口形态（形态 A）已确认不可得**（学生只能走 80 端口、Host 只能是 medai，
   2026-09-28 使用方确认）→ 现用 §8.3 第 5 条的 cookie 分流形态；将来若拿到域名/端口可切回形态 A。
3. **浏览器实测** —— 🟢 **2026-09-29：兜底环境在浏览器中已真正可用**：
   **领取任务（claim）与对话交互由使用方验证通过** ✅（路径 B + 容器内 WS 网桥之后，
   原先缺的会话控制器/文件上传等插件都回来了，不再有"路径 A 缺功能"的问题）。
   **已完成**：`开发 → 自测 → **提交**` ✅ —— 2026-09-28 23:15~23:18 由使用方提交三次
   （v3/v4/v5），`POST /lab/api/files` ×2 + `POST /lab/api/assignments/<id>/submit` 全部 **201**，
   DB 三条 `submitted` 记录齐全（skillZipRef/capsuleRef 均为真实上传文件）。
   **仍待**：「教师触发复验 → 平台跑真实容器评估」这一段**尚未跑**
   （入口 `POST /api/submissions/:id/verify`，须课程 owner 教师或 admin 触发；
   `.env` 的 `DEEPSEEK_API_KEY`/`MOONSHOT_API_KEY` 与 runner 的透传已核对就绪，随时可跑）。
4. ~~前端入口页~~ ✅ 已完成（2026-09-28）：`web/src/pages/student/Workspace.tsx`，
   学生/教师菜单「实验环境」；`start` → 轮询 `status` → 就绪后导航到 `enterUrl`
   （`apiUrl(info.enterUrl)`，后端种 cookie + 302 到工作台首页）→ `stop`。
   ⚠️ **不要直接打开容器地址或 `publicBase`** —— cookie 分流形态必须经 enter 这一步。
   **待浏览器实测**（与第 3 条一起做）。
5. **容器未加固**：目前以 **root** 跑。生产前应加非 root、cap-drop、只读根。
6. ~~平台 API 可达性未在真实链路验证~~ ✅ **2026-09-29 已实测**：
   · 容器里**自动**注入 `NJU_LAB_TOKEN`（24 小时短时效 JWT，`AuthService.issueWorkspaceToken`）
     与 `NJU_LAB_SERVER_URL` —— 兜底环境不该让学生手填 token；
   · 平台域名经 `--add-host` 指到宿主在**隔离网络**里的地址（`172.18.0.1`），**不是**
     docker 的 `host-gateway`（那会解析成默认 bridge 的 172.17.0.1，隔离容器没有那条路由 → ENETUNREACH）；
   · 实测：容器内 `GET /me`、`/me/assignments`、`/me/courses` 全部 200。
7. **兜底环境的模型额度由平台统一提供**（2026-09-29 加）：后端起容器时透传
   `DEEPSEEK_API_KEY` / `MOONSHOT_API_KEY`（`docker run -e <NAME>`，**只写变量名不写值**，
   所以密钥不进宿主 `ps`；容器内学生可见，属预期）。学生本地 DSH 仍用自己的 key。
   实测：容器内 `GET https://api.deepseek.com/models` → 200（同时验证了容器经 SNI 白名单代理能出网）。
   ⚠️ 建议给这个 key 设额度 —— 兜底环境人数少，但可控性要留着。

### 8.6 部署注意

- **本机 docker.io 直连不通**，且华为云源只有 `node:22-slim` = **v22.18.0**（`HANDOFF` §2.1 记录过它会崩），
  所以工作台镜像 **`FROM nju-lab-verify`**（本机唯一带正确 node v22.23.2 的镜像）。
  若在有 docker.io 的机器上从零构建，见 `server/workspace-image/Dockerfile` 注释里的替代路径。
- 构建 context **必须是仓库根**（要 copy `dsh/nju-lab-client`）；已加仓库根 `.dockerignore` 防止把 node_modules 发给 daemon。
- **工作台镜像与复验镜像不要合并**：bundle / profile / 驱动三者全不同（见 `server/workspace-image/README.md` 对照表）。
- **路径 B（2026-09-28）之后的镜像状态**：`nju-lab-workspace:0.1.5-rc.2` = **完整功能版**
  （CPU 修复后重建，含文件上传/附件/交付物面板/会话控制器）；
  回滚点 `nju-lab-workspace:0.1.5-rc.2-no-sse42` = 旧的"路径 A"版（禁 5 个插件）——
  只在**目标机器无 SSE4.2/POPCNT** 时才用它，并配合恢复 `profile/.../cordis.patch.yml` 的禁用段。
- **已完成的环境就位（2026-09-28）**：后端 `.env` 已加 `WORKSPACE_PUBLIC_BASE=http://medai.nju.edu.cn`；
  前端产物已同步到 `/var/www/lab`（含「实验环境」入口页）。~~**只剩宿主机 nginx 未合并**~~ ✅ **2026-09-29 已合并并核对**（§8.5 第 1 条）。
- 工作台配置项见 `server/.env.example` 末段（大部分有默认值，可先不配）。
- 工作台的**持久卷根目录**由 `WORKSPACE_DATA_DIR` 配置（默认 `/data/workspaces`；留空 = 关闭持久化）。
  2026-09-29 已建好 `/data/workspaces`（属 `ubuntu`）并用 docker 验证：ubuntu 可建 `<userId>` 子目录、
  学生容器挂 `/work` 读写正常、宿主可见同一文件 ✔ → 持久化已生效（不可写时后端只告警、不阻塞）。
- ⚠️ **反代上线必须配 `WORKSPACE_PUBLIC_BASE=https://{key}.<工作台域>`（`{key}` 必填）**：
  后端据此算出**每会话**的对外 authority 并注入容器的 `--trusted-host`；
  不配则 nginx 传外部 Host 时 WebSocket 会 403（§8.3 第 5 条）。
  本机/无域名时可用固定域（如 `http://ws-test.local:18080`，不含 `{key}`）——但此时**所有会话共享
  同一个 authority、cookie 会互串**，只适合单会话调试。

### 8.7 ✅ 原生 WebSocket 端到端打通（2026-09-29）—— §8.5 第 1.5 条结案

**结论**：浏览器 → 校园网关 → 上游反代 → 本机 nginx → 工作台容器，**原生 WebSocket 全链路
已打通**，不再需要「WS→HTTPS 桥」。每一环都有实测证据：

| 环节 | 状态 | 证据 |
|---|---|---|
| 上游反代（`219.219.122.131`，反解 `paper.nju.edu.cn`）透传 `Upgrade` / `Connection` | ✅ | 抓包，见 `deploy/check-ws-passthrough.sh` |
| 上游透传 `Host` = `medai.nju.edu.cn` | ✅ | 同上（修复前传的是内网 IP `10.28.128.56`） |
| 本机 nginx 转发 `Upgrade` + 纠正 `Host` | ✅ | `deploy/nginx/medai-workspace-{http,server}.conf` |
| **端到端 `101`** | ✅ | `access.log`：`11:39:03 "GET /api/remote.mux HTTP/1.1" 101 52255` |

**切换动作**：`server/.env` 加 `WORKSPACE_WS_BRIDGE=0` + `systemctl restart nju-lab`
（2026-09-29 已做）→ 客户端请求 `/wsbridge/client.js` / `ping` 得 **403** → 适配脚本不再加载
→ dsh 直接走原生 WebSocket。重启会让 wsKey 重生成，使用方需**重新进入**（容器由
`adoptOrReclaim()` 接管，不会丢）。

**⚠️ 一个曾经搞错的点**：**只要桥还开着，`101` 就永远不会出现** —— 桥的适配脚本会 hook 掉
`new WebSocket()`，把 dsh 的 WS 全部接管走 `/wsbridge/poll`。所以「先看到 101 再关桥」这个
顺序**不成立**，**关桥本身就是验证**：关掉后第一次进入就会看到 101；没通就回滚。

**回滚**（万一本机/网关侧再出问题）：删掉 `.env` 里的 `WORKSPACE_WS_BRIDGE=0` 并重启后端即可
回到桥模式 —— 桥的代码（`server/workspace-image/bridge.mjs`、`ws-bridge-client.js`）与 nginx 的
`location ^~ /wsbridge/` 都保留着。

**本机 Host 兜底仍在**（`deploy/nginx/medai-workspace-http.conf:21` 的 `map $http_host
$ws_out_host`）：上游已把 Host 改对，所以它现在退化为恒等映射 —— **保留作防回退的保险**。

**读超时那条不需要额外配置（实测证伪，2026-09-29）**：`proxy_read_timeout` 默认 60s，
理论上空闲会被掐；但**应用侧有服务端主动的事件流/心跳**，WS 连接不会静默到触发它 ——
实测从上游 `122.131` 到本机的**两条 WS 连接连续存活 4 分半无间断**
（`ss -tn state established` 可查；nginx 的 `keepalive_timeout` 默认只有 65 秒，普通 HTTP
连接早就断了）。所以上游即使没配 `proxy_read_timeout`/`proxy_send_timeout` 也不影响使用；
配了也只是防御性。**别再把它当成"待办/风险项"。**

**附带修正的一处旧认识**：2026-09-29 07:29–09:43 那批「连不上」**不是网关的锅**，而是
**后端 07:08 重启后 wsKey 重生成、浏览器里旧 cookie 全部失效**（`/wsbridge/ping` 403/21、
`/api/remote.mux` 200/85 都是这个原因）。诊断时先看这两条状态码，别一上来就怀疑网关。

## 9. 章节在线幻灯片（reveal.js）—— ✅ 已上线，LLM 生成已达「商业可用」验收线（2026-09-29）

### 9.1 一句话现状

教师可在章节编辑页进入「幻灯片」，**手动触发**用大模型按章节生成一份在线演示（reveal.js）；可改内容
（**JSON / Markdown 双视图**）、**换模板并可视化调参**、全屏放映、跨章节切换；学生端章节页可「文档 ⇄ 幻灯片」
切换。**生成已切真实 LLM（`deepseek-flash`）并做完效果优化**：prompt v3（密度硬约束/讲稿式 notes/版式选型）+
4 种新版式（agenda/steps/stat/compare）+ 自适应防溢出 + 逐页截图盲评验收通过
（`docs/REVIEW-slides-rubric.md`，对标商业产品 7 维评分）。
**2026-09-30 图片能力升级（§9.5a）**：版式增至 16 种（5 种图片版式），教师图片库 + 选择器插页/换图，
章节正文可上传插图，正文有图时 LLM 生成自动配图（prompt v4，服务端有防幻觉闸）。
**生成前必读 §9.4a**：deepseek-flash/v4-pro 是推理模型，预算含推理开销（已加 `reasoning_effort=low` 修复）。

### 9.2 已交付

| 层 | 内容 |
|---|---|
| 后端 | `server/src/slides/`（13 个文件）：两阶段生成（先大纲、再分批扩写；**单批失败局部降级**为大纲骨架）、`SLIDES_GENERATOR=mock\|llm` 双轨、JSON ⇄ Markdown 投影与**合并保存**（页级高级设置不丢）、模板编译（调参 → CSS）、10 个 API |
| 数据 | 迁移 `server/src/migrations/1790636383317-SlideDecks.ts`：`slide_decks`（**一章一 deck**；`basedOnChapterHash` 管"章节已变更"提示、`sourceHash` 管缓存命中）、`slide_templates`（只存调参 `design` + `baseTheme`，不存 CSS）——**已在生产库执行** |
| 前端 | `web/src/slides/`（渲染层：SlideJson → **自包含 srcdoc 文档** + `SlideStage` iframe + `files.ts` 图片内联）、教师端 `/teacher/chapters/:chapterId/slides`、学生端章节页切换、章节编辑页「幻灯片」入口 |
| 部署 | 前端已同步 `/var/www/lab`（走 `deploy/deploy-web-lab.sh`）；后端已 `npm run build` + 重启（新 dist 生效） |
| 设计 | `docs/DESIGN-2026-09-29-chapter-slides.md`：已确认决策、数据模型、API 契约、安全矩阵、实测记录 |

### 9.3 切到真实 LLM —— ✅ 已完成（2026-09-29 下午）

`server/.env` 已加 `SLIDES_GENERATOR=llm` + `SLIDES_MODEL=deepseek-flash`，线上即真实生成。
**模型选型有盲评结论（§9.4b）**：flash 在结构完整性/覆盖/延迟（~1/3）/成本上全面优于 v4-pro，
pro 仅个别措辞略细；分级配置口已留（`SLIDES_OUTLINE_MODEL` / `SLIDES_EXPAND_MODEL`）。

- 改 `.env` 后**必须重启后端**：`sudo systemctl restart nju-lab`；本会话没有 sudo（`no new privileges`），
  可用 `kill <MainPID>` 让 systemd 按 `Restart=always` 自动拉起（6 秒内恢复）。
- ⚠️ 切到 llm 后，旧的 mock deck 会因 `sourceHash`（含模型名）变化而提示「章节内容已变更 → 重新生成」，
  **这是预期**，不是 bug。
- ⚠️ 改 prompt 后**必须把 `slides.config.ts` 的 `SLIDES_PROMPT_VERSION` +1**，否则同 hash 命中旧缓存、
  看不到新效果。（v1 → v2 密度约束 → v3 新版式选型 → v4 图片版式，见 §9.6）

### 9.3a ⚠️ 推理模型预算坑（2026-09-29 实测，切片时第一个雷）

**deepseek-flash / deepseek-v4-pro 是推理模型**：`max_tokens` 预算是「推理 + 正文」**共用**的。
实测 max_tokens=200 时 `reasoning_content` 把额度烧完、`content` 为空字符串 → 生成报"模型输出不是合法 JSON"。
处置（都在代码里）：
- `llm.client.ts` 请求带 `reasoning_effort`（默认 `low`，`SLIDES_LLM_REASONING_EFFORT` 可配）；
  结构化 JSON 任务不需要长推理，low 的推理开销约 200–800 token。
- 大纲 max_tokens 从 v1 的 `min(…,2000)` 提到给满 `SLIDES_MAX_TOKENS`（2000 对 20 页大纲太紧，实测截断）。
- `parseJsonLoose` 新增**截断抢救**（回退到最后完整对象、补齐未闭合括号）；
  大纲失败重试一次、扩写批失败/截断也重试一次（约 1/20 的批会碰到）；缺页用大纲骨架补齐。
- 扩写产物**逐页校验**：单页不合法只丢该页（如 v4-pro 曾输出空栏 compare），不拖垮整批。

### 9.4 生成效果优化 —— ✅ 已完成（2026-09-29 下午，设计文档 §16 有完整实录）

**评测闭环（以后改 prompt/版式都靠它）**：`web/tools/review-decks.mjs <标签>` 真实生成 →
放映态逐页截图 + deck.json → 对照 `docs/REVIEW-slides-rubric.md` 7 维打分；
渲染层改动跑 `web/tools/assert-render.mjs`（jsdom，27 项，毫秒级）。
评测集 = 生产库 5 个真实章节（脚本里 `EVAL_CHAPTERS`）。

已落地：
- **prompt v2/v3**：密度硬约束（每条 ≤20 字、每页 3–5 条、电报体）、keyPoint 锚点、覆盖与去重规则、
  讲稿式 notes（3–6 句、信息量比页面大）；v3 新增版式选型要求。
- **程序化质检 `postProcessSlides`**：标题 ≤30 字/要点 ≤60 字截断（`SLIDES_TITLE_MAX_CHARS` /
  `SLIDES_BULLET_MAX_CHARS`，只闸 LLM 产出）、页内重复要点去重、标题高相似页合并（bigram Jaccard ≥0.7）。
- **版式系统**：新 layout `agenda/steps/stat/compare` + `kicker` 眉题（json 列，**无需迁移**）；
  MD 投影双向约定（设计文档 §7）；渲染层编号目录/步骤连接线/超大数字/对比卡片；
  **内容量自适应缩档**（`deck-fit-2/3`，防底部裁切的硬保证）；模板新增 `fontScale`/`cardStyle`
  （调参抽屉有控件）；mock 生成器同步产出全部新版式（零成本回归路径）。
- **放映态修正**：跨章节按钮改图标 + Tooltip；**`SlideStage` Spin 常驻 bug**（父组件行内 template 对象 →
  等价输入反复触发重建态，iframe 不重载、ready 永不再发 → loading 点常驻；修法 `lastDocRef` 等价跳过，
  回归断言在 verify-slides.mjs 第 8.5 项）。
- 长章节（>`SLIDES_SOURCE_MAX_CHARS` 12000）分块生成**未做**（当前真实章节最长 3.6k 字打不到），
  记入设计文档 §14 后续。

### 9.4b 模型盲评结论（2026-09-29，rubric 文档有三轮评分表）

flash-v3 vs pro-v3 五章对比：**flash 结构/覆盖更好**（pro 有一章只出 7 页且缺 end 页）、
**延迟 ~1/3**（39–90s vs 105–226s）、tokens 相当；pro 仅个别措辞略细。
**默认 `deepseek-flash`**；混合策略（大纲 pro+扩写 flash）用 `SLIDES_OUTLINE_MODEL`/`SLIDES_EXPAND_MODEL` 即可。

### 9.5 踩坑（都实测过，别再踩）

1. **marked@12 默认不安全**：会把 `<script>`、`<img onerror=…>`、`[x](javascript:…)` **原样输出** →
   内容渲染必须走「marked → DOMParser → 白名单清理」（`web/src/slides/markdown.ts`）。
2. **reveal 的 `exports` 不导出 `./dist/*`**：`reveal.js/dist/reveal.js?raw` 被 exports 拦掉；alias 指文件 + `?raw`
   也不生效（Rollup 当 external → **构建直接失败**）→ 改用 vite **virtual 模块插件**（`vite.config.ts` 的
   `revealRawPlugin`，读文件 + `JSON.stringify`，主题走白名单防穿越）。收益：主 bundle 只增 ~23KB，
   reveal 本体 119KB / CSS 54KB / 主题 5–46KB 全是**按需懒加载** chunk。
   ⚠️ 主题只用无内嵌字体的（`black` / `black-contrast` 各内嵌 564KB 字体，已在白名单外）。
3. **放映浮层会挡住 iframe 内 reveal 的翻页控件**：表现为"**键盘能翻页、鼠标点左右没反应**"——键盘走
   父窗口 `keydown` → `postMessage`，不经过鼠标命中测试，所以症状很具欺骗性。教训：**浮层容器一律
   `pointerEvents:'none'`**，只有按钮本身可点（`SlideStage.tsx`）。
4. **iframe 必须 `sandbox="allow-scripts"` 且不给 `allow-same-origin`**：reveal 的 reset.css 不会污染 antd，
   文档处于 opaque origin 读不到平台 localStorage/token；代价是文档内**带不了 Authorization 头** →
   平台图片（`file:<fileId>`）要在父窗口带鉴权取回内容、转 data URL 再内联（`files.ts`）。
5. 前端产物部署仍受 **§2.2 的顺序铁律**约束（先 chunk 后 index.html），用 `deploy/deploy-web-lab.sh` 即可
   （它已内置备份 / md5 / Content-Type 自检 / 失败回滚）。
6. **`Esc` 与 reveal 的 overview 冲突【2026-09-29 真实浏览器实测发现】**：用户点过幻灯片后**焦点在 iframe 内**，
   父窗口收不到 `keydown` → 按 Esc **退不出放映**，反而是 iframe 内 reveal 进了总览（截图里那 9 页缩略排布就是证据）。
   修法：桥接脚本在**捕获阶段**接管 `Esc`（`preventDefault` + `stopPropagation`）并 `postMessage` 回父窗口，
   由父窗口决定是否退出放映（已修复并纳入验证脚本断言）。

### 9.5a 图片能力（2026-09-30，设计与决策见 `docs/DESIGN-2026-09-30-slides-images.md`）

- **新版式 4 种**（版式总数 12→16）：`image-full`（全幅）、`image-left`/`image-right`（图文并排，图不可空、
  要点可空）、`image-grid`（多图网格，`images[]` 1–4 张；2 张两列/3 张三列/4 张 2×2，超 4 张截断）。
  schema/MD 投影/渲染/权重缩档全链路支持；MD 网格语法 = 多行 `![cap](file:…)`，无指令时 ≥2 图片行猜 grid。
- **教师个人图片库**：新增 `GET /api/files?kind=image&limit&offset`（只列**本人**上传、mimeType 过滤
  `image/%`）；`StoredFileInfo` 补 `mimeType`/`createdAt`（纯增量，无迁移）。选择器 =
  `web/src/components/ImagePickerDrawer.tsx`（上传 + 缩略图网格，缩略图走 §9.5-4 同款鉴权 data URL 管线）。
- **教师端入口**：幻灯片编辑区工具条「插入图片页」（5 种版式）/「换图」（单图系页型；grid 页内换图 v1
  用文本编辑）/「插图到光标」（MD 视图，图片引用插到文本光标处，可多选）。落地函数在
  `web/src/slides/imageActions.ts`：JSON 模式结构化 splice，MD 模式按
  server `splitPages` 同规则文本 splice；都只改编辑区文本，「保存内容」才生效。
- **章节正文插图**：`ChapterEdit`「插入图片」打开图片库（浏览/多选/上传，选中图插到光标处）；
  `MarkdownView` 支持渲染 `file:` 图片（marked 输出后扫 `src="file:…"` → 鉴权取回 → data URL 替换，
  教师预览与学生阅读共用）。**这是 LLM 配图的素材来源**。
- **LLM 条件配图（prompt v4）**：`extractChapterImages()` 从正文提取 `file:` 插图清单 → 注入大纲/扩写
  prompt；清单非空时允许 image 系版式（一份 deck ≤3 页），为空维持禁令。**防幻觉闸**在扩写逐页校验：
  url ∉ 清单 → 丢该页走大纲骨架兜底（骨架把图片系版式降级为 bullets）。教师手工插图不过生成器，不受此限。
- 回归：server/web `npm run build`、`node web/tools/assert-render.mjs`（27 项，含图片版式 DOM 与占位回退）、
  MD 往返与 imageActions 均用临时脚本实测过（不留仓内）。

### 9.6 怎么验证（不烧额度的那部分）

- **后端**：`SLIDES_GENERATOR=mock PORT=3199 npx ts-node -T src/main.ts` 起临时实例，跑
  「建测试章节 → 生成 → 轮询 → JSON/Markdown 双视图保存 → 模板另存/调参/删除解绑 → 章节变更提示与 sync-hash
  → 权限（匿名 401 / 学生 403 / 学生只读）→ 清理」。2026-09-29 用这套在**线上链路**（经 nginx）跑通 **32 项断言**，
  测试数据全部清理（`slide_decks` / `slide_templates` 清零）。
- **前端渲染层**：esbuild 把 `renderDeck.ts` 打包进 jsdom 跑断言（注入内容被清理、**文档内 `<script>` 仅剩内联 2 个**、
  代码块转义、section 数、桥接脚本、data URL 图片、notes / 两栏 / 页脚 / 模板 CSS）。
- **浏览器实测：✅ 已跑通【2026-09-29】**（此前写的「环境跑不了 Chromium」是**错误结论**，条件全部就位）：
  · 主机 CPU Xeon 6530（`sse4_2`/`popcnt`/`avx2` 齐备）、内存 31Gi；`MemoryMax=800M` 只是**后端服务**限额；
  · 系统依赖已装（apt：`libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcairo2 libcups2 libgbm1
    libpango-1.0-0 libxdamage1 libxkbcommon0` + `fonts-noto-cjk fonts-wqy-zenhei` 等中文字体）；
  · Playwright 在 `~/pw-verify/`（仓库外）；Chromium **153.0.8010.12** 装在 `~/.cache/ms-playwright` ——
    ⚠️ 要显式 `PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright`：默认会落到 `/tmp/ms-playwright`，
    那里**会被清**（已踩过，还会留下 `__dirlock` 让下次安装直接失败）。
  验证脚本 `~/pw-verify/verify-slides.mjs`（截图落 `~/pw-verify/shots/`）**10 项断言全绿**：
  API 登录注入会话 → 进章节幻灯片 → 生成（mock）→ 放映 → **鼠标点右/左区域翻页** → **右下角 reveal 控件箭头**（原遮挡 bug）
  → 键盘 → **Esc 退出放映**（焦点在 iframe 内也要有效）。
  两个易踩的坑：① Playwright 的 `name` 是**子串**匹配，`name: '登录'` 会点到「统一认证登录」把页面带去 CAS
  —— 脚本因此改为 API 登录 + 往 localStorage 写 `nju-lab-auth`；② `page.keyboard` 只作用于主 frame，
  要验「焦点在 iframe 内」的按键必须用 `frame.evaluate` 派发。

### 9.7 文件索引

- **功能指南（先读这个）**：`docs/SLIDES.md`；设计文档：`docs/DESIGN-2026-09-29-chapter-slides.md`（§16 效果优化实录）、
  `docs/DESIGN-2026-09-30-slides-images.md`（图片能力）；评分清单：`docs/REVIEW-slides-rubric.md`
- 后端：`server/src/slides/*`、迁移 `server/src/migrations/1790636383317-SlideDecks.ts`、
  `server/src/files/*`（`GET /api/files` 图片库列表）
- 前端：`web/src/slides/*`（`renderDeck.ts` / `markdown.ts` / `revealAssets.ts` / `files.ts` / `imageActions.ts` / `SlideStage.tsx`）、
  `web/src/components/ImagePickerDrawer.tsx`、`web/src/components/MarkdownView.tsx`（`file:` 图片渲染）、
  `web/src/pages/teacher/ChapterSlides.tsx`、`web/src/pages/teacher/ChapterEdit.tsx`（正文插图上传）、
  `web/src/pages/student/ChapterRead.tsx`、`web/vite.config.ts`
- 工具：`web/tools/review-decks.mjs`（盲评截图）、`web/tools/assert-render.mjs`（jsdom 断言）、`web/tools/verify-slides.mjs`（浏览器断言）
- 相关提交：`f1aa90b`（后端 + 迁移）、`f7aa0f0`（前端）、`412503b`（放映浮层/点击翻页修复）、
  `3859b40`（切 LLM + prompt v3 + 版式系统升级 + 盲评定版）

## 10. 调试与取证手段（2026-09-29 建立，别再用"读代码猜"）

> §9.6 里也有一段浏览器验证的说明，**以本节为准**（那边留作上下文）。

### 10.1 真实浏览器实测（首选）：Playwright + Chromium

**用法**（脚本在仓库内，可复用、可传承）：

```bash
cd ~/nju-lab
PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
  node web/tools/verify-slides.mjs [chapterId]
```

**它验证什么**（章节幻灯片，**10 项断言**）：API 登录注入会话 → 进章节幻灯片 → 生成（mock）→ 放映 →
鼠标点右/左区域翻页 → **右下角 reveal 控件箭头**（原遮挡 bug）→ 键盘 → **Esc 退出放映**（焦点在 iframe 内）
→ 截图到 `web/tools/shots/`（已 gitignore）→ **自动删掉本次生成的 deck**。

**环境（已就绪，换机器照抄）**
- 主机 CPU `Xeon 6530`（`sse4_2`/`popcnt`/`avx2`）、内存 31Gi。后端 `MemoryMax=800M` 是**服务**限额，与跑浏览器无关。
- 系统依赖（Ubuntu 22.04，缺了 Chromium 起不来）：
  `sudo apt-get install -y libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcairo2 libcups2 libgbm1 libpango-1.0-0 libxdamage1 libxkbcommon0 fonts-liberation fonts-unifont fonts-noto-cjk fonts-wqy-zenhei`
  （最后两个是**中文**字体；缺了截图全是豆腐块）
- Playwright 是 `web/` 的 devDependency（**不进前端产物**）；Chromium 二进制在 `~/.cache/ms-playwright`。
- ⚠️ **必须显式 `PLAYWRIGHT_BROWSERS_PATH`**：默认会落到 `/tmp/ms-playwright` —— 那里**会被清**，而且残留的
  `__dirlock` 会让下一次 `npx playwright install` 直接失败（都踩过）。

**四个已踩过的坑（省时间）**
1. `name` 是**子串**匹配：`getByRole('button', { name: '登录' })` 会点到「统一认证登录」→ 页面直接被带去 CAS。
   解：脚本改为**后端 API 登录** + 按 zustand persist 格式写 `localStorage['nju-lab-auth']`。
2. `page.keyboard` 只作用于**主 frame**：要验「焦点在 iframe 内」的按键，得用
   `frame.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))`。
3. 演示 iframe 是 **opaque origin**（sandbox 不给 allow-same-origin）→ 读不到它的 DOM；改为在父页面
   `addInitScript` 里监听 `message`、收集 `__deck` 事件（`ready`/`slidechanged` 带 `index`）来读页码。
4. 截图**别写仓库外**：受限会话对仓库外是只读（`EROFS`）。放 `web/tools/shots/`（已 gitignore）。

### 10.2 用截图找"瑕疵"（这次就是靠它发现的）

- 放映态整页截图 + overview 截图（`O` 键或 `Esc` 触发总览，**一屏看全部页**）→ 版式问题一眼可见。
- 2026-09-29 靠截图抓到的：① 要点过长过密（一页 5–6 条整句）② **内容溢出被裁**（第 3 页底部被切）
  ③ 重复页（同标题连出两页）④ 放映态左下角用长标题的跨章节按钮压在幻灯片上。
- 分工原则：**布局/观感 → 截图最快；交互（点击/键盘/焦点）→ 必须断言**，两者不能互相替代。

### 10.3 不烧额度的后端端到端

```bash
cd server && SLIDES_GENERATOR=mock PORT=3199 npx ts-node -T src/main.ts
```
起临时实例（**别用 3100**，那是 systemd 的线上实例）→ 跑「建测试章节 → 生成 → 轮询 → 双视图保存 →
模板 CRUD 与解绑 → 章节变更提示与 sync-hash → 权限（匿名 401 / 学生 403 / 学生只读）→ 清理」。
2026-09-29 用这套在**线上链路**（经 nginx）跑通 **32 项断言**。

### 10.4 前端渲染层断言（jsdom + esbuild，毫秒级）

把 `renderDeck.ts` 打包进 jsdom 断言纯函数行为：内容里注入的 `<script>`/`onerror`/`javascript:` 被清理、
**文档内 `<script>` 只剩内联的 2 个**、代码块转义、section 数、桥接脚本、data URL 图片、点击翻页阈值。
**改渲染层后必跑**（不依赖浏览器、不依赖后端）。
