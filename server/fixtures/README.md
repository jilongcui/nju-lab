# 示例实验项目（fixtures）

平台示例实验项目的源文件。每个项目同一套结构（见下），差别在**任务范式**与依赖：

| 实验项目 | 任务 | 范式 | 判分方式 |
|---|---|---|---|
| [`aq-forecast/`](aq-forecast/) | 下一小时 PM2.5 估算 | **应用驱动**（回归：需求 → 选模型 → 基线 → 达标） | `manifest.assertions`（达标线）+ `judge.md`（语义） |
| [`noshow-predict/`](noshow-predict/) | 门诊预约失约预测 | **应用驱动**（二分类 · 类别不平衡：recall/precision 双达标） | 同上（9 条断言，含**防退化**项） |
| [`customer-tier/`](customer-tier/) | 会员价值分级 | **应用驱动**（多分类：macro F1 + 逐档召回） | 同上（9 条断言，防"只保大类"） |
| [`csv-cleaner/`](csv-cleaner/) | CSV 数据清洗 | 口径驱动（内置回落型，最简） | LLM judge 逐字段比对 |
| [`sales-report/`](sales-report/) | 销售明细汇总 | 口径驱动（包驱动型） | LLM judge 逐字段比对 |
| [`ml-basics/`](ml-basics/) | 机器学习基础建模 | 技术驱动（一个实验塞多个算法变体）—— **已下线** | — |
| [`dl-train-diagnose/`](dl-train-diagnose/) | 产线来料自动分检（二分类 · **训练过程诊断**） | **应用驱动 · 深度学习一** | 13 条断言（达标线 + 逐轮训练历史 + 防退化）+ `judge.md` |
| [`dl-cnn-images/`](dl-cnn-images/) | 手写数字分拣（小图分类 · **卷积结构**） | **应用驱动 · 深度学习二** | 13 条断言（macro F1 + 逐档召回）+ `judge.md` |
| [`dl-rnn-forecast/`](dl-rnn-forecast/) | 传感器时序下一值估计（**序列建模 · 滑窗 + LSTM**） | **应用驱动 · 深度学习三** | 13 条断言（MAE 比值 + 窗口/样本数自洽）+ `judge.md` |
| [`sql-crud/`](sql-crud/) | 检验数据登记与查询（**建库 + SQL 增删改查**） | **应用驱动 · 关系数据库** | 12 条断言（清洗口径 + 表结构/外键拒绝 + 三表查询）+ `judge.md` |
| [`vector-search/`](vector-search/) | 相似病例语义检索（**向量化 + Top-K + 对照**） | **应用驱动 · 向量数据库** | 12 条断言（Top-K 名单 + 两种检索召回 + 增删改查）+ `judge.md` |
| [`kg-alerts/`](kg-alerts/) | 用药安全预警（**三元组建图 + 多跳路径**） | **应用驱动 · 知识图谱** | 11 条断言（图统计 + 多跳预警含路径 + 本体校验拒绝）+ `judge.md` |

> **数据库章（第 6/7/8 章）的三个实验**：与本课程既有实验（机器学习 / 深度学习）**同一套机制**
> （题目包 + Skill 两态 + 判据分层 + 参考实现随包下发），只是**流程换了一条**：
> ML 是「需求 → 看数据并画图 → 定基线 → 训练 → 评估并画图 → 结论」，
> 数据库/知识库是「需求 → 摸清数据（或看懂词表/本体）→ **搭结构与环境** → **增删改查** →
> 验证查询（JOIN / 相似度 / 多跳）→ 结论」。三个实验都**零新增依赖**：
> 关系库用 Python 标准库 `sqlite3`、向量库用词表计数 + `math`/`numpy`、
> 图谱用镜像里已有的 `networkx` —— 因为学生工作台与复验容器都**没有外网**，
> "运行环境"只能是**镜像已预装 + 学生脚本自己搭起来**（这一点写在各实验 `task.md` 里）。
> 对应正文：课程《分子医学人工智能理论与实验》第 6/7/8 章（关系数据库 / 向量数据库 / 知识图谱）。

> **深度学习章（第三章）的三个实验**：每一个都是**一个完整的应用问题**，都走完同一套六步流程
> （① 看清需求 → ② 看一眼数据并画图 → ③ 定基线 → ④ 训练模型 → ⑤ 评估并画图 → ⑥ 写结论）——
> 差别在**应用与数据**，不在"练哪个技术点"：
> ① `dl-train-diagnose` 产线来料自动分检（表格数据二分类，量纲差异大、缺陷件只占两三成）；
> ② `dl-cnn-images` 表单手写数字分拣（8×8 小图十分类，笔画位置就是信息）；
> ③ `dl-rnn-forecast` 车间设备温度提前一分钟估计（传感器时序，要看出"下一分钟往哪走"）。
> 三个实验共用同一套判据骨架（§5.1 分层：算术给 `assertions`、语义给 `judge.md`），
> 且都要求 `training.history` 逐轮记录 —— 把"真的训练了"变成硬性条件。

> **做新实验**：先读 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` ——
> **应用驱动**（推荐，学生自己选模型、判"是否达标"）看 **§2.6 + §3.5**，照
> `cp -r aq-forecast <你的实验名>` 改；**数据库 / 知识库类**（建库/增删改查/检索/图谱查询）照
> `cp -r sql-crud <你的实验名>` 改（最接近"口径钉死 + 逐字段比对"的形态）；
> **口径驱动**（给定模型与口径、逐字段比对）看 §2.4，照
> `cp -r sales-report <你的实验名>` 改。格式细节见 `docs/EXPERIMENT-PACKAGE-SPEC.md`。

> ⚠️ **现状（2026-10-10）**：
> - `aq-forecast` 是**应用驱动样板**（平台项目已建并发布）；`ml-basics` 的平台项目**已删除下线**，
>   仓库目录保留作历史参考（它的 5 个技术用例已被 aq-forecast 取代）。
> - `csv-cleaner` / `sales-report` 仍是口径驱动，且参考实现放在顶层 `skill-solution/`（不下发）；
>   若要把它们改成"参考实现随包下发"（§3.5 第 5 项），照 `aq-forecast` 做
>   （`git mv skill-solution problem/reference` + 重打 zip + 重新绑定）。
> - **判据分层**（算术给代码、语义给模型）见 §2.6 与 §5.1，模板是 `aq-forecast/problem/`。

## 统一结构：题目包（含参考实现）+ 学生起点 + 教师工具

```
<实验名>/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── task.md  judge.md  manifest.json
│   ├── README.md                             导学：学什么 / 怎么走 / 包内有什么
│   ├── cases/case0N/{input.*, expected.*}
│   └── reference/                            **参考实现（学习示范）** —— 学生先读后仿
├── skill-template/     → skill-template.zip 学生起点：原理 + 最小示例 + TODO
├── tools/                                   造题工具（不下发；可选）
└── README.md                                打包 / 自检 / 上传 / 自检闭环命令
```

> `ml-basics` 是**教学向样板**（2026-10-08 起）：参考实现放进题目包随包下发，项目字段
> （`objectives` / `background` / `description` / `references` / `faq`）写实，骨架留解释层。
> 设计原则与七件事清单见 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §3.5。

两条形态契约（`--check` 会查）：

- `skill-template.zip` 的**根**必须是含 `SKILL.md` 的那一层（`no unique SKILL.md layer` 就会失败）；
- `problem.zip` 的**根**必须有 `cases/`，每个 case 有输入文件与 `expected.*`
  （多出别的目录不影响 —— 参考实现就是这么放进去的）。

**三个 Skill 形态**（起点骨架 / 参考实现 / 学生提交）只有完成度与可见性不同：起点与参考实现
**形态完全相同**（同样的函数划分），前者留 `TODO` + 解释层、**随 `skill-template.zip` 下发**，
后者写满、**随 `problem.zip` 下发**（先读后仿）；学生提交的那份被复验装入。
参考实现还有第二个用途：**拿它跑一遍复验 = "题目可解性"的机器证明**（各项目 README 有命令）。

`tools/` 是唯一**不下发**的目录（造题脚本：怎么造题不是学习材料）。

## 各项目细节

- **csv-cleaner**：见 [`csv-cleaner/README.md`](csv-cleaner/README.md)（含"骨架也通过了"这一区分度实测结论）
- **sales-report**：见 [`sales-report/README.md`](sales-report/README.md)
- **ml-basics**：见 [`ml-basics/README.md`](ml-basics/README.md)（含 `tools/gen_cases.py` 的用法）
- **dl-train-diagnose / dl-cnn-images / dl-rnn-forecast**：见各自 `README.md` ——
  每个都含「判据设计要点」「**出题时的实测依据**（同一切分下量出的几档差距）」「项目字段文案」与打包上传命令。
  三个实验的数据分别来自公开数据集 `load_breast_cancer` / `load_digits`（`tools/gen_data.py` 可重跑）
  与合成教学时序；参考实现与骨架的**函数划分一致**，便于学生逐段对照。
  数据规模与训练开销都按 CPU 1 核 1~2g 内存设计（单 case 6~70 秒）。

## 打包 / 自检 / 上传（通用）

```sh
cd server/fixtures/<实验名>
rm -f skill-template.zip problem.zip
(cd skill-template && zip -qr ../skill-template.zip .)   # zip 根即 SKILL.md
(cd problem        && zip -qr ../problem.zip .)          # zip 根即 cases/ 与 manifest.json

# 上传前自检（不烧 token）：结构 + 依赖
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip
```

上传拿 fileId 后在项目详情里绑定（`Skill 模板` ← `skill-template.zip`、
`题目包` ← `problem.zip`）；**平台上绑定的是 fileId，与 zip 文件名无关**，
但文件名会成为学生下载到的原始名。完整命令见各项目 README。

注意：`problem/cases/*/expected.*` 是评分基准，改任一 case 即视为新版本 ——
**不要在有学生做的时候换**。

## 平台绑定现状（2026-10-08 更新）

三个示例项目已按新结构重新上传并绑定：

| 项目 | Skill 模板 | 题目包 |
|---|---|---|
| 机器学习基础模型构建与运行 | `ml-basics/skill-template.zip` | `ml-basics/problem.zip` |
| 实验：数据清洗 | `csv-cleaner/skill-template.zip` | `csv-cleaner/problem.zip` |
| 实验一：CSV 数据清洗 Skill | `csv-cleaner/skill-template.zip` | `csv-cleaner/problem.zip` |

（`sales-report` 未绑定到任何线上项目，仅作示例。）

历史制品：2026-10-01 上传的 `template.zip` / `dataset.zip` 仍在文件库里（sha256 `10486f5e…` / `3f055d84…`），
已不再被任何项目引用 —— 需要时可作为回滚点重新绑定。
