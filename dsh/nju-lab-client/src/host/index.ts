import type { Context } from '@deepseek-ai/cordis'
// 触发 cordis 的 Context 增强（`ctx.settings`），声明在 dsh-settings。
import type {} from '@deepseek-ai/dsh-settings'
// Events（`agent/created`）与 payload.agent 的增强声明。
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { resolve } from 'node:path'

import { PlatformApi } from './api.ts'
import { createActions } from './actions.ts'
import { Config, type EvalConfig } from './config.ts'
import { loadPinnedEvalConfig } from './eval-state.ts'
import { collectEvidence } from './evidence.ts'
import { registerGuidance } from './guidance.ts'
import { registerConditionLock } from './lock.ts'
import { registerPanelRoutes } from './panel.ts'
import { registerToolRestriction } from './restrict.ts'
import { registerTools } from './tools.ts'

export const name = 'nju-lab-client'
/**
 * 只硬依赖 `tools`（注册平台工具）。
 *
 * **不能**把 `connection` / `settings` 写进 inject：headless profile 两者都没有，
 * 硬依赖会让插件在 headless 下整个不加载（cordis 的 `cannot get property … without
 * inject` 是访问即抛错，不能靠运行时探测绕过）。这类"有就增强"的服务一律用
 * `ctx.inject([...], cb)`。
 */
export const inject = ['tools']
export { Config }

/** settings 命名空间（lowercase hyphenated identifier）。 */
const SETTINGS_NS = 'nju-lab'

/**
 * host 半入口：平台 API + 评估条件锁定 + 平台工具（+ 有 web server 时的面板路由）。
 *
 * 配置有两个来源，settings 层的用户值优先于 `cordis.patch.yml` 的 composition 层：
 *  1. composition：profile 的 patch（我们现在从 `NJU_LAB_SERVER_URL` / `NJU_LAB_TOKEN` 取）
 *  2. 用户设置：DSH 设置页里填的 `nju-lab` 节（`ctx.settings.installSection`）
 *
 * client 半（UI）在 src/client/index.tsx，由 client-modules 服务按
 * package.json 的 dsh.client 声明单独扫描挂载。
 */
export function apply(ctx: Context, config: Config): void {
  // 启动时先看工作区里有没有上次 claim 钉下的条件（跨进程恢复，见 `eval-state.ts`）。
  // 它**优先于**配置里的默认值 —— 与"claim 覆盖默认"的既有语义一致：平台针对本学生
  // 下发的条件比静态默认更权威；否则学生一重启就退回默认，跨进程持久化就没意义了。
  const workspaceRoot = resolve(config.workspaceDir ?? process.cwd())
  const pinned = loadPinnedEvalConfig(workspaceRoot)
  let evalConfig: EvalConfig | undefined = pinned?.evalConfig ?? config.evalConfig
  if (pinned) {
    console.log(
      `[nju-lab-client] 恢复上次 claim 的评估条件（任务 ${pinned.assignmentId}${
        pinned.claimedAt ? `，claim 于 ${pinned.claimedAt}` : ''
      }）`,
    )
  }

  /** 解析后的权威配置：settings 服务在场时由它接管，否则就是 composition 的 config。 */
  let readConfig: () => Config = () => config

  ctx.inject(['settings'], (settingsCtx) => {
    // 把本插件的 Config schema 暴露成设置页可填的一节。用户层的值会覆盖 base；
    // 未填时回落到 composition 层（即 patch 里的环境变量默认值）。
    // owner 传外层 ctx（不是 settingsCtx）：它的 Unload 决定这一节的 fallback 何时停止。
    settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
      setSource: (source) => {
        readConfig = source
      },
      // 读值走 `readConfig()`，每次都取最新，所以这里无需额外动作。
      onChange: () => {},
    })
  })

  // 按会话工作区恢复钉定：材料与 pinned 文件跟随会话 cwd 之后，"启动时从进程目录
  // 恢复"覆盖不到"在 A 目录启动、在 UI 里选 B 工作区"的情形。agent 创建时按它
  // 自己的 cwd 找 pinned-eval-config.json，找到就接管（经 onEvalConfig 收窄工具面）。
  // 注意注册在 registerToolRestriction **之前**（见该函数的注册顺序说明）。
  ctx.on('agent/created', ({ agent }) => {
    void (async () => {
      const cwd = await resolveSessionCwd(agent.id)
      if (cwd && actions.restorePinnedFor(cwd)) {
        console.log(`[nju-lab-client] 按会话工作区恢复评估条件（${cwd}）`)
      }
    })()
  })

  // 先装限制器：claim 之后要把它作用到已存在的 agent（`applyToLiveAgents`）。
  // 它的 agent/created 监听器必须注册在**本插件其它同名监听器之后**：上面的恢复
  // 监听器先行，这里最后注册 —— cordis 全部照序触发；而单槽事件捕获的测试
  // harness 只会看到最后注册的那个（restrict 的），行为断言才不会落空。
  const restriction = registerToolRestriction(ctx, () => evalConfig)

  /** 会话持久化服务：用来导出 `.dshc` 的过程证据，并解析会话工作区（headless 下可能不存在）。 */
  let persistence: SessionPersistence | undefined
  ctx.inject(['sessionPersistence'], (scoped) => {
    persistence = scoped.sessionPersistence
  })

  /** 由 sessionId 解析会话工作区；服务缺席或会话不存在时返回 undefined（调用方回落启动目录）。 */
  const resolveSessionCwd = async (sessionId: string): Promise<string | undefined> => {
    if (!persistence) return undefined
    const snapshots = await persistence.list().catch(() => [])
    return snapshots.find((s) => s.header.id === sessionId)?.header.cwd
  }

  const api = new PlatformApi(() => readConfig())
  const actions = createActions(api, {
    workspaceDir: config.workspaceDir,
    resolveSessionCwd,
    initialEvalConfig: evalConfig,
    initialPinnedFrom: pinned?.assignmentId,
    onEvalConfig: (next) => {
      evalConfig = next
      // claim 拿到了平台下发的条件 → 对当前会话的 agent 立刻收窄工具面。
      // 否则学生得先开新会话才受约束，而 REQ §2.2 要的是 claim **之后**的请求就受限。
      restriction.applyToLiveAgents()
    },
    // 证据包：导出本项目工作目录下各会话的审计事件。失败不阻断提交（见 actions.ts）。
    collectEvidence: async (root) => {
      if (!persistence) throw new Error('sessionPersistence 服务不可用')
      return collectEvidence(persistence, root)
    },
  })

  registerConditionLock(ctx, () => evalConfig)
  registerTools(ctx, actions)

  // 模型引导（HANDOFF 第 5 步）：常驻的 system prompt 段 + 可按需加载的 skill。
  // 两者都走 ctx.inject 软依赖，缺 systemPrompt / skills 时静默跳过。
  registerGuidance(ctx)

  // 面板路由挂在 Connection 的 /api 通道上；headless（无 web server）没有这个服务。
  ctx.inject(['connection'], (scoped) => {
    registerPanelRoutes(scoped, actions, {
      tokenConfigured: () => Boolean(readConfig().token),
    })
  })

  console.log(`[nju-lab-client] host half loaded (serverUrl=${config.serverUrl})`)
}
