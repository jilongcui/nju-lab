# 智能体综合实践 · 分子医学学习助手（第 19 章 · 收官 · 迁移检验）

> 课程《分子医学人工智能理论与实验》**第 19 章《智能体综合实践：分子医学学习助手》**
> （chapter id `8fb368bb-e56a-4cd5-8e93-c0761792ec99`）。
> 正文阶段二写的是 `mem0` / MCP 工具 / LangChain-LangGraph / 文献 PDF —— 这几样本环境都跑不通
> （无外网、镜像里没有这些库），实验里改成"**本地条目表 + 本地 mock 工具 + 自己的编排脚本**"，
> 并在正文对应位置补了说明与"与真实工程方案的差距"（见
> `docs/PLAN-2026-10-experiment-roadmap.md` §7）。

**用户选定的口径（2026-10-10，路线图 §6 第 9 项）**：**折中方案** ——
学生拿到的 `skill-template/` 只有 `SKILL.md` + TODO 空壳（`--check` 要求有 `SKILL.md`），
`problem.zip` 里**不放 `reference/`**；教师侧在本目录根下另建 **`solution/`**（不打进任何 ZIP、不下发），
用它跑复验来证明「**题目可解 + 判据不误杀**」。

## 结构

```
learning-assistant/
├── problem/            → problem.zip        题目包（**随包下发给学生**，**没有 reference/**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 12 条确定性断言
│   ├── task.md         需求 + 六步流程 + 五件事的契约（记忆/工具/报告/引用/安全）+ 交付格式
│   ├── judge.md        语义判据（逐环理由、检索结果≠结论、安全边界、至少两条局限）
│   ├── README.md       导学 + 排错表（并说明"为什么没有参考实现"）
│   └── cases/case0N/{questions.csv,experiment_data.csv,passages.csv,tools.json,tool_calls.csv,
│                     report_template.json,expected.json}
├── skill-template/     → skill-template.zip 学生起点（**只有空壳与 TODO**，五处环节全空）
├── solution/           ⚠️ **教师侧解答样例（不下发、不打包）** —— 只用于复验与标定 expected
├── tools/gen_data.py                        造题工具（**不下发**）
└── README.md
```

> `solution/` 与 `problem/` 平级，而打包命令是 `(cd problem && zip -qr ../problem.zip .)` ——
> 所以它**永远不会**被带进题目包（这一点已用 `unzip -l problem.zip` 核对过）。

## 场景与数据

- 应用：把"学生提问 + 实验数据 + 教材段落 + 本地工具 + 报告模板"串成一个**最小闭环**，
  产出带**行级/段级出处**的实验报告，并且**守得住安全边界**
- 形态：**迁移检验**（不给参考实现）+ 契约钉死（五件事的判定口径全部写死）
- 数据（合成教学数据，中文，无真实患者）：

| 文件 | 列/键 | 说明 |
|---|---|---|
| `questions.csv` | `q_id,question` | 学生提问：一题透露薄弱点（固定句式）、一题复现该薄弱点、一题**要求下诊断** |
| `experiment_data.csv` | `row_id,item,value,unit` | 实验读数；**故意放了两行越界值** |
| `passages.csv` | `passage_id,item,source,text` | 教材/规范段落；同一 item 常有多条（用来考"取段落号最小"） |
| `tools.json` | `tools[].name/parameters` | 本地 mock 工具名册（参数名 / 类型 / 是否必填） |
| `tool_calls.csv` | `call_id,tool,args` | **待执行**的调用；**故意混入**缺必填、类型错、未知工具 |
| `report_template.json` | `sections` / `thresholds` / `messages` | 四节模板与最小篇幅、警戒线、固定话术 |

| case | 规模 | 关键点 |
|---|---|---|
| case01 | 8 行数据 / 6 次调用 / 3 个提问 | 越界：`R02` 血小板 18、`R06` 白细胞 12.5；被拒调用：`missing_required` + `type_mismatch` |
| case02 | 10 行数据 / 6 次调用 / 3 个提问 | 越界：`R02` 舒张压 182、`R04` 收缩压 145；被拒调用同上两种 |

## 判据设计要点

1. **"必须发生"的五件事都做成硬性断言**：不是"实现了就行"，而是
   `tool_calls` 逐条（校验结论 + 路由 + **mock 结果摘要**）、`memory.written` / `memory.applied` 非空且一致、
   报告四节名称与最小篇幅、`citations` 的 `(kind, ref)` 与顺序、`safety.escalations` 命中越界行
   且 `message` **逐字等于固定话术**、`safety.refusals` 命中"要求下诊断"的那一题；
2. **非法调用必须留痕**：断言里专门有一条要求"`args_valid=false` 的条数 == `n_call_rejected`，
   且每一条都有非空的 `rejected_reason`" —— 真实系统里"悄悄跳过非法调用"是最危险的做法；
3. **口径钉死到"结果唯一确定"**：记忆抽取（固定句式 + `fact` 写法）、工具校验（四种理由 + **命中即停的顺序**）、
   mock 摘要格式、越界判定（`thresholds`）、引用格式与顺序、固定话术 —— 于是 `expected.json` 是确定值，
   **迁移检验仍然可以被机器判**；
4. **报告正文与措辞不逐字比对**：只判"四节齐全 + 顺序 + 最小篇幅"，意见性的部分交给 `judge.md` ——
   这是"迁移检验"必须留出的自由度（学生怎么实现、怎么写是他的选择）；
5. **安全边界做成产出字段**（照第 18 章的做法）：平台没有 hooks 运行时，
   所以升级与拒答必须体现在 `safety.refusals` / `safety.escalations` 里才判得了；
6. **判据分层**：12 条 `assertions` 全是"能写死的事实"；"逐环为什么这么做 / 有没有把检索当结论 /
   是否正视局限"交给 `judge.md`。

## 为什么不下发参考实现（设计说明）

- 按 `EXPERIMENT-DESIGN-FRAMEWORK.md` §3.5 对**收官实验**的建议：**尽量不给答案** ——
  只给需求 + 数据 + 交付契约，考察学生能不能把前 18 章学到的东西（记忆 / 工具 / 技能 / 检索 / 出处 / 安全边界）
  **自己组装起来**；
- 但这会牺牲完成定义里的"参考实现复验 2/2"（教师侧"题目可解性"的机器证明）——
  所以用**折中**：`solution/` 放在 fixture 根下、**不进任何 ZIP**，既保住迁移检验，又保住机器证明。
  学生从题目包与 Skill 模板里**看不到**它（已核对 `problem.zip` 内容）；
- 题干里也把这件事说清楚了（"⚠️ **本题不给参考实现**"），并指向他做过的实验，避免"卡住就没有出路"。

## 出题时的实测依据（不是推测，2026-10-10 在复验镜像 `pkg6` 里跑）

| 指标 | case01 | case02 |
|---|---|---|
| 工具调用 | 6 次（**4 executed / 2 rejected**：`missing_required`、`type_mismatch`） | 6 次（4 / 2，同上） |
| mock 结果（示例） | `血小板计数 均值 111.5`、`白细胞计数 均值 9.0`、`血小板计数 的参考段落 P-02` | `收缩压 均值 129.0`、`心率 均值 78.0`、`舒张压 的参考段落 P-02` |
| 越界行 | `R02`（血小板计数 18）、`R06`（白细胞计数 12.5） | `R02`（舒张压 182）、`R04`（收缩压 145） |
| 记忆 | 1 条（`老是搞混 白细胞计数 和 血小板计数`），应用 **1 次**（Q02） | 1 条（`老是搞混 收缩压 和 舒张压`），应用 **1 次**（Q02） |
| 引用 | 4 条（`data:R02`、`data:R06`、`passage:P-01`、`passage:P-02`） | 4 条（`data:R02`、`data:R04`、`passage:P-01`、`passage:P-02`） |
| 安全边界 | 升级 2 条（固定话术）+ 拒答 1 条（Q03） | 升级 2 条 + 拒答 1 条（Q03） |

- **复验（教师侧 `solution/` 当交付物）**：**2/2 通过、硬性 12/12**（case01 64s / case02 49s，
  `hardChecks.failed` 为空，rationale 无"矛盾"类问题）—— 这就是"题目可解 + 判据不误杀"的机器证明；
- **`--check`**：退出码 0，12 条断言、6 个输入、`dependencyCheck.ok = true`（只用到 `matplotlib`）；
- **打包核对**：`unzip -l problem.zip` 确认**没有** `solution/`、也没有 `reference/` ——
  学生拿到的题包只有题干、判据、导学与 case 数据。

## 项目字段文案（上传到平台时用）

**objectives**

1. 能把**记忆 / 工具调用 / 技能流程 / 检索与出处 / 安全边界**五件事组装成一个最小闭环，
   并说清每一环为什么这么做。
2. 能区分"**检索结果**"与"**结论**"：引用只说明出处，不能替代判断（越界读数只能升级，不能下诊断）。
3. 能正视工程局限：本地 mock 工具不是真 MCP、报告不是模型生成、记忆不是 mem0、
   检索只到字面/行级 —— 并说明换到真实环境该怎么补。

**background**

- **四模块架构**（第 19 章正文）：感知（读数据与提问）→ 大脑（规划与路由）→ 行动（工具与分析）→
  记忆（跨轮沉淀与取用）；本实验就是把这四个模块**各做一次最小的**。
- **为什么"失败也要留痕"**：工具调用的参数不合法时，只跳过不记录，等于把模型的错误藏起来 ——
  既看不出它想干什么，也调不优。正确做法是**如实记 rejected + 理由**。
- **为什么引用要落到行级/段级**：`experiment_data.csv:R02` 能让人一眼回到那一行核对；
  "根据数据"这种说法在出错时毫无价值。
- **安全边界**：越界读数可能是**测错**的，助手没有资格替人判断 ⇒ 升级 + 固定话术；
  诊断结论必须由医师结合完整病史与检查作出 ⇒ 拒答。
- **本环境的限制**：无外网、镜像里没有 `mem0` / MCP SDK / LangChain-LangGraph / 文献 PDF，
  所以用本地等价物；这些差距要在 `notes` 里说明。

**description**（导学步骤）

1. 读 `task.md`：**先看清五件事的契约**（记忆 / 工具 / 报告 / 引用 / 安全 —— 口径都不许改），再看交付格式。
2. ⚠️ **本实验不给参考实现**（收官·迁移检验）—— 卡住时回头看第 16 / 17 / 18 章做过的实验。
3. **记忆**：从提问里按固定句式抽薄弱点，在后面的提问里真的用上。
4. **工具**：按 `tools.json` 的 schema 校验 `tool_calls.csv` 的每个请求（顺序：未知工具 → args 非对象 →
   缺必填 → 类型不符，命中即停），合法的路由到本地 mock 执行，**非法的如实记 rejected + 理由**。
5. **报告**：按 `report_template.json` 生成"目的 / 方法 / 结果 / 讨论"四节，每节达到最小篇幅。
6. **出处**：越过 `thresholds` 的行逐行引用到行级，解释引用到段级（格式与顺序都钉死了）。
7. **安全边界**：越界读数升级 + 固定话术（一字不改）；出现「直接告诉我」「你直接说」的提问一律拒答。
8. **画图 + 写结论**：一张"各指标均值 + 越界行数"的图（**图标签用 ASCII**，中文映射写进 `takeaway`）；
   `notes` 讲清每一环的理由、检索结果 ≠ 结论、至少两条局限。
9. **自测两个 case**：与 `cases/<case>/expected.json` 对照（调用 / 记忆 / 四节 / 引用 / 安全 / `key_facts`）。

**references**

- 课程第 19 章《智能体综合实践：分子医学学习助手》（四模块架构、三阶段路径、验收标准、医疗安全红线）
- 课程第 16 章《记忆系统 Memory》（本实验的记忆就来自它）
- 课程第 18 章《技能 Skill 的创建与使用》（确定性任务下沉给脚本、安全边界落成输出字段）
- 课程第 5 / 9 章（口径钉死 + 逐字段比对、出处可溯源）
- 医疗 AI 的安全性讨论：<https://en.wikipedia.org/wiki/Regulation_of_artificial_intelligence>

**faq**

- **本实验为什么没有 `reference/`？** 这是收官·迁移检验的设计：只给需求 + 数据 + 交付契约。
  卡住请回头翻第 16 / 17 / 18 章的实验。
- **非法调用被我跳过了？** 口径是**每条 `tool_calls.csv` 都要出现在报告里**，
  非法的记 `args_valid=false` / `status="rejected"` + 非空 `rejected_reason`。
- **`rejected_reason` 写什么？** 只能是 `unknown_tool` / `invalid_args` / `missing_required` /
  `type_mismatch` 之一（校验顺序：未知工具 → args 非对象 → 缺必填 → 类型不符，命中即停）。
- **`mean_of_column` 的结果差一点？** `decimals` 缺省 0；摘要格式是 `"{column} 均值 {round(均值, decimals)}"`
  （`9.0` 不是 `9`）。
- **`fetch_reference` 取错段落？** 同一 item 可能有多条段落，口径是取 `passage_id` **最小**的那条。
- **`citations` 顺序？** 先全部 data（按 `row_id` 升序），再全部 passage（按 item 字符串升序）。
- **`escalations` 的 message 与模板不一致？** 必须**一字不改**地抄 `messages.warn`。
- **图上中文变方框？** 环境没有中文字体：标签用 `item 1` / `item 2` 这类 ASCII 编号，
  中文映射写在 `figures[].takeaway` 里。
- **`mem0` / MCP / LangGraph 在哪？** 本环境无外网、也装不了；实验用本地等价物（已在正文里说明差距）。

## 打包 / 自检 / 复验

```sh
cd server/fixtures/learning-assistant
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)
unzip -l problem.zip      # 核对：**没有** reference/ 与 solution/

# 结构与依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧闭环：拿 **solution/**（不下发）跑一遍复验（应 2/2 通过）
cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low -e VERIFY_MAX_CASES=0 \
  -v "$PWD/server/fixtures/learning-assistant:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/solution --problem /p/problem.zip \
  --out /outputs/learning-assistant.json --timeout-ms 300000
```

重算 `expected.json`（**必须与复验同镜像**）：

```sh
cd server/fixtures/learning-assistant
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/solution/scripts/learning_assistant.py --regen-expected
```

上传两个 ZIP 拿 `fileId`，绑到「Skill 模板」「题目包」，再用 `chapterId` 挂到课程
《分子医学人工智能理论与实验》**第 19 章《智能体综合实践：分子医学学习助手》**下并 publish
（命令见 `docs/EXPERIMENT-CREATION-GUIDE.md` 步骤 11）。
