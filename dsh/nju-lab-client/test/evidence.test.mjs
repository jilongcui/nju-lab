/**
 * L1：`.dshc` 证据包的导出、筛选与脱敏。
 *
 * 通过插件**行为**测（提交一次 → 读落盘的 `evidence.dshc`），而不是直接 import
 * `evidence.ts` 的私有函数 —— 顺带覆盖"提交时证据包长什么样"这条真实路径。
 *
 * 跑法：`npm test`。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

const ASSIGNMENT = 'a-unlocked'
const LONG = 'x'.repeat(500)

/** 会话事件样本：混入无关事件（message/*），以及一个带超长字段的审批事件。 */
function fakeEvents(cwd) {
  return [
    { type: 'session/header', seq: 0, time: 1000, data: { cwd } },
    { type: 'message/user', seq: 1, time: 1001, data: { text: LONG } },
    {
      type: 'approval/asked',
      seq: 2,
      time: 1002,
      data: { toolName: 'bash', input: { command: LONG } },
    },
    { type: 'approval/decided', seq: 3, time: 1003, data: { approved: true } },
    { type: 'permission/preset', seq: 4, time: 1004, data: { preset: 'workspace-write' } },
    { type: 'message/assistant', seq: 5, time: 1005, data: { text: LONG } },
  ]
}

/**
 * 假 ctx。`sessionPersistence` 提供两个会话：一个属于本工作区（应被采集），
 * 一个属于别的目录（应被跳过）。
 */
function makeHarness({ withPersistence = true } = {}) {
  const tools = []
  const read = []
  const ctx = {
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    on: () => () => {},
    connection: { fetch: { register: () => async () => {} } },
    settings: { installSection: () => {} },
  }
  ctx.inject = (_deps, callback) => {
    callback(ctx)
    return () => {}
  }
  if (withPersistence) {
    ctx.sessionPersistence = {
      async list() {
        return [
          { header: { id: 's-mine', cwd: ctx.__workspaceDir } },
          { header: { id: 's-other', cwd: '/somewhere/else' } },
        ]
      },
      async open(id) {
        read.push(id)
        return {
          async read() {
            return { eventState: {}, events: fakeEvents(id === 's-mine' ? ctx.__workspaceDir : '/somewhere/else') }
          },
          async close() {},
        }
      },
    }
  }
  return {
    ctx,
    readSessions: read,
    tool(name) {
      const found = tools.find((entry) => entry.name === name)
      assert.ok(found, `tool ${name} 未注册`)
      return found
    },
  }
}

async function submitOnce({ withPersistence = true } = {}) {
  const platform = await startMockPlatform()
  const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-evidence-'))
  const harness = makeHarness({ withPersistence })
  harness.ctx.__workspaceDir = workspaceDir

  apply(harness.ctx, { serverUrl: platform.url, token: platform.token, workspaceDir })

  // 平台侧的状态机要求先 claim 再 submit
  await harness.tool('nju_lab_claim').execute({ assignmentId: ASSIGNMENT })

  // 造一个可提交的 Skill 目录
  const skillDir = join(workspaceDir, 'nju-lab', ASSIGNMENT, 'skill')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), '# skill\n')

  await harness.tool('nju_lab_submit').execute({ assignmentId: ASSIGNMENT, skillDir })
  const capsule = JSON.parse(
    await readFile(join(workspaceDir, 'nju-lab', ASSIGNMENT, 'evidence.dshc'), 'utf8'),
  )
  return { capsule, harness, platform, workspaceDir }
}

describe('证据包 .dshc', () => {
  test('只收 approval/ 与 permission/ 事件，无关事件不进证据包', async () => {
    const { capsule, platform } = await submitOnce()
    try {
      assert.equal(capsule.format, 'nju-lab.capsule/v1')
      assert.deepEqual(
        capsule.auditEvents.map((e) => e.type),
        ['approval/asked', 'approval/decided', 'permission/preset'],
      )
      // 会话事件里的对话内容不该出现
      assert.doesNotMatch(JSON.stringify(capsule), /message\//)
    } finally {
      await platform.close()
    }
  })

  test('只采本工作目录下的会话，并登记证据来源', async () => {
    const { capsule, harness, workspaceDir, platform } = await submitOnce()
    try {
      assert.deepEqual(
        capsule.sessions.map((s) => s.id),
        ['s-mine'],
      )
      assert.equal(capsule.sessions[0].cwd, workspaceDir)
      // 别的工作目录的会话连读都没读
      assert.deepEqual(harness.readSessions, ['s-mine'])
    } finally {
      await platform.close()
    }
  })

  test('超长字段被截断（脱敏）', async () => {
    const { capsule, platform } = await submitOnce()
    try {
      const asked = capsule.auditEvents.find((e) => e.type === 'approval/asked')
      assert.equal(asked.data.input.command.length, 201, '应截断成 200 字符 + 省略号')
      assert.ok(asked.data.input.command.endsWith('…'))
      // 保留结构信息
      assert.equal(asked.data.toolName, 'bash')
    } finally {
      await platform.close()
    }
  })

  test('integrity 是 64 位十六进制，且覆盖 sessions + auditEvents', async () => {
    const { capsule, platform } = await submitOnce()
    try {
      assert.match(capsule.integrity, /^[0-9a-f]{64}$/)
      const { createHash } = await import('node:crypto')
      const expected = createHash('sha256')
        .update(JSON.stringify({ sessions: capsule.sessions, auditEvents: capsule.auditEvents }))
        .digest('hex')
      assert.equal(capsule.integrity, expected)
      assert.equal(capsule.note, undefined)
    } finally {
      await platform.close()
    }
  })

  test('没有 sessionPersistence 时提交照样成功，证据包标注降级', async () => {
    const { capsule, platform } = await submitOnce({ withPersistence: false })
    try {
      assert.deepEqual(capsule.auditEvents, [])
      assert.deepEqual(capsule.sessions, [])
      // index.ts 总会注入采集器，所以没有 sessionPersistence 时它抛错 → 走"采集失败"分支
      assert.match(capsule.note, /证据采集失败：sessionPersistence 服务不可用/)
      assert.match(capsule.integrity, /^[0-9a-f]{64}$/)
    } finally {
      await platform.close()
    }
  })
})
