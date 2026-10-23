/**
 * 学员模式的两个工具：**步骤状态机**（`nju_lab_step`）与**实验报告生成**（`nju_lab_finalize_report`）。
 *
 * 设计（2026-10-22 用户口径）：
 *  - 整个实验围绕最后的 `report.md` 展开：一次只做一步，每步把"要做什么"讲清、
 *    把产出列出来（图用 present 声明到对话），**学生明确说"下一步"才推进**；
 *  - 最后一步自动生成报告，数字取自各 case 的 `output.json`，不让学生手抄；
 *  - 学员模式可关（`guidedMode` 配置），关掉后这两个工具仍然可用（手动推进）。
 *
 * 为什么"确认"不是硬约束：DSH 拦不住模型多说一句。可靠做法是把它写在工具返回值里
 * （"停下来等确认"），再加 `advance` 只应由学生确认触发 —— 模型每次都读得到这条指令。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { resolveSkillRoot, type NjuLabActions } from './actions.ts'
import { TOOL_NAMES } from './tools.ts'
import {
  advanceStep,
  describeMode,
  describeStep,
  detectKind,
  stepOwner,
  loadGuide,
  newGuideState,
  recordStep,
  saveGuide,
  stepsFor,
  type GuideState,
} from './guide.ts'
import { missingReportParts, renderReport, reportLooksComplete, type ReportCase } from './report.ts'

const GUIDE_TOOL_NAMES = TOOL_NAMES

const MAX_SCAN_DEPTH = 3

/** 在工作区里找 `output.json`（学生可能写在 `run_case01/`、`case01/` 或根目录）。 */
async function findOutputJson(root: string, depth = 0): Promise<Array<{ dir: string; file: string }>> {
  const found: Array<{ dir: string; file: string }> = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'output.json') {
      found.push({ dir: root, file: join(root, entry.name) })
    }
  }
  if (depth >= MAX_SCAN_DEPTH) return found
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    found.push(...(await findOutputJson(join(root, entry.name), depth + 1)))
  }
  return found
}

/** 工作区里已有的产物摘要 —— 让模型知道"这个学生做到哪了"，不必猜也不必重做。 */
async function describeWorkspace(root: string): Promise<string[]> {
  const lines: string[] = []
  const outputs = await findOutputJson(root)
  if (outputs.length) {
    const names = outputs.map((o) => basename(o.dir)).slice(0, 4)
    lines.push(`已有结果文件：${names.join('、')}（output.json）`)
  } else {
    lines.push('还没有 output.json（这一步的产出还没落盘）')
  }
  try {
    const report = await readFile(join(root, 'report.md'), 'utf8')
    lines.push(`工作区根目录有 report.md（${report.length} 字符）`)
  } catch {
    /* 没有就是没有 */
  }
  return lines
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 把过程记录里各步的 `pitfalls` 汇总成一行一条。 */
function collectPitfalls(state: GuideState | null): string[] {
  if (!state) return []
  const out: string[] = []
  for (const rec of Object.values(state.records)) {
    const raw = rec?.pitfalls
    if (typeof raw === 'string' && raw.trim()) out.push(raw.trim())
    if (Array.isArray(raw)) {
      for (const item of raw) if (typeof item === 'string' && item.trim()) out.push(item.trim())
    }
  }
  return [...new Set(out)]
}

async function renderStep(
  state: GuideState,
  root: string,
  who?: { name?: string; studentId?: string },
): Promise<string> {
  const steps = stepsFor(state.kind)
  const step = steps[state.step] ?? steps[0]
  const recorded = state.records[step.id] ?? {}
  const owner = stepOwner(state, step)
  const lines = [`【学员模式】${describeStep(state)} · ${describeMode(state.mode)}`, '']
  if (!state.mode) {
    lines.push(
      '**先让他选节奏**：用 ask_user 弹两个选项 —— 「自动模式：我带着做，你在每步做选择与确认」/「手动模式：你自己动手，我只讲解与检查」。',
      '他选完调 nju_lab_step 的 set_mode（mode=auto 或 manual），再继续。',
      '',
    )
  }
  const ownerLine =
    owner === 'student'
      ? '这一步由**学员**完成：你只讲解、给可以直接粘的命令/代码、检查他贴回来的结果。不要替他写脚本、不要替他跑命令、不要替他调参。'
      : '这一步由**你**完成：你可以代他执行（写脚本/跑命令），但每一步的关键选择要他用 ask_user 选，结果也要先给他看。'
  lines.push(ownerLine, '', `这一步要做：${step.ask}`, `完成标志：${step.need}`)
  const keys = Object.keys(recorded)
  if (keys.length) {
    lines.push('', '已记录的产出：')
    for (const key of keys) lines.push(`- ${key} = ${JSON.stringify(recorded[key])}`)
  } else {
    lines.push('', '（这一步还没有记录产出）')
  }
  if (who?.name || who?.studentId) {
    lines.push('', `正在帮：${who.name ?? '（未取到姓名）'}（学号 ${who.studentId ?? '—'}）`)
  }
  lines.push('', '学生当前情况（工作区实测）：', ...(await describeWorkspace(root)).map((l) => `- ${l}`))
  lines.push(
    '',
    '**现在就做这一步，做完停下来**：把产出列给学生看（数字写清、图用 present 声明），',
    '然后问一句"可以进下一步吗"。学生明确说继续之后，才调用 nju_lab_step(action="advance")。',
    '不要提前做下一步，也不要一次把六步全做完。',
  )
  return lines.join('\n')
}

/** 注册学员模式工具。`guided` 只影响提醒语气的强弱，工具本身始终可用。 */
export function registerGuidedTools(
  ctx: Context,
  actions: NjuLabActions,
  options: { guided: () => boolean } = { guided: () => true },
): void {
  ctx.tools.register(
    defineTool({
      name: GUIDE_TOOL_NAMES.step,
      description:
        '学员模式步骤机：status 看当前该做什么（每次开始/继续前先调它）、record 记录这一步的产出、advance 在学生明确说"下一步"后推进。',
      parameters: {
        action: {
          type: 'string',
          enum: ['status', 'record', 'advance', 'set_mode'],
          required: true,
          description: 'status 查看当前步骤 / record 记录产出 / advance 进入下一步',
        },
        assignmentId: { type: 'string', required: true, description: 'assignment id' },
        stepId: { type: 'string', description: '要记录的步骤 id；缺省为当前步' },
        record: { type: 'json', description: '这一步的产出（结构化对象，例如 { baseline_accuracy: 0.3158 }）' },
        mode: {
          type: 'string',
          enum: ['auto', 'manual'],
          description: 'set_mode 时用：auto = AI 带做、学员做选择；manual = 学员自己动手',
        },
        sessionId: { type: 'string', description: '会话 id（让进度落在会话工作区）' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
      },
      async execute(
        args: {
          action: 'status' | 'record' | 'advance' | 'set_mode'
          assignmentId: string
          stepId?: string
          record?: unknown
          mode?: 'auto' | 'manual'
          sessionId?: string
        },
      ) {
        const root = await actions.resolveRoot(args.sessionId)
        const who = await actions.whoAmI()
        let state = await loadGuide(root, args.assignmentId)
        if (!state) {
          // 第一次进来：按当前工作区里的 output.json 猜实验类型（没有就 generic）
          const outputs = await findOutputJson(root)
          const first = outputs.length ? await readJson(outputs[0].file) : null
          state = newGuideState(args.assignmentId, detectKind(first))
        }

        if (args.action === 'set_mode') {
          const mode = args.mode === 'auto' || args.mode === 'manual' ? args.mode : null
          if (!mode) return 'mode 只能是 "auto" 或 "manual"。'
          state = { ...state, mode }
          await saveGuide(root, state)
          return [`已记录节奏：${describeMode(mode)}。`, '', await renderStep(state, root, who)].join('\n')
        }

        if (args.action === 'record') {
          const stepId = args.stepId ?? stepsFor(state.kind)[state.step].id
          const patch =
            args.record && typeof args.record === 'object' && !Array.isArray(args.record)
              ? (args.record as Record<string, unknown>)
              : { value: args.record }
          state = recordStep(state, stepId, patch)
          await saveGuide(root, state)
          return [`已记录「${stepId}」的产出。`, '', await renderStep(state, root, who)].join('\n')
        }

        if (args.action === 'advance') {
          const before = state.step
          state = advanceStep(state)
          await saveGuide(root, state)
          const moved = state.step !== before
          return [
            moved ? `已进入下一步（${describeStep(state)}）。` : '已经是最后一步：该生成实验报告了。',
            '',
            await renderStep(state, root, who),
          ].join('\n')
        }

        // status 也要落盘一次：首次访问就把状态建起来，面板与后续调用才有进度可读
        await saveGuide(root, state)
        return [
          await renderStep(state, root, who),
          ...(options.guided()
            ? []
            : ['', '（学员模式已在设置里关闭：你可以自由安排顺序，需要时再调本工具。）']),
        ].join('\n')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: GUIDE_TOOL_NAMES.report,
      description:
        '按模板生成实验报告 report.md：数字取自各 case 的 output.json（不手抄），图片用相对路径嵌入；生成后 present 给学生确认，再提交。',
      parameters: {
        assignmentId: { type: 'string', required: true, description: 'assignment id' },
        skillDir: { type: 'string', description: 'Skill 目录（缺省为领取目录下的 skill/）' },
        title: { type: 'string', description: '实验标题（写在报告第一行）' },
        thresholds: {
          type: 'json',
          description: '达标线，例如 { accuracy: 0.9, macroF1: 0.85 } 或 { maeRatio: 0.8 }',
        },
        pitfalls: {
          type: 'array',
          items: { type: 'string' },
          description: '踩坑记录（从与学生的一问一答里收集，每条一行；不传则用步骤记录里的）',
        },
        conclusion: { type: 'string', description: '结论（≥20 字）；不传则用 output.json 的 notes' },
        baselineNote: { type: 'string', description: '基线做法的一句话说明' },
        sessionId: { type: 'string', description: '会话 id（让报告落在会话工作区）' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
      },
      async execute(args: {
        assignmentId: string
        skillDir?: string
        title?: string
        thresholds?: { accuracy?: number; macroF1?: number; maeRatio?: number }
        pitfalls?: string[]
        conclusion?: string
        baselineNote?: string
        sessionId?: string
      }) {
        const root = await actions.resolveRoot(args.sessionId)
        const guide = await loadGuide(root, args.assignmentId)
        const outputs = await findOutputJson(root)
        if (!outputs.length) {
          return [
            '没找到 output.json —— 先按步骤把结果跑出来（写在工作目录下），再生成报告。',
            '如果你把结果写在了别的目录，告诉我路径。',
          ].join('\n')
        }
        const cases: ReportCase[] = []
        for (const entry of outputs.sort((a, b) => a.file.localeCompare(b.file))) {
          cases.push({ name: basename(entry.dir), output: await readJson(entry.file) })
        }
        const kind = detectKind(cases[0]?.output)

        const skillDir = args.skillDir ?? join(root, 'nju-lab', args.assignmentId, 'skill')
        const skillRoot = await resolveSkillRoot(skillDir)

        const who = await actions.whoAmI()
        const markdown = renderReport({
          title: args.title ?? '实验报告',
          student: who,
          kind,
          cases,
          pitfalls: args.pitfalls?.length ? args.pitfalls : collectPitfalls(guide),
          conclusion: args.conclusion,
          thresholds: args.thresholds,
          baselineNote: args.baselineNote,
        })
        const target = join(skillRoot, 'report.md')
        await mkdir(skillRoot, { recursive: true })
        await writeFile(target, markdown, 'utf8')

        const missing = missingReportParts(markdown)
        return [
          `已生成实验报告：${target}`,
          `数据来源：${cases.map((c) => `${c.name}${c.output ? '' : '(未读到)'}`).join('、')}`,
          reportLooksComplete(markdown)
            ? '报告按平台口径是齐全的（自测时间 + 两个 case 的数字 + 踩坑记录）。'
            : `还缺：${missing.join('、')} —— 补完再提交才有过程分。`,
          '',
          '下一步：把 report.md 与产出图 present 给学生看，确认无误后再调用 nju_lab_submit。',
        ].join('\n')
      },
    }),
  )
}
