import type { Context } from '@deepseek-ai/cordis'
// 触发 client 侧 Context 增强：slots（ui-renderer）、sidebarRightTabs（sidebar-right）。
// 注意是 `./client` 子路径 —— 这两个增强声明在 lib/types/client/ 下，不在主入口。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

import { ClaimPanel } from './ClaimPanel.tsx'

export const name = 'nju-lab-client/client'

/**
 * 依赖的浏览器服务：
 *  - `slots`：注册 tab 内容（由 ui-renderer 提供）
 *  - `sidebarRightTabs`：注册 tab 类型（tab 两阶段注册的 stage one）
 */
export const inject = ['slots', 'sidebarRightTabs']

/**
 * 本插件在右侧栏的 tab 身份。
 *
 * `sidebar.right.pane.tab` 是**按 key 的** keyed slot：单阶段 `register({ name })`
 * 什么也渲染不出来，必须先注册一种 tab type，再用它的 `id` 作为 `key` 注册内容。
 * 写法对照官方 dsh-client-ui-sidebar-files 的 `apply`。
 */
const TAB_ID = 'nju-lab'

/** tab 标题座位（`sidebar.right.pane.tab.title`）的内容。 */
function ClaimTitle() {
  return <span>NJU-Lab</span>
}

export function apply(ctx: Context): void {
  // stage one：声明一种 tab 类型。省略 `patterns` 即 "page type" —— 它不认领资源
  // 地址，而是按 `kind` 被打开。
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_ID,
        title: () => 'NJU-Lab',
      }),
    'nju-lab-client: tab type',
  )

  // stage two：在 keyed slot 上按 key 提供内容。
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, ClaimPanel),
      ),
    'nju-lab-client: tab body',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, ClaimTitle),
      ),
    'nju-lab-client: tab title',
  )
}
