# 记忆系统实验：记忆四操作 + 三种上下文策略的对照（第 16 章）

> 课程《分子医学人工智能理论与实验》**第 16 章《记忆系统 Memory》**（chapter id
> `8cf8c4fc-52c4-4059-b244-fbd810f60e7e`）。
> 正文的教学示例用 `mem0` 存记忆 —— 本环境**无外网、装不了**，所以实验改成
> "**本地条目表 + 自己实现的检索**"，并在正文对应位置补了一句说明（见
> `docs/PLAN-2026-10-experiment-roadmap.md` §7）。

**用户选定的口径（2026-10-10，路线图 §6 第 8 项）**：第 16 章实验**做满正文的"四操作"**
（写入 / 检索 / **更新** / **遗忘**），不只是"三种上下文策略"；
判据里加"**更新后旧条目不再命中**、**遗忘后谁都拿不回来**"这类**行为性条件**。

## 结构

```
memory-strategies/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 13 条确定性断言
│   ├── task.md         需求 + 六步流程 + 抽取/更新/遗忘/策略/检索五套口径 + 交付格式
│   ├── judge.md        语义判据（三策略取舍、更新与遗忘的后果、错误记忆风险）
│   ├── README.md       导学 + 排错表
│   ├── cases/case0N/{dialogue.csv,queries.csv,memory_config.json,expected.json}
│   └── reference/      参考实现（四操作 + 三策略 + before/after + 一张图）
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，六处 TODO 自己填）
├── tools/gen_data.py                        造题工具（**不下发**）
└── README.md
```

## 场景与数据

- 应用：给随访助手加一层记忆 —— **记得住、找得到、改得掉、忘得了**，并把代价**量出来**
- 形态：**口径钉死 + 多策略对照 + 行为性判据**（不训练模型；条目规则、阈值、检索口径全部写死）
- 数据（合成教学数据，**中文**，无真实患者）：

| 文件 | 列/键 | 说明 |
|---|---|---|
| `dialogue.csv` | `turn_id,date,role,kind,text` | 12~16 轮随访对话；`kind` ∈ `fact_statement` / `correction` / `question` / `chitchat` |
| `queries.csv` | `query_id,query,relevant_entry_ids` | 后续提问 + 人工标注"该用到哪些条目"（`;` 分隔） |
| `memory_config.json` | `patient_id`、`window_size`、`top_k`、`forget_importance_max`、`forget_before` | 患者号与各项阈值 |

| case | 规模 | 特点 |
|---|---|---|
| case01 | 12 轮 → **7 条**条目（4 active / 1 superseded / 2 forgotten）/ 5 个提问 | 单次更正、两条被遗忘 |
| case02 | 16 轮 → **10 条**条目（4 active / 1 superseded / 5 forgotten）/ 6 个提问 | 更正对象是"当前降脂药"，遗忘 5 条 |

> 用中文语料是刻意的：中文分不了词（镜像里没有分词器），检索口径因此用**字符 2-gram 余弦** ——
> 与第 5 / 9 章实验一致，也顺带把"这类检索只认字面重叠"的天花板量出来。

## 判据设计要点

1. **五套口径全部钉死 → 结果唯一确定**：条目抽取（哪些轮产生条目、编号规则、`fact` = 原文）、
   `category` 判定顺序与关键词、重要性取值、更新规则（`更正：<旧说法> → <新说法>`）、
   遗忘阈值（`importance <=` 且 `time <`）、三策略与检索口径（字符 2-gram 余弦、只留 > 0、并列按 id 升序）；
2. **`fact` 也进判据**：`entries_checksum`（`entry_id|category|time|importance|status|superseded_by|fact`）
   把原文一起钉住 —— 否则学生改了 `fact` 也能"对得上"；
3. **两处边界口径方向相反**（照批次 1 的思路）：
   ① 遗忘**只处理 `active`** ⇒ 被更正的 `superseded` 条目**不会**被顺带遗忘；
   ② 窗口"能提供的条目"要按**最终状态**过滤 ⇒ 窗口里那一轮虽然还在，但它的条目已被遗忘就不算；
4. **行为性判据（本实验的核心）**：不是"跑通"，而是
   **`after` 里不再出现被更正的旧条目**、**被遗忘的条目在窗口 / 摘要 / 检索三种策略里都取不到**、
   **`before_after` 至少有一题不同** —— 这三条比"print 出来看着对"强得多；
5. **指标梯度由语料结构保证**：窗口把久远的过敏史丢掉、摘要把同类的旧化验压掉、
   检索的提问刻意保留"与条目共享用词"的措辞 —— 所以三者的 `recall@k` 有**稳定顺序**
   （窗口 < 摘要 < 检索），这不是巧合，是造数据时刻意摆好的（下表是实测值）；
6. **判据分层**：13 条 `assertions` 全是"能写死的事实"；"三种策略各解决什么、遗忘的代价、
   错误记忆的风险"交给 `judge.md` —— 数值门槛一条都没写进 judge。

## 出题时的实测依据（不是推测，2026-10-10 在复验镜像 `pkg6` 里跑）

| 指标 | case01（P-001） | case02（P-207） |
|---|---|---|
| 对话轮数 / 条目数 | 12 / **7** | 16 / **10** |
| 最终状态 | 4 active、1 superseded、2 forgotten | 4 active、1 superseded、5 forgotten |
| `entries_checksum` | `5eab37f8b88a` | `d669753a7c28` |
| `recall_at_k_window` | **0.3** | **0.25** |
| `recall_at_k_summary` | **0.7** | **0.583333** |
| `recall_at_k_retrieval` | **0.8** | **0.666667** |
| 更新 | `U01`：`M03`（二甲双胍）→ `M07`（达格列净） | `U01`：`M03`（阿托伐他汀）→ `M10`（瑞舒伐他汀） |
| 遗忘 | `M02`（散步）、`M06`（戒烟） | `M02`、`M05`、`M07`、`M08`、`M09` |
| `before_after` 里的关键差异 | Q04「散步和抽烟」`[M02,M06] → []`；Q02 `[M07,M03] → [M07]` | Q05「游泳和散步」`[M05,M09] → []`；Q04 `[M02] → []` |

- **标定过程**：初稿的提问写得太"语义化"（例如"他现在用的是什么降糖药？"），与条目文本**几乎没有字面重叠**，
  于是字符 2-gram 检索的 `recall@k` 只有 0.5 / 0.42 —— 比摘要还差，梯度就反了。
  改成"像真实记忆检索那样带上患者原话关键词"后（"他现在还在用二甲双胍吗？"），
  三者才形成**窗口 < 摘要 < 检索**的稳定顺序。这一步说明：这类实验的指标梯度**必须靠造数据时量出来**，
  不能指望写完就"自然好看"；
- 同时**刻意留下"被遗忘就检不到"的题**（Q04 / Q05）—— 它们的 `after` 是空数组，
  这正是"遗忘的代价"进入指标的入口；
- **复验**：参考实现 **2/2 通过、硬性 13/13**（case01 58s / case02 45s，`hardChecks.failed` 为空）；
- **一次真实的复验失败**：case02 首次 `judge` 判 0.5（"notes 未对错误记忆给出补救措施"）——
  这是判据**真的在起作用**（不是形式主义），补上"写入前确认 / 关键条目人复核 / 记录来源轮次"后 2/2 通过；
- **`--check`**：退出码 0，13 条断言，`dependencyCheck.ok = true`（只用到 `matplotlib`，其余为纯标准库）。

## 项目字段文案（上传到平台时用）

**objectives**

1. 能说清记忆系统的**四操作**（写入 / 检索 / 更新 / 遗忘）各自负责什么，以及为什么"更新"必须让旧条目失效。
2. 能说清三种上下文组织策略**各自的代价**：窗口省 token 但只留最近几轮、摘要压缩率高但同类只剩一条、
   检索命中率最高但依赖"提问与条目的用词能对上"。
3. 能用**行为性证据**说明更新与遗忘真的生效（`before/after` 的差异），
   并理解"遗忘是不可逆的"与"错误记忆 = 错误病史"这两条风险。

**background**

- **四操作**：Store（写入）/ Retrieve（检索）/ Update（更新）/ Forget（遗忘）——
  大模型本身无状态，"记住你上次说过什么"全靠外面这一层。
- **分层记忆**：工作记忆（当前对话）→ 短期 → 长期（事实库）/ 情景（发生过什么）/ 程序（怎么做）。
- **三种上下文策略**：窗口（只留最近 N 轮）、摘要（把历史压成一段）、检索（按当前提问取相关条目）——
  它们不是"哪个更好"，而是**不同代价**的取舍。
- **更新**：患者换了药，旧条目必须失效（`superseded`），否则检索还会命中旧药 —— 这是最常见的出错点。
- **遗忘**：按重要性 / 时效丢弃，对应合规上的"数据最小化 / 留存期限"；
  但它是**不可逆**的：被遗忘的信息不会出现在任何一次检索里。
- **风险**：记忆条目是从对话**抄下来的原文**，抄错或更正没生效 ⇒ 后面每一次检索都在用错的事实。

**description**（导学步骤）

1. 读 `task.md`：**先看清五套口径**（抽取、更新、遗忘、三策略、检索 —— 都不许改），再看交付格式。
2. 读 `problem/reference/`：一份走完六步的示范 —— 先读懂输出，再写你自己的。
3. **写入**：按 `kind` 决定哪些轮产生条目，按 `(date, turn_id)` 编号，算 `entries_checksum`。
4. **更新**：把 `更正：<旧说法> → <新说法>` 里的旧条目**标成 superseded**（不是"再写一条新的"）。
5. **遗忘**：只对仍是 `active` 的条目套阈值（被更正的不会被顺带遗忘 —— 注意这条边界口径）。
6. **三种策略**：窗口 / 摘要 / 检索各算 `recall@k`，并给出每个提问**用了哪些条目**。
7. **对照 before/after**：把"更新与遗忘之前 vs 之后"的检索结果并列报出来（这是行为性证据）。
8. **画图 + 写结论**：一张三策略 `recall@k` 柱状图（标题轴标签用英文）；`notes` 讲清取舍、代价与风险。
9. **自测两个 case**：与 `cases/<case>/expected.json` 对照（条目、窗口、摘要、检索、指标、before/after）。

**references**

- 课程第 16 章《记忆系统 Memory》（分层记忆、四操作、随访助手示例、隐私 vs 连续性照护的讨论）
- 上下文窗口与检索增强：<https://en.wikipedia.org/wiki/Retrieval-augmented_generation>
- 数据最小化原则：<https://en.wikipedia.org/wiki/Data_minimization>
- 本课程第 5 章《知识库概念和文本内容》（"搜得到字面、搜不到意思"—— 本实验检索策略的天花板）

**faq**

- **条目数比预期多？** 把 `question`（助手提问）或 `chitchat`（闲聊）也算成条目了：
  只有 `kind ∈ {fact_statement, correction}` 的轮才产生条目。
- **`category` 与预期不同？** 判定必须**按顺序命中即停**（过敏 → 停用/换用/改为/加用 → 化验类 →
  生活习惯类 → 更正轮兜底 → other），顺序一改结果就变。
- **更新之后旧条目还被命中？** 更新是"旧条目**失效**"（`status=superseded` + `superseded_by`），
  不是再写一条新的。
- **被更正的条目出现在 `forgotten` 里？** 遗忘**只处理 `active`**；`superseded` 不再被顺带遗忘。
- **窗口里列出了已被遗忘的条目？** 窗口"能提供的条目"要按**最终状态**过滤。
- **检索结果里有 0 分的条目？** 口径是**只保留相似度 > 0** 的；一个都不命中就返回空数组。
- **`mem0` 在哪？** 本环境没有外网、也装不了 `mem0`；实验用的是"本地条目表 + 自己实现的检索"。

## 打包 / 自检 / 复验

```sh
cd server/fixtures/memory-strategies
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构与依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧闭环：拿参考实现跑一遍复验（应 2/2 通过）
cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low -e VERIFY_MAX_CASES=0 \
  -v "$PWD/server/fixtures/memory-strategies:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/memory-strategies.json --timeout-ms 300000
```

重算 `expected.json`（**必须与复验同镜像**）：

```sh
cd server/fixtures/memory-strategies
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/memory_assistant.py --regen-expected
```

上传两个 ZIP 拿 `fileId`，绑到「Skill 模板」「题目包」，再用 `chapterId` 挂到课程
《分子医学人工智能理论与实验》**第 16 章《记忆系统 Memory》**下并 publish
（命令见 `docs/EXPERIMENT-CREATION-GUIDE.md` 步骤 11）。
