/**
 * 评估条件的**跨进程持久化**。
 *
 * 问题：`evalConfig` 原本只活在插件实例的闭包里（`actions.ts` / `index.ts` 的
 * `let evalConfig`），而 **DSH 每次启动都是新进程**。学生 claim 完关掉 DSH、下次
 * 再开，平台下发的 `model` / `reasoningEffort` / `tools` 就全丢了 —— 工具面不再
 * 收窄、模型条件不再钉死，于是"学生自测条件 ≠ 平台复验条件"，而那正是评分口径的
 * 前提。headless 更极端：每跑一条任务就是一个新进程。
 *
 * 载体：工作区里的一个 JSON 文件 `<workspace>/nju-lab/pinned-eval-config.json`。
 *  - 与领取物（`<workspace>/nju-lab/<id>/`）同处 —— 这些条件本来就绑定"这个工作区
 *    里的这次实验"，学生可见、可删，排查时不用去翻 `$DSH_HOME`；
 *  - 与 `.dshc` 证据包的归属口径一致（`evidence.ts` 也按会话的 `header.cwd` 归属项目）；
 *  - 不依赖 `ctx.storage`：DSH 的 storage-json 落在 `$DSH_HOME/storages/<域>`，语义上
 *    是设备级存储，而这里的条件属于项目。若将来需要"跨工作区共享"，再换也不难。
 *
 * 只保留**最后一次 claim** 的条件：`restrict` 与 `agent/request` 锁定都是会话级单套，
 * 存多份反而要在使用时再选，语义更糊。
 *
 * IO 用同步版本：文件只有一个、只在**启动**与 **claim** 两条路径上读写，换来的是
 * "claim 返回时条件已落盘"的因果性，以及 `apply()` 里能同步拿到恢复值（cordis 的
 * `apply` 不是异步的，启动期读到条件才能保证 `agent/created` 时就地生效）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { EvalConfig } from './config.ts'

/** 落盘文件名（相对 `<workspace>/nju-lab/`）。 */
export const PINNED_FILE = 'pinned-eval-config.json'

export interface PinnedEvalConfig {
  /** 这份条件来自哪个任务（面板展示 + 排查用）。 */
  assignmentId: string
  evalConfig: EvalConfig
  /** ISO 时间戳。 */
  claimedAt: string
}

export function pinnedEvalConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'nju-lab', PINNED_FILE)
}

/**
 * 读回上次 claim 钉下的条件。
 *
 * 文件缺失是**最常见**的情况（没 claim 过），静默返回 undefined；损坏或形状不对时
 * 警告并忽略 —— 插件必须能在任何残留状态下正常启动，绝不能因为一个状态文件起不来。
 */
export function loadPinnedEvalConfig(workspaceRoot: string): PinnedEvalConfig | undefined {
  const path = pinnedEvalConfigPath(workspaceRoot)

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PinnedEvalConfig> | null
    const evalConfig = parsed?.evalConfig
    if (typeof parsed?.assignmentId !== 'string' || typeof evalConfig !== 'object' || evalConfig === null) {
      console.warn(`[nju-lab-client] ${path} 形状不对，已忽略（评估条件不会被恢复）`)
      return undefined
    }
    return {
      assignmentId: parsed.assignmentId,
      evalConfig: evalConfig as EvalConfig,
      claimedAt: typeof parsed.claimedAt === 'string' ? parsed.claimedAt : '',
    }
  } catch (error) {
    console.warn(`[nju-lab-client] 解析 ${path} 失败，已忽略：${(error as Error).message}`)
    return undefined
  }
}

/** 写入钉定条件（同步，见文件头注释）。返回落盘内容。 */
export function savePinnedEvalConfig(
  workspaceRoot: string,
  assignmentId: string,
  evalConfig: EvalConfig,
): PinnedEvalConfig {
  const pinned: PinnedEvalConfig = {
    assignmentId,
    evalConfig,
    claimedAt: new Date().toISOString(),
  }
  const path = pinnedEvalConfigPath(workspaceRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(pinned, null, 2)}\n`, 'utf8')
  return pinned
}

/**
 * 平台这次 claim **没下发**条件 → 清掉旧的。
 *
 * 不清的话，学生上一个实验钉下的工具面会被"继承"到这次实验上：那是平台没有要求的
 * 限制，属于无故收窄（可能直接让学生做不下去）。
 */
export function clearPinnedEvalConfig(workspaceRoot: string): void {
  try {
    rmSync(pinnedEvalConfigPath(workspaceRoot), { force: true })
  } catch (error) {
    console.warn(`[nju-lab-client] 清理钉定条件失败：${(error as Error).message}`)
  }
}
