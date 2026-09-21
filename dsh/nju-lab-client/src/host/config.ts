import Schema from '@deepseek-ai/schemastery'

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

/** 插件配置。普通对象会被 DSH 拒绝，必须用 schemastery Schema 导出同名 `Config`。 */
export interface Config {
  /** 平台服务基址，例如 https://lab.example.edu/api */
  serverUrl: string
  /** 个人 token（仅本地调试用；正式版从 credentials 服务取）。 */
  token?: string
  /** 默认评估条件；claim 下发的值优先，重启后也会从工作区恢复上次 claim 的条件。 */
  evalConfig?: EvalConfig
  /** 领取物落盘与打包产物的根目录（默认进程工作目录）。 */
  workspaceDir?: string
}

export const Config: Schema<Config> = Schema.object({
  serverUrl: Schema.string()
    .required()
    .description('平台服务基址，例如 https://lab.xiaohe.biz/api'),
  token: Schema.string().description(
    '平台 token：Web 端右上角头像 →「API Token」生成后粘贴到这里。留空时 nju_lab_* 工具会提示如何配置。',
  ),
  evalConfig: Schema
    .any()
    .description(
      '默认评估条件：claim 下发的值优先；重启后会从工作区恢复上次 claim 的条件，一般不用改',
    ),
  workspaceDir: Schema.string().description(
    '领取物落盘与打包产物的根目录（默认进程工作目录）',
  ),
})
