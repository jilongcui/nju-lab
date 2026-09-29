import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

/**
 * 平台下发的评估条件（server 侧字段，见 REQ-2026-09-21 §0.2）。
 *
 * 注意映射关系（REQ §1.3）：
 *  - `model` / `reasoningEffort` 可以用 `agent/request` waterfall 钉死
 *  - `tools` 白名单 **不能** 用 waterfall，必须用 `ctx.tools.restrict({ allow })`
 *  - `timeoutSeconds` DSH 侧无法钉，仅作展示
 */
export interface EvalConfig {
  model?: string
  reasoningEffort?: string
  /** 工具白名单（平台下发，如 ["shell"]）；由 ctx.tools.restrict 生效 */
  tools?: string[]
  /** 平台侧的运行超时；DSH 侧无法强制，仅展示 */
  timeoutSeconds?: number
}

/**
 * 插件配置（schema 解析后的**输出**形态）。
 *
 * DSH 0.1.7 起，设置页只投影 Config schema 里标了 `.volatile()` 的字段
 * （见 `@deepseek-ai/dsh-settings` 的 `volatileForm`）。volatile 字段在运行时是
 * `Volatile<T>` 稳定**引用**：用户在设置页改动后引用内的值即时更新，所以读值
 * 必须 `.get()`，不能当普通值用。据此分两类：
 *  - 要出现在设置页里的字段（serverUrl / token）→ `.volatile()`
 *  - 其余字段（evalConfig / workspaceDir）保持普通，不进设置页
 *
 * 普通对象会被 DSH 拒绝，必须用 schemastery Schema 导出同名 `Config`。
 */
export interface Config {
  /** 平台服务基址，例如 https://lab.example.edu/api */
  serverUrl: Volatile<string>
  /** 个人 token（仅本地调试用；正式版从 credentials 服务取）。 */
  token: Volatile<string | undefined>
  /** 默认评估条件；claim 下发的值优先，重启后也会从工作区恢复上次 claim 的条件。 */
  evalConfig?: EvalConfig
  /** 领取物落盘与打包产物的根目录（默认进程工作目录）。 */
  workspaceDir?: string
}

export const Config = Schema.object({
  serverUrl: Schema.string()
    .required()
    .description('平台服务基址，例如 https://lab.xiaohe.biz/api')
    .volatile(),
  token: Schema.string()
    .description(
      '平台 token：Web 端右上角头像 →「API Token」生成后粘贴到这里。留空时 nju_lab_* 工具会提示如何配置。',
    )
    .volatile(),
  evalConfig: Schema
    .any()
    .description(
      '默认评估条件：claim 下发的值优先；重启后会从工作区恢复上次 claim 的条件，一般不用改',
    ),
  workspaceDir: Schema.string().description(
    '领取物落盘与打包产物的根目录（默认进程工作目录）',
  ),
})

/**
 * 解包 volatile 引用后的普通配置。
 *
 * volatile 字段是 `Volatile<T>` 引用（`.get()` 取当前快照），而 api / panel /
 * actions 这些消费者只想要普通值。集中在这里解包，消费者一律用本类型。
 */
export interface ResolvedConfig {
  serverUrl: string
  token?: string
  evalConfig?: EvalConfig
  workspaceDir?: string
}

/**
 * 取 volatile 引用的当前值。真实 DSH 一定传 `Volatile` 引用（schema 标了
 * `.volatile()`，见 `Config`），但直接调用插件的 L1 单测会传普通值，两种形态都兼容。
 */
function unwrap<T>(value: Volatile<T> | T): T {
  const ref = value as Volatile<T> | undefined
  // `Volatile<T>.get()` 返回 `VolatileSnapshot<T>`（对象会递归展开）；本插件的两个
  // volatile 字段都是标量，快照即 T 本身，故直接断言。
  return typeof ref?.get === 'function' ? (ref.get() as T) : (value as T)
}

/** 把 schema 输出形态的配置解包成普通值（volatile → `.get()`）。 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    serverUrl: unwrap(config.serverUrl),
    token: unwrap(config.token),
    evalConfig: config.evalConfig,
    workspaceDir: config.workspaceDir,
  }
}
