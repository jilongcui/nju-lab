/**
 * 把平台下发的**能力名**翻译成 DSH 的工具白名单，并在每个 agent 上钉死。
 *
 * 为什么不直接把 `evalConfig.tools` 喂给 `ctx.tools.restrict()`：
 *
 * 1. 平台发的是**抽象能力名**（`shell` / `fs`），不是 DSH 的工具名。DSH 里叫
 *    `bash`、`read`、`write`…，直接传 `"shell"` 会抛 `names unknown global tool`。
 *    平台不该知道 DSH 内部把 shell 工具叫什么（那会随 DSH 版本变），所以翻译放这里。
 * 2. `restrict({ allow })` 是**白名单**（只保留列出的），所以翻译必须完整 ——
 *    漏一个能力名就等于把学生对应的工具全禁掉。
 *
 * 三条已核实的硬约束（`dsh-tools/lib/index.js` 的 `restrict()` 与 `view()`）：
 *  - 只能在 **scoped context**（`agent.ctx`）上调用，插件根 ctx 会抛
 *    `requires a scoped context`。这里用 `agent/created` 的 `payload.agent` ——
 *    事件的 `this` 是 `Scoped<Agent>`，它**故意不暴露属性**（只作 scope carrier），
 *    官方注释："Event payloads carry the real subject"。
 *  - 空 filter（`{}`）会抛。所以映射结果为空时**不调用**，只警告。
 *  - `restrict` 过滤的是"**该 scope 继承来的层**"（全局 + 祖先层），**只有 agent
 *    自己那层豁免**。插件工具注册在插件根 = 祖先层，所以**照样会被收窄**，必须
 *    显式列进 `allow`（它们属于 inherited，在 `restrictableNames` 里，能合法列出）。
 */
import type { Context } from '@deepseek-ai/cordis'
// 触发 cordis 增强：Events（`agent/created` / `agent/disposed`）与 `Agent.ctx`
// 来自 dsh-agent，`Context.tools` 来自 dsh-tools。
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'

import type { EvalConfig } from './config.ts'
import { TOOL_NAMES } from './tools.ts'

/**
 * 平台能力名 → DSH 全局工具名。
 *
 * 平台侧的取值见 `experiment_projects.evalConfig.tools`（当前示例：`["shell", "fs"]`）。
 * 与**服务端复验容器**必须保持同一份映射，否则"学生自测条件 ≠ 复验条件"。
 */
export const CAPABILITY_TOOLS: Readonly<Record<string, readonly string[]>> = {
  shell: ['bash'],
  fs: ['read', 'write', 'edit', 'glob', 'grep'],
}

/** 把能力名列表翻成去重排序后的工具名，并单列出未知能力名。 */
export function toolsForCapabilities(capabilities: readonly string[]): {
  tools: string[]
  unknown: string[]
} {
  const tools = new Set<string>()
  const unknown: string[] = []
  for (const name of capabilities) {
    const mapped = CAPABILITY_TOOLS[name]
    if (!mapped) {
      unknown.push(name)
      continue
    }
    for (const tool of mapped) tools.add(tool)
  }
  return { tools: [...tools].sort(), unknown }
}

export interface ToolRestriction {
  /**
   * 对当前已存在的 agent 重新应用一次限制。
   *
   * 需要它是因为**时序**：`evalConfig` 通常在 `nju_lab_claim` 之后才有，而那时
   * agent 早就创建完了。只在 `agent/created` 收窄的话，学生在同一个会话里
   * claim 完，工具面根本不会变 —— 而 REQ-2026-09-21 §2.2 要的正是"claim **之后**
   * 后续模型请求"就受限。
   */
  applyToLiveAgents(): void
}

/**
 * 在每个 agent 创建时按当前 `evalConfig.tools` 收窄工具面，并支持事后补一刀。
 *
 * 监听器随插件卸载自动回收；`getEvalConfig` 每次现读。
 */
export function registerToolRestriction(
  ctx: Context,
  getEvalConfig: () => EvalConfig | undefined,
): ToolRestriction {
  /** 已创建的 agent：restrict 只能在这些 agent 自己的 ctx 上调用。 */
  const live = new Set<Agent>()

  const applyTo = (agent: Agent): void => {
    const capabilities = getEvalConfig()?.tools
    if (!capabilities?.length) return // 平台没给白名单 → 不动工具面

    const { tools, unknown } = toolsForCapabilities(capabilities)
    if (unknown.length) {
      // 未知能力名按"更严格"处理：不映射 → 学生看不到它们对应的工具。
      // 但这多半是平台加了新能力名而插件没跟上，所以要显式叫出来。
      console.warn(
        `[nju-lab-client] evalConfig.tools 含未知能力名 ${unknown.map((n) => `"${n}"`).join(', ')}，` +
          `已忽略（对应工具不会对学生开放）。已知能力名：${Object.keys(CAPABILITY_TOOLS).join(', ')}`,
      )
    }
    if (!tools.length) {
      // 空 allow 会抛 "is a no-op"；此时不 restrict 更安全。
      console.warn(
        `[nju-lab-client] evalConfig.tools=${JSON.stringify(capabilities)} 没映射出任何工具，跳过 restrict`,
      )
      return
    }

    // 插件自己的三个工具必须一起列进 allow：`allow` 语义是"只保留"，而这些工具
    // 注册在插件根 —— 对 agent 来说是**祖先层**，同样会被收窄（只有 agent 自己那层
    // 才豁免）。它们在 `restrictableNames`（inherited 层都算）里，所以能合法列出。
    const allow = [...tools, ...Object.values(TOOL_NAMES)]

    // 必须经 **agent 的 scoped ctx**：对插件根 ctx 调用会抛 "requires a scoped context"。
    agent.ctx.tools.restrict({ allow })
  }

  ctx.on('agent/created', ({ agent }) => {
    live.add(agent)
    applyTo(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    live.delete(agent)
  })

  return {
    applyToLiveAgents() {
      for (const agent of live) applyTo(agent)
    },
  }
}
