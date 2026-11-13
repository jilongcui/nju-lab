/**
 * 学员模式的步骤状态机。
 *
 * 目的（2026-10-22 用户口径）：**整个实验围绕最后的 report.md 展开** —— 一次只做一步，
 * 每步先把"要做什么"讲清、把产出列出来（图 present 到对话里），等学生明确说"下一步"
 * 才推进；最后一步按报告模板自动生成 `report.md`，数字从产出文件里取，不靠学生手填。
 *
 * 状态落在 `<workspace>/nju-lab/<assignmentId>/progress.json`：DSH 每次启动都是新进程，
 * 不落盘的话学生关掉再打开就回到第 1 步（与 `eval-state.ts` 同一个理由）。
 *
 * 这里只有纯逻辑（无 cordis / 无 IO 副作用之外的东西），便于 L1 直接测。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 实验类型决定步骤文案与报告表格列。 */
export type ExperimentKind =
  | 'classification'
  | 'regression'
  | 'dl-classification'
  | 'dl-regression'
  /** 二分类偏召回/精确率（失约预测、缺陷检出） */
  | 'detection'
  /** 检索类（recall_at_k_*） */
  | 'retrieval'
  /**
   * 工程实现型：按题目口径写一段确定性代码（四环实现 / 记忆状态机 / 协议报文 / 判定脚本）。
   * 这一类**没有"定基线 → 训练 → 指标"**，交付物是逐字段可比的结构（output.json）。
   */
  | 'engineering'
  /**
   * 数据库 / 知识库类：建库建表 / 增删改查 / 向量检索 / 图谱多跳。
   * 流程是「摸清数据 → 搭结构与环境 → 增删改查 → 验证查询」，同样**没有基线、训练、指标**。
   */
  | 'database'
  /**
   * 搭建型：自己写一个**能跑的 agent**（循环 / 工具 / 记忆 / 边界），交付物是一份产出 + 能对话的应用。
   * 与前几种的区别：**没有标准答案、没有 expected.json**，判"事情办成没有"而不是"和答案像不像"。
   * 识别依据：题目包 `manifest.json` 里 `runMode: "script"`（交付物是可执行程序）。
   */
  | 'agent'
  | 'generic'

export interface StepDef {
  /** 稳定 id，写进 progress.json，改名会让老进度对不上 */
  id: string
  title: string
  /** 这一步要做什么（给模型看的指令，也是给学生看的说明） */
  ask: string
  /** 这一步至少要有哪些产出，才算做完了（用于提示，不硬拦） */
  need: string
  /**
   * 这一步由谁动手（2026-10-23 用户口径：教导模式下**学员做，AI 只讲解与检查**）。
   * 只有最后一步"生成报告"由 AI 用工具完成 —— 那本来就是机器活。
   */
  owner: 'student' | 'coach'
}

// 定义里不写 owner：由 stepsFor() 统一补（默认学员做、report 归教练）
const STEPS: Record<Exclude<ExperimentKind, 'detection' | 'retrieval'>, Array<Omit<StepDef, 'owner'>>> = {
  classification: [
    {
      id: 'understand',
      title: '看清需求',
      ask: '读实验内容与任务要求，确认达标线（accuracy / macro F1）与"三个类别都要认出来"这条硬要求；把需求复述给学生确认。',
      need: '确认达标线与难点',
    },
    {
      id: 'look',
      title: '看一眼数据 + 画图',
      ask: '加载数据，报出样本数、各类别数量；画一张散点图（两个特征），指出哪类分得开、哪两类重叠。',
      need: 'figures/ 里的散点图 + 一句结论',
    },
    {
      id: 'baseline',
      title: '定基线',
      ask: '算"一律报训练集里最多的类别"的 accuracy，写进 output.json 的 baseline，并说明它为什么是下限。',
      need: 'baseline.accuracy',
    },
    {
      id: 'model',
      title: '训练模型',
      ask: '选一个入门模型（逻辑回归 / KNN / 决策树），固定随机种子、stratify 切分后训练；报出 n_train / n_test。',
      need: 'model 名称 + 切分数字',
    },
    {
      id: 'eval',
      title: '评估 + 画混淆矩阵',
      ask: '在测试集上算 accuracy 与 macro F1，画 3×3 混淆矩阵，指出错判集中在哪两类、为什么。',
      need: 'metrics + figures/ 里的混淆矩阵 + 一句结论',
    },
    {
      id: 'report',
      title: '生成实验报告',
      ask: '调用 nju_lab_finalize_report 自动生成 report.md（数字取自 output.json），把报告与图 present 给学生确认，确认后再提交。',
      need: 'report.md + 学生确认',
    },
  ],
  regression: [
    {
      id: 'understand',
      title: '看清需求',
      ask: '读实验内容与任务要求，确认达标线（MAE 相对基线的比值）与要交的字段。',
      need: '确认达标线',
    },
    {
      id: 'look',
      title: '看一眼数据 + 画图',
      ask: '加载数据，报出样本数；画特征-目标散点图，说明关系是不是直线、哪里偏。',
      need: 'figures/ 里的散点图 + 一句结论',
    },
    {
      id: 'baseline',
      title: '定基线',
      ask: '按题目口径算不建模基线（例如"平均单价 × 面积" / "一律报平均分"）的 MAE，写进 baseline。',
      need: 'baseline.mae',
    },
    {
      id: 'model',
      title: '训练模型',
      ask: '拟合模型（线性回归要带截距；神经网络要标准化），报出 n_train / n_test。',
      need: 'model 名称 + 切分数字',
    },
    {
      id: 'eval',
      title: '评估 + 画预测-实际图',
      ask: '算 MAE 与 R²，画预测-实际（或残差）图，说明误差偏向哪一段。',
      need: 'metrics + figures/ 里的评估图 + 一句结论',
    },
    {
      id: 'report',
      title: '生成实验报告',
      ask: '调用 nju_lab_finalize_report 自动生成 report.md，present 给学生确认后提交。',
      need: 'report.md + 学生确认',
    },
  ],
  'dl-classification': [
    {
      id: 'understand',
      title: '看清需求',
      ask: '读实验内容与任务要求，确认 accuracy / macro F1 达标线，以及"必须记录逐轮训练损失"。',
      need: '确认达标线与训练历史要求',
    },
    {
      id: 'look',
      title: '看一眼数据 + 画图',
      ask: '报出样本数与各类别数量；画几张样例图和一个类别计数图。',
      need: 'figures/ 里的样例图 + 一句结论',
    },
    {
      id: 'baseline',
      title: '定基线',
      ask: '算"一律报最多的类别"的 accuracy，写进 baseline。',
      need: 'baseline.accuracy',
    },
    {
      id: 'model',
      title: '搭网络 + 训练',
      ask: '搭一个小网络（一层隐藏层就够），逐轮记录训练损失；报出轮数与最后一轮损失。',
      need: 'training.history（≥5 轮）',
    },
    {
      id: 'eval',
      title: '评估 + 画训练曲线与混淆矩阵',
      ask: '算 accuracy 与 macro F1，画训练损失曲线与混淆矩阵，指出最容易混的两类。',
      need: 'metrics + 两张图 + 一句结论',
    },
    {
      id: 'report',
      title: '生成实验报告',
      ask: '调用 nju_lab_finalize_report 自动生成 report.md，present 给学生确认后提交。',
      need: 'report.md + 学生确认',
    },
  ],
  'dl-regression': [
    {
      id: 'understand',
      title: '看清需求',
      ask: '读实验内容与任务要求，确认 MAE 相对基线的达标线，以及"必须记录逐轮训练损失"。',
      need: '确认达标线与训练历史要求',
    },
    {
      id: 'look',
      title: '看一眼数据 + 画图',
      ask: '画两个特征与目标的散点图，说明关系是不是直线（是否饱和）。',
      need: 'figures/ 里的散点图 + 一句结论',
    },
    {
      id: 'baseline',
      title: '定基线',
      ask: '算"一律报平均分"的 MAE，写进 baseline。',
      need: 'baseline.mae',
    },
    {
      id: 'model',
      title: '搭网络 + 标准化 + 训练',
      ask: '标准化输入与目标，搭小网络训练并逐轮记录损失；报出轮数与最后一轮损失。',
      need: 'training.history（≥5 轮）',
    },
    {
      id: 'eval',
      title: '评估 + 画训练曲线与预测-实际图',
      ask: '算 MAE 与 R²，画训练损失曲线与预测-实际图，说明哪一区段误差大。',
      need: 'metrics + 两张图 + 一句结论',
    },
    {
      id: 'report',
      title: '生成实验报告',
      ask: '调用 nju_lab_finalize_report 自动生成 report.md，present 给学生确认后提交。',
      need: 'report.md + 学生确认',
    },
  ],
  agent: [
    {
      id: 'understand',
      title: '看清需求（六件 + 硬规定）',
      ask: '读实验内容与 task.md：把六个部件（循环 / 工具 / 记忆 / 检索 / 边界 / 出处）各要满足什么复述一遍；'
        + '再把两条硬规定说清楚：该拒答的那类请求必须拒，引用只能来自本轮检索结果。',
      need: '六件口径复述 + 两条硬规定',
    },
    {
      id: 'look',
      title: '摸清材料与任务集',
      ask: '看一眼 assets.csv 的行数与字段、kb/ 有几篇、tools.json 里三个工具的参数；'
        + '再逐组读 tasks/ 的对话：一共几组、哪一组考"记住我说的话"、哪一组考"更正"、哪一组该拒答。',
      need: '材料规模 + 任务清单（标出记忆 / 更正 / 拒答各是哪组）',
    },
    {
      id: 'build',
      title: '写循环（模型决定下一步）',
      ask: '把"问模型 → 解析动作 → 执行 → 观察回填 → 再问模型"实现出来，每步都留 observation；'
        + '工具要真读文件，不要把返回值写死。',
      need: '能跑的循环 + 每步观测',
    },
    {
      id: 'verify',
      title: '跑任务集（不对标准答案）',
      ask: '跑 python3 scripts/run.py --tasks ./tasks --out output.json，逐组看结论对不对。'
        + '这一章**没有 expected.json** —— 判的是"事情办成没有"，不是"和标准答案像不像"。',
      need: '各组结论 + 自己判断达标与否',
    },
    {
      id: 'edge',
      title: '边界与记忆自测',
      ask: '专门验三条：说了"我负责 A 区"之后是否只查 A 区；更正之后是否换过来；'
        + '问"还能用多久"是否拒答且不带引用。',
      need: '三条逐条结果',
    },
    {
      id: 'report',
      title: '生成实验报告',
      ask: '调用 nju_lab_finalize_report 自动生成 report.md，present 给学生确认后提交。',
      need: 'report.md + 学生确认',
    },
  ],
  engineering: [
    {
      id: 'understand',
      title: '看清需求（口径 + 边界）',
      ask: '读实验内容与 task.md：把交付字段逐个列出来（output.json 要有哪几个键），'
        + '再把口径里"顺序 / 边界 / 不许猜"这几类硬规定复述一遍。',
      need: '交付字段清单 + 口径复述',
    },
    {
      id: 'look',
      title: '摸清材料与参考值',
      ask: '看一眼输入文件（几行 / 几条 / 哪些字段），再看 expected.json 有哪几个键 —— '
        + '它们就是"要交的东西"的答案形状；指出哪几行是边界用例（恰好等于阈值 / 表外项目 / 通知）。',
      need: '输入规模 + expected 键列表 + 边界用例清单',
    },
    {
      id: 'build',
      title: '按口径写实现',
      ask: '一个函数一个函数地按 task.md 的口径写（先查表再比大小、先查工具名再查参数这类顺序不能变）；'
        + '不许"顺手优化"，口径怎么写就怎么实现，写完报出每步的产出键。',
      need: '能跑通的实现 + 各步产出',
    },
    {
      id: 'verify',
      title: '两个 case 逐字段核对',
      ask: '跑 case01 与 case02，把 output.json 与 expected.json 逐字段比；'
        + '不一致时说出"差在第一处是哪一项、期望什么、实际什么"。',
      need: '两个 case 的比对结果（一致 / 第一处差异）',
    },
    {
      id: 'edge',
      title: '边界用例自测',
      ask: '专门跑边界那几条：恰好等于阈值、表外项目 / 空值、无效请求 / 通知、'
        + '被更新的旧条目 —— 逐条说清"按口径应该是什么结果、实际是什么"。',
      need: '边界用例逐条结果',
    },
    {
      id: 'report',
      title: '生成实验报告',
      ask: '调用 nju_lab_finalize_report 自动生成 report.md，present 给学生确认后提交。',
      need: 'report.md + 学生确认',
    },
  ],
  database: [
    {
      id: 'understand',
      title: '看清需求（要回答哪几个问题）',
      ask: '读 task.md：把要回答的查询/统计逐条列出来，写清每个问题的过滤、聚合与排序口径。',
      need: '查询清单 + 口径复述',
    },
    {
      id: 'look',
      title: '摸清数据与结构',
      ask: '看一眼输入（几行、哪些列、脏在哪几类；或先看懂概念词表/同义词表、实体类型与关系类型），'
        + '报出规模与结构。',
      need: '数据规模 + 结构/词表要点',
    },
    {
      id: 'setup',
      title: '搭结构与环境（用代码）',
      ask: '用脚本把结构搭出来：建库建表（含主键/外键）/ 向量化入库 / 三元组建图 —— '
        + '强调能重跑一遍就重建，不要手工摆数据。',
      need: '可重跑的建库/建库脚本 + 成功提示',
    },
    {
      id: 'crud',
      title: '增删改查',
      ask: '按口径做写入、更新、删除、查询；约束拒绝坏数据时如实记录被拒绝的条数与原因（那是实验要看到的现象）。',
      need: 'CRUD 结果 + 被拒绝的条数',
    },
    {
      id: 'verify',
      title: '验证查询（带出处）',
      ask: '用 JOIN / 相似度 / 多跳把结果查出来并核对，把路径、相似度分数或出处一起带出来；'
        + '与 expected.json 对不上时说出差异在第一处。',
      need: '查询结果 + 路径/出处',
    },
    {
      id: 'report',
      title: '生成实验报告',
      ask: '调用 nju_lab_finalize_report 自动生成 report.md，present 给学生确认后提交。',
      need: 'report.md + 学生确认',
    },
  ],
  generic: [
    { id: 'understand', title: '看清需求', ask: '读实验内容与任务要求，复述要做什么、达标口径是什么。', need: '复述需求' },
    { id: 'look', title: '摸清材料', ask: '看一眼输入数据/材料，报出规模与结构，并画一张图。', need: '图 + 一句结论' },
    { id: 'baseline', title: '定基线', ask: '按题目口径算出不建模/最简做法的基线数字。', need: 'baseline' },
    { id: 'build', title: '搭最小实现', ask: '搭出能跑通的最小实现，报出关键参数。', need: '能跑通的实现' },
    { id: 'eval', title: '自测 + 评估', ask: '用题目包里的 case 自测，报出指标并画评估图。', need: 'metrics + 图' },
    { id: 'report', title: '生成实验报告', ask: '调用 nju_lab_finalize_report 自动生成 report.md，present 给学生确认后提交。', need: 'report.md + 学生确认' },
  ],
}

/** 从 `output.json` 的指标形状推断实验类型（也用于给报告选表格列）。 */
export function detectKind(output: Record<string, unknown> | null | undefined): ExperimentKind {
  const metrics = (output?.metrics ?? {}) as Record<string, unknown>
  const hasTraining = output?.training !== undefined && output?.training !== null
  // 工程实现型：没有 metrics，交付的是"逐字段可比的结构"（四环结果 / 记忆快照 / 协议报文 / 判定项）。
  // 放在最前：这几种键一旦出现，就说明它不是"训练+指标"那类实验。
  // 搭建型 agent：交付的是"对话轨迹 + 模型调用账本"，一眼可辨（且必须先于 engineering 判，
  // 否则 metrics 里的键会把它带偏到"逐字段对比"那套步骤上）。
  if (output?.dialogues !== undefined && output?.llm !== undefined) return 'agent'
  const ENGINEERING_KEYS = ['items', 'responses', 'snapshots', 'perceive', 'decisions', 'critical_alerts']
  if (ENGINEERING_KEYS.some((key) => output?.[key] !== undefined && output?.[key] !== null)) return 'engineering'
  // 数据库 / 知识库类：交付的是建表与查询结果（schema / query_results / 检索或图谱结果）
  const DATABASE_KEYS = ['schema', 'query_results', 'retrieval', 'graph', 'triples']
  if (DATABASE_KEYS.some((key) => output?.[key] !== undefined && output?.[key] !== null)) return 'database'
  // 顺序有讲究：二分类的 recall/precision 比 accuracy 更能说明"这类实验在考什么"
  if (typeof metrics.recall === 'number' || typeof metrics.precision === 'number') return 'detection'

  if (Object.keys(metrics).some((key) => key.startsWith('recall_at'))) return 'retrieval'
  if (typeof metrics.accuracy === 'number') return hasTraining ? 'dl-classification' : 'classification'
  if (typeof metrics.mae === 'number' || typeof metrics.rmse === 'number') {
    return hasTraining ? 'dl-regression' : 'regression'
  }
  return 'generic'
}

/** generic 那套六步：detection / retrieval 也用它（文案本来就是通用的"摸清材料→定基线→搭实现→自测"）。 */
const GENERIC_STEPS = STEPS.generic

/**
 * 从题目包里的**声明**判断实验类型 —— 比猜 `output.json` 可靠：学生刚开工时 `output.json` 还不存在，
 * 而 `problem/manifest.json` 与 `problem/task.md` 在 claim 时就已落到工作区。
 *
 * 认两种写法（出题侧二选一即可，建议都写）：
 *  - `manifest.json` 的 `"flow": "engineering"`；
 *  - `task.md` 里的「流程归属」段落含「工程实现型」。
 *
 * 识别不出来就返回 `null` —— 交给 {@link detectKind} 按产出猜，不要瞎判。
 */
export function kindFromDeclaration(text: string | null | undefined): ExperimentKind | null {
  if (!text) return null
  // 交付物是"可执行程序"（runMode=script）→ 搭建型 agent：没有 expected、判事不判形
  if (/"runMode"\s*:\s*"script"/.test(text)) return 'agent'
  const flow = /"flow"\s*:\s*"([a-z-]+)"/.exec(text)?.[1]
  if (flow === 'engineering') return 'engineering'
  if (flow === 'database') return 'database'
  if (/流程归属/.test(text) && /工程实现型/.test(text)) return 'engineering'
  if (/流程归属/.test(text) && /(数据库|知识库)/.test(text)) return 'database'
  return null
}

/**
 * 已落盘的 kind 与工作区声明不一致时**重排步骤**（声明优先）。
 *
 * 为什么需要：老会话的 `progress.json` 是按"猜 output.json"写下的（例如被猜成 classification），
 * 于是面板一直显示"定基线 / 评估 accuracy"，与实际任务打架。声明是出题人写死的，比猜可靠。
 * `records` 与 `mode` 保留（按 stepId 存，不丢数据），`step` 归零让他从第 1 步重新确认。
 */
export function rebaseKind(state: GuideState, declared: ExperimentKind | null): GuideState {
  if (!declared || declared === state.kind) return state
  return { ...newGuideState(state.assignmentId, declared), mode: state.mode, records: state.records }
}

/**
 * 进来时工作区还没有 `output.json`（→ 只能判成 generic）；等第一份产出出现后**再认一次**类型。
 *
 * 为什么需要：学员模式的步骤在第一次 `status` 时定下来，而"工程实现型"（四环 / 状态机 / 报文 / 判定）
 * 的识别依据是 `output.json` 的键 —— 学生开工那一刻它还不存在。不加这一步，这四个实验会一直套着
 * generic 那套"定基线 → 报指标"的步骤。
 *
 * 只在**还没动过**（第 0 步、没确认、没记录）时才升级，避免把已经走到第 3 步的进度打回第 1 步。
 */
export function upgradeKind(
  state: GuideState,
  output: Record<string, unknown> | null | undefined,
): GuideState {
  if (state.kind !== 'generic') return state
  if (state.step !== 0 || state.confirmed !== 0 || Object.keys(state.records).length > 0) return state
  const detected = detectKind(output)
  if (detected === 'generic') return state
  return { ...newGuideState(state.assignmentId, detected), mode: state.mode }
}

export function stepsFor(kind: ExperimentKind): StepDef[] {
  // 默认"学员做"，最后一步（生成报告）归教练 —— 不必在 24 个步骤定义里重复写
  const table = STEPS[kind as keyof typeof STEPS] ?? GENERIC_STEPS
  return table.map((step) => ({
    ...step,
    owner: step.id === 'report' ? 'coach' : 'student',
  }))
}

/** 学员在实验开始时选的节奏（用户 2026-10-23 口径）。 */
export type StudyMode = 'auto' | 'manual'

export interface GuideState {
  assignmentId: string
  kind: ExperimentKind
  /**
   * 节奏：`manual` = 学员自己动手（默认教导口径）；`auto` = AI 带做、学员做选择与确认；
   * `null` = 还没选 —— 第一次 status 时先用 ask_user 让他选。
   */
  mode: StudyMode | null
  /** 当前第几步（0-based） */
  step: number
  /** 各步产出：键是步骤 id，值是模型记录的结构化对象 */
  records: Record<string, Record<string, unknown>>
  /** 学生已经确认到第几步（含）——`advance` 只能被确认驱动 */
  confirmed: number
  updatedAt: string
}

export function newGuideState(assignmentId: string, kind: ExperimentKind = 'generic'): GuideState {
  return {
    assignmentId,
    kind,
    mode: null,
    step: 0,
    records: {},
    confirmed: 0,
    updatedAt: new Date().toISOString(),
  }
}

/** 进度文件路径：与评估条件钉定文件同一个目录（`nju-lab/<assignmentId>/`）。 */
export function guidePath(workspaceRoot: string, assignmentId: string): string {
  return join(workspaceRoot, 'nju-lab', assignmentId, 'progress.json')
}

export async function loadGuide(
  workspaceRoot: string,
  assignmentId: string,
): Promise<GuideState | null> {
  try {
    const raw = JSON.parse(await readFile(guidePath(workspaceRoot, assignmentId), 'utf8')) as GuideState
    if (!raw || typeof raw !== 'object' || !Array.isArray(stepsFor(raw.kind))) return null
    return raw
  } catch {
    return null
  }
}

export async function saveGuide(workspaceRoot: string, state: GuideState): Promise<void> {
  const path = guidePath(workspaceRoot, state.assignmentId)
  await mkdir(join(workspaceRoot, 'nju-lab', state.assignmentId), { recursive: true })
  await writeFile(path, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
}

/** 记录某一步的产出（浅合并，便于模型分几次补）。 */
export function recordStep(
  state: GuideState,
  stepId: string,
  patch: Record<string, unknown>,
): GuideState {
  const prev = state.records[stepId] ?? {}
  return { ...state, records: { ...state.records, [stepId]: { ...prev, ...patch } } }
}

/** 推进到下一步；已在最后一步时不动（返回原状态，由调用方提示"该生成报告了"）。 */
export function advanceStep(state: GuideState): GuideState {
  const steps = stepsFor(state.kind)
  const next = Math.min(state.step + 1, steps.length - 1)
  return { ...state, step: next, confirmed: Math.max(state.confirmed, next) }
}

/** 这一步实际由谁动手：`auto` 模式下 AI 可以代做（学员负责选择/确认）；`report` 永远归 AI。 */
export function stepOwner(state: GuideState, step: StepDef): 'student' | 'coach' {
  if (step.id === 'report') return 'coach'
  return state.mode === 'auto' ? 'coach' : step.owner
}

export interface StepView {
  title: string
  /** 已推进过的步骤 */
  done: boolean
  /** 当前这一步 */
  current: boolean
  owner: 'student' | 'coach'
}

/** 六步清单（面板与工具返回都用它，保证"看到的是同一份进度"）。 */
export function stepList(state: GuideState): StepView[] {
  const steps = stepsFor(state.kind)
  return steps.map((step, index) => ({
    title: step.title,
    done: index < state.step,
    current: index === state.step,
    owner: stepOwner(state, step),
  }))
}

/** 一行一条的文本清单：`✓` 已完成、`▶` 当前、`○` 未开始。 */
export function renderStepList(state: GuideState): string {
  return stepList(state)
    .map((s, i) => {
      const mark = s.done ? '✓' : s.current ? '▶' : '○'
      const who = s.owner === 'student' ? '（学员做）' : '（AI 做）'
      return `${mark} ${i + 1}. ${s.title}${s.current ? `  ← 当前步${who}` : ''}`
    })
    .join('\n')
}

export function describeMode(mode: StudyMode | null): string {
  if (mode === 'auto') return '自动模式（我带做，你做选择与确认）'
  if (mode === 'manual') return '手动模式（你自己动手，我只讲解与检查）'
  return '还没选'
}

/** 给模型/学生看的一行摘要。 */
export function describeStep(state: GuideState): string {
  const steps = stepsFor(state.kind)
  const step = steps[state.step] ?? steps[0]
  return `第 ${state.step + 1}/${steps.length} 步 · ${step.title}`
}
