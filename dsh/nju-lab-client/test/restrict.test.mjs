/**
 * L1：`evalConfig.tools` 的能力名映射与 restrict 调用。
 *
 * 真环境下的效果由 L2 的 `dsh-e2e.test.mjs` 验证（它断言模型可见的工具面真的变了）；
 * 这里盯的是映射逻辑、"什么情况下**不**调用 restrict"，以及 claim 之后的补刀时序。
 *
 * 跑法：`npm test`。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

/** 假 ctx：捕获工具与 `agent/created` 监听器，并给一个 agent 的 scoped ctx。 */
function makeHarness() {
  const tools = []
  const handlers = new Map()
  /** @type {Array<{allow?: string[], deny?: string[]}>} */
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
    connection: { fetch: { register: () => async () => {} } },
    settings: { installSection: () => {} },
  }
  // 照 cordis 语义：只在该服务存在时执行回调（这里没有 systemPrompt / skills，
  // 所以引导注册被跳过 —— 与 headless 下缺 connection 是同一类情形）。
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
    /** 模拟 DSH 创建一个 agent，并记录它收到的 restrict 调用。 */
    emitAgentCreated() {
      const handler = handlers.get('agent/created')
      assert.ok(handler, 'agent/created 未被监听 —— restrict 永远不会生效')
      const scoped = {
        tools: {
          restrict(filter) {
            restricted.push(filter)
            return () => {}
          },
        },
      }
      handler({ agent: { ctx: scoped } })
    },
  }
}

async function withClient(config, fn) {
  const harness = makeHarness()
  apply(harness.ctx, {
    serverUrl: 'http://127.0.0.1:1/api',
    token: 'test-token',
    workspaceDir: await mkdtemp(join(tmpdir(), 'nju-restrict-')),
    ...config,
  })
  return fn(harness)
}

/** 临时吞掉 console.warn，返回收集到的行。 */
function captureWarnings(fn) {
  const lines = []
  const original = console.warn
  console.warn = (...args) => lines.push(args.join(' '))
  try {
    fn()
  } finally {
    console.warn = original
  }
  return lines.join('\n')
}

const PLUGIN_TOOLS = ['nju_lab_list_assignments', 'nju_lab_claim', 'nju_lab_submit']

describe('evalConfig.tools → restrict', () => {
  test('平台没给 tools 时不碰工具面', async () => {
    await withClient({}, (h) => {
      h.emitAgentCreated()
      assert.equal(h.restricted.length, 0)
    })
  })

  test('空数组同样不动（不能传空 filter，会抛 no-op）', async () => {
    await withClient({ evalConfig: { tools: [] } }, (h) => {
      h.emitAgentCreated()
      assert.equal(h.restricted.length, 0)
    })
  })

  test('shell / fs 翻成 DSH 工具名，并显式保留插件自己的工具', async () => {
    await withClient({ evalConfig: { tools: ['shell', 'fs'] } }, (h) => {
      h.emitAgentCreated()
      assert.equal(h.restricted.length, 1)
      assert.deepEqual(h.restricted[0].allow, [
        'bash', // shell
        'edit',
        'glob',
        'grep',
        'read',
        'write', // fs
        ...PLUGIN_TOOLS, // 不列进去学生就连提交都调不出来
      ])
    })
  })

  test('只给 shell 时只留 bash（+ 插件工具）', async () => {
    await withClient({ evalConfig: { tools: ['shell'] } }, (h) => {
      h.emitAgentCreated()
      assert.deepEqual(h.restricted[0].allow, ['bash', ...PLUGIN_TOOLS])
    })
  })

  test('未知能力名被忽略并显式警告（不抛错）', async () => {
    await withClient({ evalConfig: { tools: ['shell', 'quantum'] } }, (h) => {
      const warned = captureWarnings(() => h.emitAgentCreated())
      assert.match(warned, /quantum/)
      assert.match(warned, /已知能力名/)
      // 已知的那部分照常生效
      assert.deepEqual(h.restricted[0].allow, ['bash', ...PLUGIN_TOOLS])
    })
  })

  test('全是未知能力名时不调用 restrict（allow 会是空，DSH 会抛）', async () => {
    await withClient({ evalConfig: { tools: ['quantum'] } }, (h) => {
      const warned = captureWarnings(() => h.emitAgentCreated())
      assert.match(warned, /没映射出任何工具/)
      assert.equal(h.restricted.length, 0)
    })
  })

  test('每个新建 agent 各拿到一次 restrict（多个 agent 互不影响）', async () => {
    await withClient({ evalConfig: { tools: ['shell'] } }, (h) => {
      h.emitAgentCreated()
      h.emitAgentCreated()
      assert.equal(h.restricted.length, 2)
      assert.deepEqual(h.restricted[0].allow, h.restricted[1].allow)
    })
  })

  test('claim 之后补一刀：已经存在的 agent 也立刻受约束', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-restrict-claim-'))
    try {
      const harness = makeHarness()
      apply(harness.ctx, { serverUrl: platform.url, token: platform.token, workspaceDir })

      // agent 先建好 —— 此刻配置里还没有 evalConfig.tools
      harness.emitAgentCreated()
      assert.equal(harness.restricted.length, 0, 'claim 前不该动工具面')

      // claim 取回平台下发的 evalConfig（mock 给的是 tools: ['shell']）
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })

      assert.equal(harness.restricted.length, 1, 'claim 之后应立刻对已存在的 agent 补 restrict')
      assert.deepEqual(harness.restricted[0].allow, ['bash', ...PLUGIN_TOOLS])
    } finally {
      await platform.close()
    }
  })
})
