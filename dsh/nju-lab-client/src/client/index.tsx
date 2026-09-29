import type { Context } from '@deepseek-ai/cordis'
// 触发 client 侧 Context 增强：slots（ui-renderer）、sidebarRightTabs（sidebar-right）、
// configForms（ui-settings）。注意是 `./client` 子路径 —— 增强声明在 lib/types/client/ 下。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

import { ClaimPanel } from './ClaimPanel.tsx'
import { SettingsCard, type NjuLabSettings } from './SettingsCard.tsx'

export const name = 'nju-lab-client/client'

/**
 * 依赖的浏览器服务：
 *  - `slots`：注册 tab 内容（由 ui-renderer 提供）
 *  - `sidebarRightTabs`：注册 tab 类型（tab 两阶段注册的 stage one）
 *  - `sidebarRight`：导航控制器，自动打开本插件的 tab
 *  - `configForms`：设置卡片的命名空间读写（由 ui-settings 提供）
 *  - `sessions`：读当前选中会话 id（面板把它带给 host，让材料落到会话工作区）
 */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'configForms', 'sessions']

/**
 * 本插件在右侧栏的 tab 身份。
 *
 * `sidebar.right.pane.tab` 是**按 key 的** keyed slot：单阶段 `register({ name })`
 * 什么也渲染不出来，必须先注册一种 tab type，再用它的 `id` 作为 `key` 注册内容。
 * 写法对照官方 dsh-client-ui-sidebar-files 的 `apply`。
 */
const TAB_ID = 'nju-lab'

/**
 * 设置命名空间 = 本插件 host 半在 profile 里的**条目 id**（`cordis.patch.yml` 的
 * `id: nju-lab-client`）。DSH 0.1.7 起设置节以 profile 条目 id 标识（见 dsh-settings
 * 的 `SettingsNamespace`），不再是可自定义的字符串。client 包不能依赖 host 包，
 * 所以这里硬编码；改 profile 条目 id 时必须同步改这里。
 */
const SETTINGS_NAMESPACE = 'nju-lab-client'

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
            id: TAB_ID,
            order: 10,
            title: () => 'NJU-Lab 实验面板',
            description: () => '实验任务列表、领取、提交与钉定的评估条件',
          },
        ],
      }),
    'nju-lab-client: tab type',
  )

  // stage two：在 keyed slot 上按 key 提供内容。
  // getSessionId 读当前选中会话（面板 tab 只在该会话的视图里挂载，current 即所属会话）；
  // host 用它把领取材料/评估条件钉定落到**会话工作区**，而不是进程启动目录。
  const getSessionId = () => ctx.sessions.list.getSnapshot().current
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, () => (
          <ClaimPanel getSessionId={getSessionId} />
        )),
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

  // 设置卡片：0.1.7 里按 Host 条目的命名空间拿到 ConfigForm，注册进
  // `settings.plugins.tab`（设置 →「插件配置」页的 tab）。`whileServed` 保证只在该
  // 条目真被 Host 暴露时才注册 —— 没暴露就不会出现一个空 tab。
  const form = ctx.configForms.get<NjuLabSettings>(SETTINGS_NAMESPACE)
  ctx.effect(
    () =>
      ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
        ctx.slots.inject('settings.plugins.tab', () =>
          ctx.slots.register(
            {
              name: 'settings.plugins.tab',
              id: SETTINGS_NAMESPACE,
              order: 20,
              label: 'NJU-Lab 平台',
            },
            () => <SettingsCard form={form} />,
          ),
        ),
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
