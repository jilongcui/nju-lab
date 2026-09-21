import type { Context } from '@deepseek-ai/cordis'

import type { EvalConfig } from './config.ts'

/**
 * 用 `agent/request` waterfall 钉死评估条件里**能钉的部分**。
 *
 * 平台下发的 `evalConfig` 只有 `model / reasoningEffort / tools / timeoutSeconds`，其中：
 *  - 本 hook 负责 `model` 与 `reasoningEffort`
 *  - `tools` 白名单要用 `ctx.tools.restrict({ allow })`，waterfall 管不了工具集
 *  - `timeoutSeconds` DSH 侧无对应能力，仅作展示
 *
 * `reasoningEffort` 的类型是 `ReasoningEffortId` —— 一个由 provider adapter 定义的
 * opaque branded string（官方注释：no validation is performed），所以这里原样透传，
 * 不硬编码 off/low/high/max 白名单（平台当前下发的是 `medium`）。
 *
 * 挂在其上的监听器随插件卸载自动回收。
 */
export function registerConditionLock(
  ctx: Context,
  getEvalConfig: () => EvalConfig | undefined,
): void {
  ctx.on('agent/request', async (_payload, next) => {
    const base = await next()
    const e = getEvalConfig()
    if (!e) return base

    const patched: typeof base = { ...base }
    if (e.model) {
      patched.model = e.model
    }
    if (e.reasoningEffort) {
      patched.reasoningEffort = e.reasoningEffort as unknown as typeof patched.reasoningEffort
    }
    return patched
  })
}
