/**
 * ClaimPanel 的 host 半：把面板要的数据与操作暴露成**同源 HTTP 路由**。
 *
 * 为什么不让浏览器直接调平台？
 *  - 平台 token 只存在于 host 半，**永不进浏览器**（面板里看不到、也无法被 devtools 抠走）；
 *  - 路由挂在 Connection 的 `/api` 共享通道上，自动继承它的 Host/Origin 围栏与
 *    浏览器认证（见 dsh-client-connection 的 api-request-trust），不用自己写鉴权。
 *
 * client 半用同源 `fetch(PANEL_ROUTES.assignments)` 取数，动作走 POST。
 */
import type { Context } from '@deepseek-ai/cordis'
// 触发 cordis 的 Context 增强（`ctx.connection`），声明在 dsh-client-connection。
import type {} from '@deepseek-ai/dsh-client-connection'

import type { NjuLabActions } from './actions.ts'
import type { Assignment } from './api.ts'
import type { EvalConfig } from './config.ts'

export const PANEL_ROUTES = {
  /** GET：任务列表 + 当前钉定条件 + 落盘目录 */
  assignments: '/api/nju-lab.assignments',
  /** POST `{ assignmentId }`：领取（下载 + 校验 + 解压） */
  claim: '/api/nju-lab.claim',
  /** POST `{ assignmentId, skillDir?, note? }`：提交 */
  submit: '/api/nju-lab.submit',
} as const

/** 面板首屏需要的全部只读状态。 */
export interface PanelSnapshot {
  assignments: Assignment[]
  /** 本地已落盘材料的任务 id（云端 claimed 但换机/清理后不在此列 → 面板给「重新下载」）。 */
  downloaded: string[]
  evalConfig: EvalConfig | null
  workspaceDir: string
  /** 未配置 token 时面板应显示配置指引，而不是一个空列表 */
  tokenConfigured: boolean
  /** 当前钉定条件来自哪个任务；重启后从工作区恢复的也会带上（见 eval-state.ts）。 */
  pinnedFrom?: string
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/** 把异常转成面板能显示的一条 message，避免空 500。 */
async function guarded(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return json(await fn())
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : String(error) }, 502)
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  return body ?? {}
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`缺少参数 ${key}`)
  }
  return value
}

/** 注册面板路由。随插件 fiber 卸载自动回收。 */
export function registerPanelRoutes(
  ctx: Context,
  actions: NjuLabActions,
  options: { tokenConfigured: () => boolean },
): void {
  ctx.connection.fetch.register({
    path: PANEL_ROUTES.assignments,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) =>
      guarded(
        async (): Promise<PanelSnapshot> => {
          // 面板 tab 挂在会话上：带 sessionId 时按会话工作区判断本地材料与展示目录
          const sessionId = new URL(request.url).searchParams.get('sessionId') ?? undefined
          // 没有 token 就不去碰平台：面板要渲染的是"去配置"的指引，而不是一个 502
          const assignments = options.tokenConfigured() ? await actions.listAssignments() : []
          const materialized = await Promise.all(
            assignments.map(async (a) =>
              (await actions.isMaterialized(a.id, sessionId)) ? a.id : null,
            ),
          )
          return {
            assignments,
            downloaded: materialized.filter((id): id is string => id !== null),
            evalConfig: actions.currentEvalConfig() ?? null,
            workspaceDir: await actions.resolveRoot(sessionId),
            tokenConfigured: options.tokenConfigured(),
            pinnedFrom: actions.currentPinnedFrom(),
          }
        },
      ),
  })

  ctx.connection.fetch.register({
    path: PANEL_ROUTES.claim,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) =>
      guarded(async () => {
        const body = await readJson(request)
        return actions.claimAssignment(
          requireString(body, 'assignmentId'),
          typeof body.sessionId === 'string' ? body.sessionId : undefined,
        )
      }),
  })

  ctx.connection.fetch.register({
    path: PANEL_ROUTES.submit,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) =>
      guarded(async () => {
        const body = await readJson(request)
        return actions.submitAssignment(
          requireString(body, 'assignmentId'),
          typeof body.skillDir === 'string' ? body.skillDir : undefined,
          typeof body.note === 'string' ? body.note : undefined,
          typeof body.sessionId === 'string' ? body.sessionId : undefined,
        )
      }),
  })
}
