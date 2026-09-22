import type { Context } from '@deepseek-ai/cordis'
// 触发 client 侧 Context 增强：slots（ui-renderer）、sidebarRightTabs（sidebar-right）、
// settingsScope（ui-settings）。注意是 `./client` 子路径 —— 增强声明在 lib/types/client/ 下。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

import { ClaimPanel } from './ClaimPanel.tsx'
import { SettingsCard, type NjuLabSettings } from './SettingsCard.tsx'

export const name = 'nju-lab-client/client'

/**
 * 依赖的浏览器服务：
 *  - `slots`：注册 tab 内容（由 ui-renderer 提供）
 *  - `sidebarRightTabs`：注册 tab 类型（tab 两阶段注册的 stage one）
 *  - `sidebarRight`：导航控制器，自动打开本插件的 tab
 *  - `settingsScope`：设置卡片的命名空间读写（由 ui-settings 提供）
 */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'settingsScope']

/**
 * 本插件在右侧栏的 tab 身份。
 *
 * `sidebar.right.pane.tab` 是**按 key 的** keyed slot：单阶段 `register({ name })`
 * 什么也渲染不出来，必须先注册一种 tab type，再用它的 `id` 作为 `key` 注册内容。
 * 写法对照官方 dsh-client-ui-sidebar-files 的 `apply`。
 */
const TAB_ID = 'nju-lab'
const SETTINGS_NS = 'nju-lab'

/** tab 标题座位（`sidebar.right.pane.tab.title`）的内容。 */
function ClaimTitle() {
  return <span>NJU-Lab</span>
}

export function apply(ctx: Context): void {
  // stage one：声明一种 tab 类型。省略 `patterns` 即 "page type" —— 它不认领资源
  // 地址，而是按 `kind` 被打开。`guide` 让它出现在引导页的入口列表里（省略则
  // 不上引导页，用户将无法自行发现这个 tab）。
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_ID,
        title: () => 'NJU-Lab',
        guide: [
          {
            order: 10,
            title: () => 'NJU-Lab 实验面板',
            description: () => '实验任务列表、领取、提交与钉定的评估条件',
          },
        ],
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

  // 设置卡片：Host 半 installSection 只喂命名空间，卡片要 client 半自己注册。
  // scope 的 disposer 挂在调用方（本插件）fiber 上，随插件卸载。
  const scope = ctx.settingsScope.bind<NjuLabSettings>({ namespace: SETTINGS_NS })
  ctx.effect(
    () =>
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register({ name: 'settings.plugin.item', key: SETTINGS_NS }, () => (
          <SettingsCard scope={scope} />
        )),
      ),
    'nju-lab-client: settings card',
  )

  // 自动打开 tab：右栏停靠面每个会话一份、刷新后回到折叠态，且只在选中会话时
  // 才挂载席位；席位未挂载时 openTab 抛错，所以轮询到首次成功为止。
  // （官方没有"会话选中"事件可订阅，这是 cookbook 之外的最小可靠做法。）
  let opened = false
  const timer = setInterval(() => {
    if (opened) return
    try {
      ctx.sidebarRight.openTab(TAB_ID)
      opened = true
    } catch {
      // 会话面还没挂载，下一轮再试
    }
  }, 2000)
  ctx.effect(() => () => clearInterval(timer), 'nju-lab-client: auto-open tab')
}
