# 实验扩展路线图：下一批实验（教师向 · 落地计划）

> **这份文件是给"下一个 session 的接手人"看的**：本课程还有 9 个章节没有实验，本文件把它们排成
> 批次、给出每章的设计草案、平台约束与落地步骤，**照着做就能直接开工**。
>
> 配套必读（本文件不重复它们的内容）：
> [`EXPERIMENT-CREATION-GUIDE.md`](EXPERIMENT-CREATION-GUIDE.md)（怎么做：11 步照做 + 坑表）、
> [`EXPERIMENT-DESIGN-FRAMEWORK.md`](EXPERIMENT-DESIGN-FRAMEWORK.md)（怎么设计：判据分层、教学向七件事、
> 「引导监督模式」）、[`EXPERIMENT-PACKAGE-SPEC.md`](EXPERIMENT-PACKAGE-SPEC.md)（包格式与依赖声明）、
> [`UPGRADE-playbook.md`](UPGRADE-playbook.md)（镜像重建 / 部署坑）、根目录 `AGENTS.md`（仓库纪律）。
>
> **最新的可抄样板**：`server/fixtures/sql-crud/`（口径钉死 + 逐字段比对 + 三处 TODO 骨架）与
> `server/fixtures/vector-search/`、`server/fixtures/kg-alerts/` —— 这三个是 2026-10 刚落地的
> "数据库 / 知识库类"实验，形态、判据写法、README 结构（含五段项目字段文案）都可整段复用。

---

## 0. 一句话

课程《分子医学人工智能理论与实验》（`course-cd11ea33`）现有 **14 章 / 9 个实验**，还有 **9 章没有实验**；
其中 **6 章值得做**、2 章建议只做讨论作业、1 章（概论）不需要。建议按
**批次 1（18 → 5 → 9）→ 批次 2（4 → 16 → 19）→ 批次 3（17，可选）** 推进。

---

## 1. 现状盘点（章节 × 实验覆盖矩阵）

| 章 | 章节 | 正文长度 | 现有实验 | 本路线图的安排 |
|---|---|---|---|---|
| 1 | 人工智能发展概论 | 1059 | — | **不做实验**（纯概念/历史） |
| 2 | 机器学习基本理论和实践 | 2174 | 3 个（回归 / 二分类 / 多分类） | 已覆盖 |
| 3 | 深度学习基本原理和实践 | 3693 | 3 个（MLP / CNN / 序列） | 已覆盖 |
| 4 | 大语言模型原理和实践 | 5629 | — | **批次 2**：注意力 / 温度 / token 的数值实验 |
| 5 | 知识库概念和文本内容 | 2621 | — | **批次 1**：倒排索引 + BM25 关键词检索 |
| 6 | 关系数据库 | 2198 | 1 个（2026-10 落地） | 已覆盖 |
| 7 | 向量数据库 | 2396 | 1 个（2026-10 落地） | 已覆盖 |
| 8 | 知识图谱 | 2755 | 1 个（2026-10 落地） | 已覆盖 |
| 9 | 综合实践：分子医学知识问答系统 | 2691 | — | **批次 1**：四形态最小问答原型（收官） |
| 15 | 智能体：定义、框架与常用选择 | 2525 | — | **只做讨论作业**（选型主观，不进自动判分） |
| 16 | 记忆系统 Memory | 2021 | — | **批次 2**：三层记忆的取舍实验 |
| 17 | 工具扩展：MCP 服务 | 2171 | — | **批次 3（可选）**：解析型简化版 |
| 18 | 技能 Skill 的创建与使用 | 2314 | — | **批次 1（首选）**：检验报告解读 Skill |
| 19 | 智能体综合实践：分子医学学习助手 | 2152 | — | **批次 2**：迁移检验型综合任务 |

> 章节 order 是 **1–9 + 15–19**（10–14 是空号）。新增章节从 **order 20** 起排；
> 要塞进中间用 `POST /api/courses/:id/chapters/reorder`。

---

## 2. 平台约束（**设计前必读**：这批实验全部踩过或差点踩到）

| 约束 | 事实（2026-10 实测） | 对设计的影响 |
|---|---|---|
| **没有外网** | 工作台与复验容器都在 `--internal` 网络（`nju-verify-egress`），只放行模型 API 的 SNI 白名单；镜像只读、容器内 `pip install` 不可能成功 | 运行环境只能是**镜像预装 + 学生脚本自己搭**；`Neo4j / Milvus / Qdrant / Chroma / MCP SDK / Dify` 都**用不了** |
| **预装集** | `pkg6` 镜像：`pandas numpy scipy scikit-learn statsmodels matplotlib torch(CPU) openpyxl requests beautifulsoup4 lxml PyYAML tabulate pytest` + 命令 `jq unzip zstd`；另有 Python 标准库（`sqlite3` ✅、`networkx` ✅） | 优先选**已有依赖**；确需新库 = 改 `server/verify-image/Dockerfile` + 重建镜像（一学期一两次） |
| **产物契约** | 复验 = 逐 case 跑一轮 dsh（题干 + 学生 Skill）→ 与 `expected.*` 比对；`outputFile` 是**唯一**判分入口 | 交付物必须是"**能重建环境 + 产出一个结果文件**"的脚本化方案，不是"手工搭好的一次" |
| **判据分层** | 算术/事实 → `manifest.assertions`（JS 表达式，严格 `true`）；语义 → `judge.md`（LLM） | 数值达标线**绝不写进** `judge.md`（实测会被判通过）；结论里的数字**允许四舍五入**（实测误杀过一次） |
| **`VERIFY_MAX_CASES=1`** | `server/.env` 当前只跑 case01（成本开关）；教师本地自检跑的是全部 case | 想让平台跑全部 case → 改成 `0`（**未决事项，见 §6**） |
| **镜像 tag** | verify = `nju-lab-verify:0.2.0-rc.2-pkg6`；workspace = `nju-lab-workspace:0.2.0-rc.2-pkg7` | 自检/复验命令都用 pkg6（见 §5） |
| **引导语只分两条流程** | `dsh/nju-lab-client/src/host/guidance.ts` 现在按「ML/深度学习」与「数据库/知识库」分支 | **批次 2 的智能体类实验（16 / 18 / 19）不属于这两条** → 需要**第三条分支**，见 §4.4 |
| **章节正文可能"跑不通"** | 第 7 章原「动手实践」写 Milvus/Qdrant、第 9 章写 Neo4j、第 17 章写 MCP 服务器、第 18 章写 hooks 拦截 | 做实验时**要么在题干里换成本地等价物**，**要么同步修订正文**（见 §7 附录） |

---

## 3. 批次计划总览

| 批次 | 实验 | 一句话 | 依赖 | 风险 |
|---|---|---|---|---|
| **1** | 18 技能 Skill：检验报告解读 | 交付一个真 Skill：报告 → 结构化解读 + 危急值 | 零新增 | 低（正文已带三个测试用例） |
| | 5 知识库：关键词检索 | 倒排索引 + BM25 检索，与"字符 2-gram"对照 | 零新增 | 低 |
| | 9 综合实践：四形态问答原型 | SQL + 关键词 + 向量 + 图谱拼装，答案带出处 | 零新增 | 中（要改正文的 Neo4j 措辞） |
| **2** | 4 LLM 原理：注意力与温度 | numpy 手写缩放点积注意力 + 温度采样分布 | `numpy` | 中（易退化成抄公式） |
| | 16 记忆系统：三层记忆 | 窗口 / 摘要 / 检索三种策略的取舍 | 零新增 | 中 |
| | 19 智能体综合实践 | **不给骨架与参考实现**的迁移检验型综合任务 | 零新增 | 高（判分口径要教师定） |
| **3** | 17 MCP：解析型简化 | tool-call 记录 → 校验/路由/mock 执行 | 零新增 | 高（与正文的"真搭 server"差距大） |

---

## 4. 各实验设计草案

> 每个草案给：**任务形态 / 产物契约草案 / 判据草案 / 依赖 / 要同步的动作**。
> 具体数值（case 规模、达标线、断言条数）留给设计时标定 —— 照 `sql-crud` 的 README 记一张
> 「出题时的实测依据」表。

### 4.1 批次 1 · 第 18 章《技能 Skill 的创建与使用》（**首选**）

- **为什么首选**：正文已经给了完整任务 ——「检验报告解读 Skill + 三个测试用例：正常 / 轻度异常 / 危急值
  + hooks 拦截」，而且**平台本身就是交付 Skill 的地方**，机制天然契合。
- **任务形态**：给一份检验报告（`report.csv`：`item,value,unit,ref_low,ref_high,critical_low,critical_high`），
  学生交付的 Skill 把每项判成 `normal / high / low`，并挑出**危急值**，输出 `output.json`。
- **产物契约草案**：
  `{"items":[{"item","value","flag","critical"}], "critical_alerts":[{"item","value","reason"}], "summary":"…", "figures":[…], "notes":"…"}`
- **判据草案**：
  - 断言：逐项 `flag` 与 `expected` 一致（按 item 排序后 JSON 比较）、`critical_alerts` 集合一致、
    边界值（恰好等于 `ref_high`）口径正确、图与说明齐全、`notes` ≥ 40 字；
  - judge：解读是否**讲清依据**（引用了哪个参考范围）、是否**越界下诊断**（"这是糖尿病"→ 不通过）、
    对"什么情况下不该给结论"是否有交代。
- **依赖**：零新增（`pandas` + 标准库）。
- **要同步**：正文的 "hooks 拦截" 在平台上没有对应机制 → 实验里改为"把危急值写进
  `critical_alerts` 并在 `notes` 里说明拦截规则"。**修订章节正文对应一句**（见 §7）。

### 4.2 批次 1 · 第 5 章《知识库概念和文本内容》

- **为什么**：正文的核心论断是"倒排索引**搜得到字面、搜不到意思**"，而第 7 章的向量检索实验正好是它的
  对照组 —— 但那个实验里用的是**简化版字符 2-gram**；这一章可以把**真正的 BM25** 补上。
- **任务形态**：给文档集（`corpus.csv`）+ 查询（`queries.csv`，含"同词""改写""无关"三类）
  → 建倒排索引 → **BM25** 排序取 Top-K → 与"字符 2-gram"基线对照 → 报 `recall@3`。
- **产物契约草案**：
  `{"index":{"n_docs","vocab_size","postings_checksum"}, "retrieval":[{"query_id","top_k":[{"doc_id","score"}]}], "baseline":[{"query_id","top_ids":[…]}], "metrics":{"recall_at_3_bm25","recall_at_3_bigram"}, "figures":[…], "notes":"…"}`
- **判据草案**：
  - 断言：`vocab_size` / 词表校验和一致（口径钉死：小写 + 按**非字母数字**切分、是否去停用词写死在
    `task.md`）、Top-K 名单一致、`recall_bm25 > recall_bigram`、图与 `notes`；
  - judge：是否讲清 BM25 的**词频饱和**与**长度归一化**各解决什么、以及"为什么同义改写仍然搜不到"。
- **依赖**：零新增（纯标准库）。
- **要同步**：无（正文的"基础实践"已可用，可把实验号回填进正文）。

### 4.3 批次 1 · 第 9 章《综合实践：分子医学知识问答系统》（**收官**）

- **任务形态**：给一份**小规模语料**（虚构基因/药物 + 3~5 段"文献摘要" + 患者数据）与 5 个问题
  → 学生要把四种形态各用上一次：SQL 精确统计、关键词检索、向量相似检索、图谱多跳，
  **每个答案都要带出处**（`sources`：`{kind: sql|keyword|vector|graph, ref, path?}`）。
- **产物契约草案**：
  `{"answers":[{"question_id","answer","route","sources":[…],"confidence"}], "route_counts":{…}, "figures":[…], "notes":"…"}`
- **判据草案**：
  - 断言：每个问题的 `answer` 关键字段与 `expected` 一致、`sources.kind` 与该题**应当走的路**一致、
    多跳题的 `sources.path` 是完整三元组链、图与 `notes`；
  - judge：路由选择是否合理（为什么这题该走图而不是 SQL）、出处是否真能追溯到数据、
    有没有把"检索结果"当"结论"（这是正文的"常见坑"）。
- **依赖**：零新增（`sqlite3` + 词表向量 + `networkx`）—— 正好复用批次前三个实验的零件。
- **要同步**：**正文「动手实践」写的是 SQLite + Neo4j + 向量库**，其中 Neo4j 无外网跑不了 →
  修订为"用 `networkx` 建本地图"。**这一章必须改正文**（见 §7）。

### 4.4 批次 2 · 第 4 章《大语言模型原理和实践》

- **任务形态**：三个可复现的数值小实验串成一个应用：① 语料 → token 化与词频统计；
  ② `numpy` 手写**缩放点积注意力**（含因果掩码）并自检；③ 给定 logits，**不同温度**下采样 N 次，
  报告分布变化。
- **产物契约草案**：
  `{"tokens":{"n_tokens","top_terms":[…]}, "attention":{"shape","row_sums","masked_upper_is_zero","output_checksum"}, "sampling":[{"temperature","top1_ratio","entropy"}], "figures":[…], "notes":"…"}`
- **判据草案**：
  - 断言：`softmax` 行和 ≈1（容差 1e-6）、掩码后上三角为 0、`t=0.5/1/2` 三档的 `top1_ratio`
    落在 `expected` 区间、固定 seed 可复现、图与 `notes`；
  - judge：是否讲清"温度改的是**分布的陡峭程度**、不改相对顺序"、Q/K/V 拆分的理由。
- **依赖**：`numpy`（已预装）。
- **风险**：容易变成"照公式抄一遍" → 题干必须绑到**现象解释**（图 + `takeaway`）。

### 4.5 批次 2 · 第 16 章《记忆系统 Memory》

- **任务形态**：给一段**多次随访对话**（含过敏史、用药变更、无关闲聊）+ 一组后续提问
  → 实现三种记忆策略（**窗口 / 摘要 / 长期检索**），每个提问输出"用到哪些记忆条目"。
- **产物契约草案**：
  `{"memory":{"window":[…],"summary":"…","retrieved":[{"query_id","entries":[…]}]}, "answers":[{"query_id","answer","used_memory":[…] }], "metrics":{"recall_at_k"}, "figures":[…], "notes":"…"}`
- **判据草案**：断言（每个提问命中的记忆条目集合、"遗忘之后"的行为、指标、图）；
  judge（三种策略各解决了什么、遗忘的代价、"记住一切"为什么不现实）。
- **依赖**：零新增。

### 4.6 批次 2 · 第 19 章《智能体综合实践：分子医学学习助手》

- **形态特殊性**：这是**迁移检验**位置 —— 按 FRAMEWORK §3.5 的建议，**不给骨架、不给参考实现**，
  只给需求 + 数据 + 交付契约，考察学生能否把前面学到的东西自己组装起来。
- **任务形态**：做一个最小闭环的"学习助手"：记忆 + 工具（本地 mock）+ 技能 + 检索各用上一次，
  对固定的一组输入产出一份结构化报告。
- **要同步**：骨架/参考实现缺失意味着**学生更容易卡住** → 「引导监督模式」在这一章的陪法要更靠前
  （见 §6 的"第三条引导分支"）。判分口径（是否部分人工 rubric）**需要教师先定**。

### 4.7 批次 3（可选）· 第 17 章《工具扩展：MCP 服务》

- **现实**：正文让学生**真搭一个 MCP 服务器**，但镜像里没有 MCP SDK、也没有外网 → 做不到。
- **折中形态**：给一段 **tool-call 记录**（JSON）→ 解析并**按 schema 校验参数** → 路由到本地 mock 工具
  → 支持**组合调用**（如"华法林 + 阿司匹林"要连查两个工具）→ 输出结果与调用日志。
- **判断**：可以做，但与正文的落差要**明说**（题干里写"本实验用本地 mock 代替真实 MCP 服务"），
  否则会让学生以为学的是协议实现。**建议先做批次 1、2，再决定要不要做它。**

---

## 5. 每个实验的通用落地步骤（照 CREATION-GUIDE，附本仓库实测命令）

```sh
# 0) 抄样板（形态最接近的一档）
cp -r server/fixtures/sql-crud server/fixtures/<新实验名>     # 口径钉死 + 逐字段比对型
cp -r server/fixtures/vector-search server/fixtures/<新实验名>  # 检索 + 对照 + 指标型

# 1) 造数据（固定种子，可重跑）
python3 server/fixtures/<fx>/tools/gen_data.py

# 2) 用参考实现重算 expected（**必须与复验同镜像**）
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

# 5) 上传 + 建项目 + 发布（教师 token；chapterId 取目标章节）
#    见 CREATION-GUIDE 步骤 11；项目字段文案（objectives/background/description/references/faq）
#    写在实验自己的 README.md 里，照 sql-crud/README.md 的结构
```

**每个实验的"完成定义"**（四条都做到才算完）：

1. `--check` 退出码 0（断言条数、用例齐全、依赖可用）；
2. 参考实现复验 **2/2 通过**、`hardChecks.failed` 为空、rationale 无"矛盾"类问题；
3. 平台侧已上传 + 绑定 + `published`（**上线前先问操作人**，见 CREATION-GUIDE 步骤 4）；
4. 实验 README 里有「判据设计要点」+「出题时的实测依据（含日期与实测数值）」+「项目字段文案」。

---

## 6. 需要先决定的事（**开工前请教师/维护者拍板**）

| # | 事项 | 选项 | 影响 |
|---|---|---|---|
| 1 | **第 18 / 16 / 19 章的引导流程** | (a) 给 `guidance.ts` 加**第三条分支**（"智能体 / 工具类"：看需求 → 摸清数据 → 搭最小闭环 → 逐个模块验证 → 交付）；(b) 不分支，靠题目包材料引导 | 选 (a) 要改客户端 + 重建 workspace 镜像 + 重打 kit（本次做过一遍，流程见 playbook；在线学生会话需重进） |
| 2 | **`VERIFY_MAX_CASES`** | (a) 保持 `1`（只跑 case01，省 token）；(b) 改 `0`（跑全部 case，检验"方案普适"） | 改了就影响**所有**实验（含在跑的 9 个），需要重启服务 |
| 3 | **第 9 / 17 章正文是否修订** | (a) 修订（Neo4j→networkx、MCP→本地 mock）；(b) 不改，只在题干里说明 | 不改的话学生照正文做会卡在"装不上 Neo4j" |
| 4 | **第 19 章的判分口径** | (a) 全自动（断言 + judge）；(b) 自动 + 教师 rubric 权重更高 | 迁移检验型任务给不给参考实现，直接决定难度 |
| 5 | **17 章要不要平台加依赖** | (a) 做解析型简化；(b) 镜像加 `mcp` SDK 后再说 | 选 (b) = 重建两个镜像，且仍受"无外网"限制（MCP server 只能在容器内起） |
| 6 | **测试账号遗留数据** | (a) 留着（`student1` 的 3 条提交 + 章节进度，作链路证据）；(b) 清掉 | 没有平台级"撤销提交"接口，要清就得直接删 `submissions` / `evaluations` / `assignments` / `progress` 行 |

---

## 7. 附录：章节正文里需要修订的措辞（做对应实验时一并改）

| 章 | 现在写的 | 问题 | 建议改成 |
|---|---|---|---|
| 7 | 「动手实践」建议 Milvus Lite / Qdrant | 无外网装不上 | 已由本次实验的 `vector-search` 覆盖：词表向量 + numpy 余弦；正文可加一句"实验里用离线可复现的等价实现" |
| 8 | 「动手实践」建议 Neo4j 社区版 | 无外网装不上 | 同上（`kg-alerts` 用 `networkx`）；正文可指向实验 |
| 9 | 「动手实践」让用 SQLite + **Neo4j** + 向量库 | 同上，且这章是综合实践，卡住代价最大 | 改成"SQLite + 本地图（`networkx`）+ 词表向量" |
| 17 | 「动手实践」让**搭 MCP 服务器** | 无 SDK、无外网 | 要么改成本地 mock 版，要么在正文里明说"本环境的限制" |
| 18 | 「动手实践」里 `hooks` 拦截危急值 | 平台无 hooks 机制 | 改成"把危急值写进输出并在结论里说明规则" |

> 改这些正文属于**教师向内容维护**，不属于历史快照（`docs/ACCEPTANCE-*.md` 等不动，见 `AGENTS.md`）。

---

## 8. 开新 session 的第一小时（照着做）

1. 读 `AGENTS.md` + 本文件 + `docs/EXPERIMENT-CREATION-GUIDE.md`（§1 设计思路、§3 判据、§4 坑表）；
2. `cp -r server/fixtures/sql-crud /tmp/read-sample && 通读它的 problem/{task.md,judge.md,manifest.json}`
   —— 这是"口径钉死 + 逐字段比对"型的最新样板（`vector-search` 是"检索 + 对照 + 指标"型样板）；
3. 起一个目标实验的目录骨架（§5 步骤 0），先写 `tools/gen_data.py` 造数据，再写参考实现跑出期望值；
4. 每完成一个实验就走一遍 §5 的 1→4，最后**先问操作人**再上传发布；
5. 收尾：实验 `README.md` 补实测记录 → `server/fixtures/README.md` 的表格加一行 →
   `HANDOFF.md` 顶部加一条（用户要求 / 选定口径 / 实测数值 / 产物与部署 / 未做）→ `git commit && git push`。
