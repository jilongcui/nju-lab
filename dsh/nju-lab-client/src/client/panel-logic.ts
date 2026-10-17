/**
 * 面板的纯判定逻辑：**列哪些任务**、**打开面板时自动下发哪些材料**。
 *
 * 单独成文件而不是塞在 `ClaimPanel.tsx` 里，是为了能被 L1 测试直接 import
 * （见 `test/panel-logic.test.mjs`）—— 组件本身要真浏览器才渲染得出来，但这两条
 * 判定恰恰是"面板看起来对不对"的全部。
 *
 * 两条口径（2026-10-18，用户明确）：
 *  1. **只列已领取**：未领取的实验不进列表。一个学生身上可能有十几个待领取任务，
 *     全列出来面板就变成一张任务清单，"我正在做哪几个"反而被埋掉。
 *  2. **打开面板即材料化**：状态已是 claimed/submitted 但本地工作区没有材料的任务，
 *     面板一挂载就自动下发一次（平台对这两态的 claim 是幂等重发，不改状态、
 *     不动提交记录）。学生从平台领完实验、进 DSH 就已在环境里，不必再点一次。
 */

/** 判定需要的最小字段集：`Assignment`（host api.ts）天然满足。 */
export interface PanelAssignmentLike {
  id: string
  status: string
  unlocked: boolean
}

/** 未领取 = 平台侧 pending；claimed / submitted 都算"已领取"（学生已经在做/交过）。 */
export function isClaimed(assignment: PanelAssignmentLike): boolean {
  return assignment.status !== 'pending'
}

/** 面板列表：只保留已领取（含已提交）的任务，保持平台返回的顺序。 */
export function visibleAssignments<T extends PanelAssignmentLike>(
  assignments: readonly T[],
): T[] {
  return assignments.filter(isClaimed)
}

/** 未领取的任务数 —— 列表里不展示，但底部要能说明"还有几个没领"。 */
export function pendingCount(assignments: readonly PanelAssignmentLike[]): number {
  return assignments.filter((assignment) => !isClaimed(assignment)).length
}

/**
 * 本次挂载要自动下发材料的任务。
 *
 * 四个条件同时成立：
 *  - 已领取（含已提交）—— 未领取的绝不能自动领：那等于替学生做决定；
 *  - `unlocked` —— 平台侧解锁条件仍成立（理论上 claimed 都已解锁，防御性判断）；
 *  - 本地没有材料 —— `downloaded` 来自 host 半对工作区目录的实测，换机/清理后会缺席；
 *  - 本次挂载还没自动试过 —— 失败要退回手动「重新下载」，不能在网络抖动时无限重试。
 */
export function pendingAutoMaterialize<T extends PanelAssignmentLike>(
  assignments: readonly T[],
  downloaded: readonly string[],
  tried: ReadonlySet<string>,
): T[] {
  const local = new Set(downloaded)
  return assignments.filter(
    (assignment) =>
      isClaimed(assignment) && assignment.unlocked && !local.has(assignment.id) && !tried.has(assignment.id),
  )
}
