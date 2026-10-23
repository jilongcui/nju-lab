/**
 * 实验报告（`report.md`）生成器。
 *
 * 学员模式的最后一步用：数字不是让学生手抄，而是**从各 case 的 `output.json` 直接取**
 * （那是复验也读的同一份数据），图片用相对路径嵌进报告，踩坑记录来自过程中的对话。
 *
 * 只有纯函数（无 IO），便于 L1 直接断言输出形状。
 */
import type { ExperimentKind } from './guide.ts'

export interface ReportCase {
  /** 目录名，例如 case01 / run_case01 */
  name: string
  /** 该 case 的 output.json 内容；读不到时为 null（报告里标"未找到"而不是崩） */
  output: Record<string, unknown> | null
}

export interface ReportThresholds {
  /** 分类达标线 */
  accuracy?: number
  macroF1?: number
  /** 回归：MAE / 基线的上限 */
  maeRatio?: number
}

export interface ReportInput {
  title: string
  /** 学生身份（姓名 / 学号）—— 来自平台 `GET /me`，写进报告头部。 */
  student?: { name?: string; studentId?: string }
  kind: ExperimentKind
  cases: ReportCase[]
  /** 踩坑记录（每条一行；来自过程记录或模型在 finalize 时补） */
  pitfalls: string[]
  /** 结论；缺省时回落到最后一个 case 的 notes */
  conclusion?: string
  thresholds?: ReportThresholds
  /** 生成时间（ISO）；缺省用当前时间 */
  generatedAt?: string
  /** 自测方式：本地 DSH 或平台工作台 */
  mode?: string
  /** 基线做法的一句话说明（模型可从题目包读出后传入） */
  baselineNote?: string
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const fmt = (value: number | undefined, digits = 4): string =>
  value === undefined ? '—' : String(Number(value.toFixed(digits)))

const pct = (value: number | undefined): string =>
  value === undefined ? '—' : `${(value * 100).toFixed(1)}%`

/** 取某个 case 的 metrics / baseline / training 摘要。 */
function summarize(c: ReportCase) {
  const out = c.output ?? {}
  const metrics = (out.metrics ?? {}) as Record<string, unknown>
  const baseline = (out.baseline ?? {}) as Record<string, unknown>
  const training = (out.training ?? {}) as Record<string, unknown>
  const history = Array.isArray(training.history) ? (training.history as unknown[]) : []
  const lastLoss = history.length
    ? num((history[history.length - 1] as Record<string, unknown>)?.loss)
    : undefined
  return {
    output: out,
    accuracy: num(metrics.accuracy),
    macroF1: num(metrics.macro_f1),
    mae: num(metrics.mae),
    r2: num(metrics.r2),
    baselineAccuracy: num(baseline.accuracy),
    baselineMae: num(baseline.mae),
    lastLoss,
    figures: Array.isArray(out.figures) ? (out.figures as Array<Record<string, unknown>>) : [],
    notes: typeof out.notes === 'string' ? out.notes : '',
    model: typeof out.model === 'string' ? out.model : '',
  }
}

/** 表格列按实验类型定制（与模板 report.md 的列一致）。 */
function tableHeader(kind: ExperimentKind, t: ReportThresholds): string[] {
  const accLine = t.accuracy !== undefined || t.macroF1 !== undefined
    ? `≥${fmt(t.accuracy, 2)} / ≥${fmt(t.macroF1, 2)}`
    : '按任务要求'
  const maeLine = t.maeRatio !== undefined ? `≤${fmt(t.maeRatio, 2)}` : '按任务要求'
  switch (kind) {
    case 'classification':
      return ['case', 'accuracy', 'macro F1', `是否达标（${accLine}）`]
    case 'dl-classification':
      return ['case', 'accuracy', 'macro F1', '最后一轮损失', `是否达标（${accLine}）`]
    case 'regression':
      return ['case', 'MAE', '基线 MAE', 'MAE / 基线', `是否达标（${maeLine}）`]
    case 'dl-regression':
      return ['case', 'MAE', '基线 MAE', 'MAE / 基线', '最后一轮损失', `是否达标（${maeLine}）`]
    case 'detection':
      return ['case', 'recall', 'precision', 'accuracy', `是否达标（${accLine}）`]
    case 'retrieval':
      // 检索类指标名不固定（recall_at_3_* 等）→ 列在渲染时按 case 的实际键动态取
      return ['case', '检索指标']
    default:
      return ['case', '指标']
  }
}

/** 单行数据：缺的字段写 `—`，不编数字。 */
function tableRow(c: ReportCase, kind: ExperimentKind, t: ReportThresholds): string[] {
  const s = summarize(c)
  const ratio = s.mae !== undefined && s.baselineMae ? s.mae / s.baselineMae : undefined
  const accOk =
    t.accuracy !== undefined && s.accuracy !== undefined ? s.accuracy >= t.accuracy : undefined
  const f1Ok =
    t.macroF1 !== undefined && s.macroF1 !== undefined ? s.macroF1 >= t.macroF1 : undefined
  const ratioOk = t.maeRatio !== undefined && ratio !== undefined ? ratio <= t.maeRatio : undefined
  const verdict = (ok: boolean | undefined): string => (ok === undefined ? '—' : ok ? '达标' : '未达标')

  switch (kind) {
    case 'classification':
      return [c.name, fmt(s.accuracy), fmt(s.macroF1), verdict(accOk === false || f1Ok === false ? false : accOk && f1Ok)]
    case 'dl-classification':
      return [c.name, fmt(s.accuracy), fmt(s.macroF1), fmt(s.lastLoss), verdict(accOk === false || f1Ok === false ? false : accOk && f1Ok)]
    case 'regression':
      return [c.name, fmt(s.mae), fmt(s.baselineMae), fmt(ratio, 2), verdict(ratioOk)]
    case 'dl-regression':
      return [c.name, fmt(s.mae), fmt(s.baselineMae), fmt(ratio, 2), fmt(s.lastLoss), verdict(ratioOk)]
    case 'detection': {
      const recall = num((s.output.metrics as Record<string, unknown> | undefined)?.recall)
      const precision = num((s.output.metrics as Record<string, unknown> | undefined)?.precision)
      return [c.name, fmt(recall), fmt(precision), fmt(s.accuracy), verdict(undefined)]
    }
    case 'retrieval': {
      const metrics = (s.output.metrics ?? {}) as Record<string, unknown>
      const shown = Object.entries(metrics)
        .filter(([k, v]) => k.startsWith('recall_at') && typeof v === 'number')
        .map(([k, v]) => `${k}=${fmt(num(v))}`)
      return [c.name, shown.length ? shown.join('，') : '未找到 output.json']
    }
    default: {
      const metrics = (s.output.metrics ?? {}) as Record<string, unknown>
      const shown = Object.entries(metrics)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `${k}=${fmt(num(v))}`)
      return [c.name, shown.length ? shown.join('，') : '未找到 output.json']
    }
  }
}

/** 渲染 `report.md`。返回的文本只含确定信息：读不到的字段写 `—`，不猜。 */
export function renderReport(input: ReportInput): string {
  const t = input.thresholds ?? {}
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const header = tableHeader(input.kind, t)
  const rows = input.cases.map((c) => tableRow(c, input.kind, t))

  const table = [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ]

  const summaries = input.cases.map(summarize)
  const first = summaries[0]
  const baselineAccuracy = first?.baselineAccuracy
  const baselineMae = first?.baselineMae
  const baselineLine = input.baselineNote
    ?? (baselineAccuracy !== undefined
      ? `不建模、一律报最多的类别（基线 accuracy ≈ ${fmt(baselineAccuracy)}）`
      : baselineMae !== undefined
        ? `不建模、一律报平均（基线 MAE ≈ ${fmt(baselineMae)}）`
        : '（未记录）')

  const gainLines: string[] = []
  for (const c of input.cases) {
    const s = summarize(c)
    if (s.accuracy !== undefined && s.baselineAccuracy !== undefined) {
      gainLines.push(`- ${c.name}：accuracy ${fmt(s.accuracy)} vs 基线 ${fmt(s.baselineAccuracy)}（${pct(s.accuracy - s.baselineAccuracy)} 个百分点）`)
    } else if (s.mae !== undefined && s.baselineMae) {
      gainLines.push(`- ${c.name}：MAE ${fmt(s.mae)} vs 基线 ${fmt(s.baselineMae)}（比值 ${fmt(s.mae / s.baselineMae, 2)}）`)
    }
  }

  const figureLines: string[] = []
  input.cases.forEach((c) => {
    for (const [i, f] of summarize(c).figures.entries()) {
      const path = typeof f.path === 'string' ? f.path : ''
      const takeaway = typeof f.takeaway === 'string' ? f.takeaway : ''
      if (!path) continue
      figureLines.push(
        `- ${c.name} 图 ${i + 1}：\`${path}\`` + (takeaway ? ` —— ${takeaway}` : ''),
        '',
        `  ![${c.name} 图 ${i + 1}](${path})`,
        '',
      )
    }
  })

  const pitfalls = input.pitfalls.length
    ? input.pitfalls.map((p, i) => `${i + 1}. ${p}`)
    : ['1. （过程中没有记录踩坑 —— 补一条真实的再来交）']

  const conclusion =
    input.conclusion?.trim()
    || summaries.map((s) => s.notes).find((n) => n.trim())
    || '（还没写结论：说说与基线比提升多少、难点在哪一类）'

  return [
    `# 实验报告：${input.title}`,
    '',
    `> 由平台按 \`output.json\` 与过程记录自动生成（${generatedAt.slice(0, 10)}）。数字取自运行结果，不要手改。`,
    '',
    '## 1. 自测概况',
    '',
    `- 学生姓名：${input.student?.name?.trim() || '（未取到）'}`,
    `- 学号：${input.student?.studentId?.trim() || '（未取到）'}`,
    `- 实验名称：${input.title}`,
    `- 自测时间：${generatedAt.slice(0, 10)}`,
    `- 自测方式：${input.mode ?? '（本地 DSH / 平台工作台）'}`,
    `- 模型：${first?.model || '（未记录）'}`,
    '',
    '## 2. 各 case 的结果',
    '',
    ...table,
    '',
    '## 3. 基线对照',
    '',
    `- 基线做法：${baselineLine}`,
    ...gainLines,
    '',
    '## 4. 踩坑记录（每条一行，平台按行计数）',
    '',
    ...pitfalls,
    '',
    '## 5. 结论',
    '',
    conclusion,
    '',
    ...(figureLines.length ? ['## 6. 产出图', '', ...figureLines] : []),
    '',
  ].join('\n')
}

/** 报告是否"齐全"（与平台判据同口径：自测时间 + case 行有数字 + 踩坑 ≥1）。 */
export function reportLooksComplete(markdown: string): boolean {
  const hasSelfTest = /自测时间[：:][ \t]*\S/.test(markdown)
  const caseRowFilled = (n: number): boolean => {
    const line = markdown
      .split('\n')
      .find((l) => new RegExp(`case\\s*0?${n}`, 'i').test(l))
    if (!line) return false
    return line.split('|').slice(1).slice(2).some((cell) => /\d/.test(cell))
  }
  const pitfalls = /##[^\n]*踩坑记录[^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(markdown)?.[1] ?? ''
  const pitfallCount = pitfalls
    .split('\n')
    .filter((l) => /^\s*(?:[-*]|\d+\.)\s*\S/.test(l) && !l.includes('TODO') && !l.includes('补一条真实')).length
  return hasSelfTest && caseRowFilled(1) && caseRowFilled(2) && pitfallCount >= 1
}

/** 报告里还缺什么（给模型/学生看的提示）。 */
export function missingReportParts(markdown: string): string[] {
  const missing: string[] = []
  if (!/自测时间[：:][ \t]*\S/.test(markdown)) missing.push('自测时间')
  const filled = (n: number): boolean => {
    const line = markdown.split('\n').find((l) => new RegExp(`case\\s*0?${n}`, 'i').test(l))
    return !!line && line.split('|').slice(1).slice(2).some((cell) => /\d/.test(cell))
  }
  if (!filled(1) || !filled(2)) missing.push('两个 case 的指标数字')
  if (markdown.includes('补一条真实')) missing.push('踩坑记录（至少一条真实的）')
  return missing
}
