/**
 * NJU-Lab 平台工具（对话式入口）。
 *
 * 这里是**渲染层**：把 `actions.ts` 的结构化结果转成给模型看的文本。
 * 业务逻辑（下载/校验/解压/打包/上传/提交）全在 actions.ts，与 ClaimPanel 的
 * host 路由共用一份，避免两边漂移。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { ClaimOutcome, NjuLabActions, SubmitOutcome } from './actions.ts'

/**
 * 三个工具的名字（单一来源）。
 *
 * `restrict.ts` 也要用：`tools.restrict()` 是"**只保留** allow 里的"，而插件工具
 * 注册在插件根 —— 对 agent 来说是**祖先层**（不是它自己的层），所以一样会被收窄。
 * 不显式列进去，学生领完任务连提交都调不出来。
 */
export const TOOL_NAMES = {
  list: 'nju_lab_list_assignments',
  claim: 'nju_lab_claim',
  submit: 'nju_lab_submit',
} as const

/** 渲染领取下载结果；未绑定的文件也显式说明，避免模型误以为漏了。 */
function renderArtifacts(outcome: ClaimOutcome): string[] {
  const lines = outcome.artifacts.map(
    (a) => `- ${a.label}: ${a.path} (${a.bytes} bytes, sha256 校验通过)`,
  )
  const got = new Set(outcome.artifacts.map((a) => a.label))
  for (const label of ['skillTemplate', 'testDataset'] as const) {
    if (!got.has(label)) lines.push(`- ${label}: (平台未绑定)`)
  }
  return lines
}

function renderClaim(outcome: ClaimOutcome): string {
  const lines = [`claimed ${outcome.assignmentId}`, ...renderArtifacts(outcome)]
  if (outcome.skillRoot) {
    lines.push(`- Skill 根: ${outcome.skillRoot}`)
    if (outcome.skillRoot !== outcome.skillDir) {
      lines.push(
        `  （模板自带一层顶层目录。学生要改的是这个目录；提交时传 ${outcome.skillDir} 或它下面的 Skill 目录都能识别）`,
      )
    }
  }
  if (outcome.unzipError) {
    lines.push(`- 模板解压失败（ZIP 已下载，可手动处理）：${outcome.unzipError}`)
  }
  const e = outcome.evalConfig
  lines.push(
    `conditions: model=${e?.model ?? '(default)'} reasoningEffort=${e?.reasoningEffort ?? '(default)'}` +
      ` tools=[${(e?.tools ?? []).join(', ')}] timeoutSeconds=${e?.timeoutSeconds ?? '(none)'}`,
  )
  return lines.join('\n')
}

function renderSubmit(outcome: SubmitOutcome, note?: string): string {
  return [
    `submitted ${outcome.assignmentId}`,
    `- Skill 根: ${outcome.skillRoot}`,
    `- 文件数: ${outcome.fileCount}，ZIP: ${outcome.zipPath}`,
    `- skillZip: file:${outcome.skillZip.fileId} sha256=${outcome.skillZip.sha256}`,
    `- capsule: file:${outcome.capsule.fileId} sha256=${outcome.capsule.sha256}`,
    `- submission: id=${outcome.submission.id} status=${outcome.submission.status}`,
    ...(note ? [`- note: ${note}`] : []),
  ].join('\n')
}

/** 注册三个平台工具：列出任务、领取（含真实下载）、提交。 */
export function registerTools(ctx: Context, actions: NjuLabActions): void {
  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.list,
      description: 'List my NJU-Lab assignments with their unlock status and latest submission.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
      },
      async execute() {
        const list = await actions.listAssignments()
        if (!list.length) return '(no assignments)'
        return list
          .map((a) => {
            const parts = [
              `${a.unlocked ? '[unlocked]' : '[locked]'} ${a.id} (${a.status})`,
              a.project?.title ?? '(untitled)',
            ]
            if (a.project?.chapterTitle) parts.push(`chapter=${a.project.chapterTitle}`)
            if (a.project?.deadline) parts.push(`deadline=${a.project.deadline}`)
            if (a.submission) parts.push(`submission=${a.submission.status}`)
            return parts.join(' — ')
          })
          .join('\n')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.claim,
      description:
        'Claim an assignment: downloads the Skill template and test dataset into the workspace, verifies sha256, and pins the evaluation conditions.',
      parameters: {
        assignmentId: { type: 'string', required: true, description: 'assignment id' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
      },
      async execute(args: { assignmentId: string }, exec) {
        // 会话工作区优先：材料落在调用方 agent 的 cwd，而不是进程启动目录
        return renderClaim(await actions.claimAssignment(args.assignmentId, exec?.agent?.id))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.submit,
      description:
        'Submit a Skill directory as an assignment: hashes every file, packs a ZIP, builds the .dshc capsule, uploads both, then submits.',
      parameters: {
        assignmentId: { type: 'string', required: true, description: 'assignment id' },
        skillDir: { type: 'string', required: true, description: 'local Skill directory to submit' },
        note: { type: 'string', description: 'optional note shown in the result' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
      },
      async execute(args: { assignmentId: string; skillDir: string; note?: string }, exec) {
        const outcome = await actions.submitAssignment(
          args.assignmentId,
          args.skillDir,
          args.note,
          exec?.agent?.id,
        )
        return renderSubmit(outcome, args.note)
      },
    }),
  )
}
