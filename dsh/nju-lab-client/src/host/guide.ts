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
const STEPS: Record<ExperimentKind, Array<Omit<StepDef, 'owner'>>> = {
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
  if (typeof metrics.accuracy === 'number') return hasTraining ? 'dl-classification' : 'classification'
  if (typeof metrics.mae === 'number') return hasTraining ? 'dl-regression' : 'regression'
  return 'generic'
}

export function stepsFor(kind: ExperimentKind): StepDef[] {
  // 默认"学员做"，最后一步（生成报告）归教练 —— 不必在 24 个步骤定义里重复写
  return (STEPS[kind] ?? STEPS.generic).map((step) => ({
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
