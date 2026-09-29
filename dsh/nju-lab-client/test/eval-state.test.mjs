/**
 * L1：评估条件的**跨进程持久化**（`src/host/eval-state.ts`）。
 *
 * 两段：
 *  1. 文件面：claim 写盘 / 没 claim 过时不写 / 损坏或形状不对时容错 / 平台未下发条件时清旧值；
 *  2. 行为面：模拟 "DSH 重启" —— 同一工作区上第二次 `apply()` 必须把上次 claim 的条件
 *     恢复回来，并且**真的作用到新 agent 的工具面**（`agent.ctx.tools.restrict` 收到 allow），
 *     同时验证优先级（平台条件 > 配置默认）与回落（没有钉定文件时用配置默认）。
 *
 * 真进程级的证据由 L2 用例给（`test/dsh-e2e.test.mjs` 的"重启后仍受约束"）。
 *
 * 跑法：`npm test`。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

const ASSIGNMENT = 'a-unlocked'
const ROUTE_ASSIGNMENTS = '/api/nju-lab.assignments'

const pinnedPath = (workspaceDir) => join(workspaceDir, 'nju-lab', 'pinned-eval-config.json')

/** 假 ctx：捕获工具 / 事件 / 面板路由，并给一个可观察 `restrict` 的 agent scoped ctx。 */
function makeHarness() {
  const tools = []
  const handlers = new Map()
  const routes = new Map()
  const restricted = []
  const ctx = {
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    on(event, handler) {
      handlers.set(event, handler)
      return () => {}
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return async () => {}
        },
      },
    },
    settings: { configure: () => () => {} }, effect: (callback) => { callback(); return () => {} },
  }
  // 照 cordis 语义：只在该服务存在时执行回调（这里没有 systemPrompt / skills）。
  ctx.inject = (deps, callback) => {
    if (deps.every((dep) => ctx[dep] !== undefined)) callback(ctx)
    return () => {}
  }

  return {
    ctx,
    restricted,
    tool(name) {
      const found = tools.find((entry) => entry.name === name)
      assert.ok(found, `tool ${name} 未注册`)
      return found
    },
    /** 创建 agent（触发 `agent/created`），返回它收到的 restrict filter。 */
    createAgent() {
      const handler = handlers.get('agent/created')
      assert.ok(handler, 'agent/created 未注册')
      handler({
        agent: {
          ctx: {
            tools: {
              restrict(filter) {
                restricted.push(filter)
                return () => {}
              },
            },
          },
        },
      })
      return restricted[restricted.length - 1]
    },
    /** 面板首屏快照（真实走 host 路由，所以也能验证 pinnedFrom 的透出）。 */
    async snapshot() {
      const route = routes.get(ROUTE_ASSIGNMENTS)
      assert.ok(route, '面板路由未注册')
      const res = await route.fetch(new Request(`http://127.0.0.1${ROUTE_ASSIGNMENTS}`))
      return res.json()
    },
  }
}

/** 起插件（等价于一次 DSH 进程）。 */
function boot(platform, workspaceDir, config = {}) {
  const harness = makeHarness()
  apply(harness.ctx, {
    serverUrl: platform.url,
    token: platform.token,
    workspaceDir,
    ...config,
  })
  return harness
}

async function workspace() {
  return mkdtemp(join(tmpdir(), 'nju-state-'))
}

/** 直接往工作区塞一份钉定文件（覆盖"文件已存在但内容不对"的边界场景）。 */
async function seedPinned(workspaceDir, content) {
  await mkdir(join(workspaceDir, 'nju-lab'), { recursive: true })
  await writeFile(pinnedPath(workspaceDir), content)
}

describe('钉定条件落盘', () => {
  test('claim 后写进工作区，内容含来源任务与条件', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await workspace()
    try {
      const harness = boot(platform, workspaceDir)
      await harness.tool('nju_lab_claim').execute({ assignmentId: ASSIGNMENT })

      assert.ok(existsSync(pinnedPath(workspaceDir)), '应生成 pinned-eval-config.json')
      const pinned = JSON.parse(await readFile(pinnedPath(workspaceDir), 'utf8'))
      assert.equal(pinned.assignmentId, ASSIGNMENT)
      assert.equal(pinned.evalConfig.model, 'deepseek-flash')
      assert.deepEqual(pinned.evalConfig.tools, ['shell'])
      assert.match(pinned.claimedAt, /^\d{4}-\d{2}-\d{2}T/)
    } finally {
      await platform.close()
    }
  })

  test('没 claim 过时没有文件，面板也不显示来源', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await workspace()
    try {
      const harness = boot(platform, workspaceDir)
      assert.equal(existsSync(pinnedPath(workspaceDir)), false)
      const snap = await harness.snapshot()
      assert.equal(snap.evalConfig, null)
      assert.equal(snap.pinnedFrom, undefined)
    } finally {
      await platform.close()
    }
  })

  test('平台这次没下发条件 → 清掉旧值，避免上个实验的限制被继承', async () => {
    const workspaceDir = await workspace()
    // 先有一次"有条件的 claim"（用默认 mock）
    const withConfig = await startMockPlatform()
    try {
      const first = boot(withConfig, workspaceDir)
      await first.tool('nju_lab_claim').execute({ assignmentId: ASSIGNMENT })
      assert.ok(existsSync(pinnedPath(workspaceDir)))
    } finally {
      await withConfig.close()
    }

    // 再模拟"平台没下发条件"的那次 claim
    const withoutConfig = await startMockPlatform({ evalConfig: null })
    try {
      const second = boot(withoutConfig, workspaceDir)
      await second.tool('nju_lab_claim').execute({ assignmentId: ASSIGNMENT })
      assert.equal(existsSync(pinnedPath(workspaceDir)), false, '旧条件应被清掉')
      assert.equal((await second.snapshot()).evalConfig, null)
    } finally {
      await withoutConfig.close()
    }
  })
})

describe('钉定条件恢复（模拟重启：新 ctx、新 apply）', () => {
  test('损坏的 JSON 不抛错，按"没有条件"处理', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await workspace()
    try {
      await seedPinned(workspaceDir, '{ this is not json')
      const harness = boot(platform, workspaceDir)
      assert.equal((await harness.snapshot()).evalConfig, null)
    } finally {
      await platform.close()
    }
  })

  test('形状不对（缺 assignmentId / evalConfig 不是对象）时按"没有条件"处理', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await workspace()
    try {
      await seedPinned(
        workspaceDir,
        JSON.stringify({ assignmentId: 42, evalConfig: 'nope' }),
      )
      const harness = boot(platform, workspaceDir)
      const snap = await harness.snapshot()
      assert.equal(snap.evalConfig, null)
      assert.equal(snap.pinnedFrom, undefined)
    } finally {
      await platform.close()
    }
  })

  test('重启后条件仍在，并作用到新 agent 的工具面', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await workspace()
    try {
      // 第一个"进程"：claim
      const first = boot(platform, workspaceDir)
      await first.tool('nju_lab_claim').execute({ assignmentId: ASSIGNMENT })
      assert.ok(
        first.createAgent().allow.includes('bash'),
        'claim 之后本会话内的工具面就该被收窄',
      )

      // 第二个"进程"：新 ctx、新 apply，同一个工作区，配置里没有 evalConfig
      const second = boot(platform, workspaceDir)
      const allow = second.createAgent().allow
      assert.ok(allow.includes('bash'), `恢复后 bash 应在白名单里，实际 ${allow.join(',')}`)
      assert.ok(allow.includes('nju_lab_submit'), '插件自己的工具必须一起放行，否则学生没法提交')
      assert.ok(
        !allow.includes('web_fetch'),
        '平台没允许的工具应仍然被收窄掉（说明条件真的恢复了，不是没生效）',
      )

      const snap = await second.snapshot()
      assert.equal(snap.evalConfig?.model, 'deepseek-flash')
      assert.equal(snap.pinnedFrom, ASSIGNMENT, '面板应显示条件来自哪个任务')
    } finally {
      await platform.close()
    }
  })

  test('恢复的条件优先于配置里的默认值', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await workspace()
    try {
      const first = boot(platform, workspaceDir)
      await first.tool('nju_lab_claim').execute({ assignmentId: ASSIGNMENT })

      const second = boot(platform, workspaceDir, { evalConfig: { model: 'from-config' } })
      assert.equal(
        (await second.snapshot()).evalConfig?.model,
        'deepseek-flash',
        '平台下发的条件比静态默认更权威',
      )
    } finally {
      await platform.close()
    }
  })

  test('没有钉定文件时回落到配置里的默认值', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await workspace()
    try {
      const harness = boot(platform, workspaceDir, {
        evalConfig: { model: 'from-config', tools: ['shell'] },
      })
      assert.equal((await harness.snapshot()).evalConfig?.model, 'from-config')
      assert.equal(harness.createAgent().allow.includes('bash'), true)
    } finally {
      await platform.close()
    }
  })
})
