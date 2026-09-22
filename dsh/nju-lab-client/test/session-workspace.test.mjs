/**
 * L1：领取材料与评估条件钉定**跟随会话工作区**，而不是进程启动目录。
 *
 * 背景：学生常在任意目录（~/Downloads）启动 dsh，而项目语义都绑在 UI 里选的
 * 会话工作区上。两条路径都要验证：
 *  1. 工具调用带 `exec.agent.id` → 材料与 pinned 文件落到该会话的 cwd；
 *  2. agent 创建时按自己的 cwd 找回 pinned 条件并收窄工具面（跨进程恢复）。
 *
 * 跑法：`npm test`。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

const run = promisify(execFile)

/** 假 ctx：捕获工具与全部 `agent/created` 监听器（照 cordis 多监听器语义）。 */
function makeHarness(sessionCwd) {
  const tools = []
  const createdHandlers = []
  /** @type {Array<{allow?: string[]}>} */
  const restricted = []
  const ctx = {
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    on(event, handler) {
      if (event === 'agent/created') createdHandlers.push(handler)
      return () => {}
    },
    sessionPersistence: {
      list: async () => [{ header: { id: 'sess-1', cwd: sessionCwd } }],
    },
  }
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
    /** 模拟 DSH 创建 agent：所有监听器都触发（恢复 + restrict），并记录 restrict。 */
    async emitAgentCreated() {
      assert.ok(createdHandlers.length >= 2, 'agent/created 应有恢复与 restrict 两个监听器')
      const scoped = {
        tools: {
          restrict(filter) {
            restricted.push(filter)
            return () => {}
          },
        },
      }
      for (const handler of createdHandlers) handler({ agent: { id: 'sess-1', ctx: scoped } })
      // 恢复监听器是 async 的（resolveSessionCwd → restorePinnedFor），等它落定
      await new Promise((resolve) => setTimeout(resolve, 20))
    },
  }
}

/** 造一个内容真实的模板 ZIP（含 SKILL.md）。 */
async function makeTemplateZip() {
  const dir = await mkdtemp(join(tmpdir(), 'nju-tpl-'))
  await writeFile(join(dir, 'SKILL.md'), '# 模板 Skill\n')
  const zipPath = join(dir, 'template.zip')
  await run('zip', ['-q', '-r', zipPath, '.'], { cwd: dir })
  return readFile(zipPath)
}

describe('会话工作区落盘（材料与钉定跟随 session cwd）', () => {
  test('claim 落到调用方会话的 cwd，agent 创建时按 cwd 恢复钉定', async () => {
    const platform = await startMockPlatform({ skillTemplate: await makeTemplateZip() })
    const sessionCwd = await mkdtemp(join(tmpdir(), 'nju-sess-'))
    try {
      const harness = makeHarness(sessionCwd)
      apply(harness.ctx, {
        serverUrl: platform.url,
        token: platform.token,
        // 故意不配 workspaceDir：根解析必须走"会话工作区 → 进程启动目录"
      })

      const out = await harness
        .tool('nju_lab_claim')
        .execute({ assignmentId: 'a-unlocked' }, { agent: { id: 'sess-1' } })

      assert.ok(
        out.includes(join(sessionCwd, 'nju-lab', 'a-unlocked')),
        `材料应落到会话工作区，实际输出：${out}`,
      )
      // 模板解压 + 钉定文件都在会话工作区
      await readFile(join(sessionCwd, 'nju-lab', 'a-unlocked', 'skill', 'SKILL.md'), 'utf8')
      const pinned = JSON.parse(
        await readFile(join(sessionCwd, 'nju-lab', 'pinned-eval-config.json'), 'utf8'),
      )
      assert.equal(pinned.assignmentId, 'a-unlocked')

      // 新 agent（模拟重启后的新进程语义）：按自己的 cwd 找回条件并收窄工具面。
      // restrict 可能收到两次（创建时一次 + 恢复后 applyToLiveAgents 补一刀，幂等）。
      await harness.emitAgentCreated()
      assert.ok(harness.restricted.length >= 1, '恢复后应对新 agent restrict')
      const lastAllow = harness.restricted.at(-1)?.allow ?? []
      assert.ok(lastAllow.includes('bash'))
      assert.ok(lastAllow.includes('nju_lab_claim'), '插件工具必须保留')
    } finally {
      await platform.close()
    }
  })
})
