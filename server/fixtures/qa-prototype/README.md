# 综合实践实验：分子医学知识问答原型（第 9 章 · 四形态各用一次 + 出处可溯源）

**形态：应用驱动**（`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6）—— 学生拿到的是**需求**
（把四种知识形态组装起来回答真实提问），而不是"照着四种库的 API 写一遍"：
路由口径与各形态的实现口径是业务规则（必须照做），但**代码怎么组织、图怎么画由学生自己决定**；
判据看的是"走对了路 + 关键事实对 + 出处带出来 + 说得清"。

**教学向设计**（§3.5 七件事）：学习目标 / 知识铺垫 / 导学步骤 / 参考资料与 FAQ 见下方
「项目字段文案」；参考实现随包下发（`problem/reference/`）、骨架留解释层、反思环节落在骨架的
「能力边界」「实测档案」。

```
qa-prototype/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 12 条确定性断言
│   ├── task.md         需求 + 六步流程 + 路由口径 + 各形态实现口径 + 交付格式
│   ├── judge.md        语义判据（路由理由、出处自洽、有没有把检索结果当结论）
│   ├── README.md       导学
│   ├── cases/case0N/{genes,variants,drugs,trials,passages,edges,questions,expected}.csv/json
│   └── reference/      参考实现（SQL + 关键词 + 字符 2-gram 余弦 + 图多跳 BFS + 一张图）
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，三处 TODO 自己填）
├── tools/gen_data.py                        造题工具：显式写死的虚构语料（**不下发**）
└── README.md
```

## 场景与数据

- 应用：把"关系库 / 文本 / 相似检索 / 图谱"四种形态串成一个最小问答原型，回答 5 个固定问题
- 对应章节：课程《分子医学人工智能理论与实验》**第 9 章《综合实践：分子医学知识问答系统》**
- 数据（合成，无真实患者、也不是真实临床试验）：

| 文件 | 列 | 说明 |
|---|---|---|
| `genes.csv` / `variants.csv` / `drugs.csv` / `trials.csv` | 见 `task.md` 数据字典 | 结构化事实（关系库那一层） |
| `passages.csv` | `passage_id,source,section,text` | 指南/综述段落（中文） |
| `edges.csv` | `head,relation,tail` | 知识图谱的**有向**三元组 |
| `questions.csv` | `question_id,question` | 五个问题 |

| case | 规模 | 特点 |
|---|---|---|
| case01 | 4 条试验 / 5 段段落 | 小规模 |
| case02 | 5 条试验 / 7 段段落 | 加了一条**同药的 II 期试验**（不按条件筛就会取错行）+ 两段干扰段落 |

## 判据设计要点

1. **路由是要交的东西**：五个问题与四种形态一一对应（第 5 个是两跳组合），
   `assertions` 逐题比对 `route` 与 `sources` 的 `kind` 组合 —— "每个问题走对了路"变成硬性判据。
2. **关键事实逐题比对**：每题 `key_facts` 的键名在 `task.md` 里钉死，值由数据唯一确定
   （例如 Q01 必须取 **III 期**那条试验，`T-105` 是干扰）。
3. **可解释性要被检验**：Q04 的 `sources[].path` 必须是**完整的三元组链**
   （`head|relation|tail` 顺序），逐字符比对 —— "说不出推理链"就不能通过。
4. **出处必须带上**：每题 `sources` 的 `kind` 组合正确、`ref` 非空；Q05 必须同时有 `graph` 与 `sql`
   两条出处（少一条就说明"两跳"没真的做）。
5. **零新增依赖**："没有外网"这条约束决定了技术选型 —— 关系库用标准库 `sqlite3`、
   相似检索用**字符 2-gram 余弦**（中文不需要分词器）、图谱用邻接表 + BFS（不装 Neo4j）。
6. **语义交给 judge**：路由理由是否站得住（不能说"综合多种方法"这种空话）、
   出处与答案是否自洽、**有没有把"检索结果"当"结论"**（本章点名的坑）、局限是否正视。

### 出题时的实测依据（不是推测，2026-10-10 在本机复验镜像里跑）

| 题 | 应当走的路 | 关键事实（两个 case 一致） |
|---|---|---|
| Q01 | `sql` | `T-102` / III 期 / 客观缓解率 **62.4%**（同药另有 II 期 `T-105` 作干扰） |
| Q02 | `keyword` | `P-01`（唯一同时字面出现 PARP / BRCA / 卵巢癌的段落） |
| Q03 | `vector` | `P-03`（字符 2-gram 余弦最高：同源重组修复缺陷 → 合成致死） |
| Q04 | `graph` | 3 跳链 `BRCA1|loss_of_function|同源重组修复缺陷` → `同源重组修复缺陷|synthetic_lethal_with|PARP抑制剂` → `PARP抑制剂|includes|olaparib`；类别药物 `niraparib` / `olaparib` / `talazoparib` |
| Q05 | `graph` + `sql` | 适应证 `铂敏感复发卵巢癌` + `T-101` / 客观缓解率 **45.0%** |

路由分布：`sql` 1 / `keyword` 1 / `vector` 1 / `graph` 2（两个 case 相同）。

参考实现复验：**2/2 case 通过、硬性断言 12/12**，单轮 dsh 85s / 99s（`VERIFY_REASONING_EFFORT=low`）。
`--check` 退出码 0（依赖：`matplotlib`，镜像已预装）。

## 项目字段文案（上传到平台时用）

**objectives**

1. 能说清四种知识形态各自解决什么问题：关系库管精确与统计、文本管原文出处、
   相似检索管"换了说法"的近似匹配、图谱管关系链与可解释性 —— 以及为什么没有哪一种能单独回答全部问题。
2. 能判断"一个问题该走哪条路"：先看要的是精确数字、原文术语、意思相近的段落，还是一串关系。
3. 能说清"出处为什么是生命线"：把检索结果直接当结论是本章最要命的坑，
   每条结论都要能追溯到表、段落或路径。

**background**

- **四形态分工**（课程第 5~8 章）：文本 = 原始知识；关系库 = 结构化事实与事务；
  向量库 = 语义索引（"像不像"）；知识图谱 = 关系网络（多跳推理 + 可解释）。
- **混合检索**：真实系统里四种形态互为兜底，缺一路就有一类问题答不出或说不清。
- **可解释性**：图谱的价值不只是"答案对"，而是**每一步都能核查**（把路径写出来）。
- **RAG 的前半段**：本实验只做到"检索 + 组装 + 带着出处输出"；把这套结果拼进大模型提示词、
  生成带引用的自然语言回答，是后续 RAG 章节的事。
- **本实验环境的约束**：容器不联网、镜像只读 → 装不了 Neo4j / Milvus / Qdrant，也调不到
  Embedding 服务，所以相似检索用**字符 2-gram 余弦**这个等价实现（中文不需要分词器）。

**description**（导学步骤）

1. 读 `task.md`：先看清**路由口径**与各形态的实现口径，再看交付格式（每题 `key_facts` 的键名是钉死的）。
2. 读 `problem/reference/`：一份走完六步的示范 —— 先读懂它的输出，再写你自己的。
3. **摸清材料**：七份文件各自的主键、段落号、边的方向（`edges.csv` 是**有向**的）。
4. **搭四个入口**：关系库（内存 SQLite）/ 关键词（字面共现）/ 相似度（字符 2-gram 余弦）/
   图谱（邻接表 + BFS 多跳）—— 每条路先单独跑通。
5. **逐题路由**：选主路取答案；两跳题（Q05）把第二条路也记进 `sources`。
6. **画图 + 写结论**：画"每种形态回答了几题"，`notes` 里讲清路由理由与局限
   （含"检索结果 ≠ 结论"这条坑）。
7. **自测两个 case**：与 `cases/<case>/expected.json` 对照（路由、关键事实、出处、路径）。
8. **提交**：把踩过的坑写进 `SKILL.md` 的「实测档案」。

**references**

- 课程第 5~9 章（知识库的四种形态 + 本综合实践）
- 关系数据库：<https://www.sqlite.org/lang.html>
- 图论基础（BFS 最短路径）：<https://en.wikipedia.org/wiki/Breadth-first_search>
- 余弦相似度：<https://en.wikipedia.org/wiki/Cosine_similarity>
- 检索增强生成（RAG，本实验的下一步）：课程后续章节

**faq**

- **Q01 取到了 `T-105`？** 那是同药的 **II 期**试验：题意要 III 期，必须带上分期条件筛。
- **Q02 命中了好几段？** 要的是**同时**字面出现「PARP」「BRCA」「卵巢癌」三个概念的那一段。
- **Q03 找不到 `P-03`？** 这一题要按**相似度**找（字符 2-gram 余弦最高），不是按术语共现找。
- **Q04 的路径与参考不完全一样？** 路径要写成 `head|relation|tail` 的完整链；
  同长度多条时取**边序列 ASCII 升序最小**的那条。
- **Q05 只报了一半？** 这题是两跳：图谱取适应证 + SQL 取试验数据，`sources` 里两条都要有。
- **能不能装 Neo4j / Milvus？** 不能：容器不联网、镜像只读。用 `sqlite3` +
  `networkx`/邻接表 + 字符 2-gram 余弦走同一套流程。

## 打包 / 自检 / 上传

```sh
cd server/fixtures/qa-prototype
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构与依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧闭环：拿参考实现跑一遍复验（应 2/2 通过）
docker run --rm --env-file ../../../server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low \
  -v "$PWD:/p:ro" -v "$PWD/../../../.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/qa-prototype.json --timeout-ms 300000
```

上传两个 ZIP 拿 `fileId`，在项目里绑到「Skill 模板」「题目包」两个位置，再用 `chapterId` 挂到
课程《分子医学人工智能理论与实验》**第 9 章《综合实践：分子医学知识问答系统》**下并 publish
（命令见 `docs/EXPERIMENT-CREATION-GUIDE.md` 步骤 11）。
