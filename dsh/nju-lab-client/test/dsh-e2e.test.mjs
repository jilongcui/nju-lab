/**
 * L2：在真 DSH 里端到端验证插件。
 *
 * 不需要模型 key —— 用 `./fake-llm.mjs` 顶替模型端点，用 `./mock-platform.mjs`
 * 顶替平台。跑的是真的 `dsh --profile headless`，所以验证的是真实调用链：
 *
 *   fake LLM → DSH → nju-lab-client 的工具 → mock 平台
 *
 * 跑法：
 *   npm run test:e2e                       # 用 PATH 里的 dsh
 *   DSH_BIN=/path/to/dsh npm run test:e2e  # 指定 dsh 可执行文件
 *
 * 找不到 dsh 时会 skip（并说明原因），而不是抛一个难懂的 spawn ENOENT。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { startFakeLlm } from './fake-llm.mjs'
import { startMockPlatform } from './mock-platform.mjs'

const run = promisify(execFile)
const PLUGIN_ENTRY = fileURLToPath(new URL('../lib/host/index.js', import.meta.url))
const FINAL_TEXT = '已找到 2 个实验任务，其中 1 个已解锁。'
const INSTALL_HINT =
  'no dsh found — set DSH_BIN=/path/to/dsh, or install one: npm i -g @deepseek-ai/dsh@0.1.5-rc.2'

/** 解析 dsh：`DSH_BIN` 优先，其次 PATH。 */
function resolveDsh() {
  const explicit = process.env.DSH_BIN?.trim()
  if (explicit) {
    return existsSync(explicit)
      ? { cmd: explicit }
      : { skip: `DSH_BIN=${explicit} does not exist on this machine` }
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, 'dsh')
    if (existsSync(candidate)) return { cmd: candidate }
  }
  return { skip: INSTALL_HINT }
}

const dsh = resolveDsh()

test(
  'L2: DSH loads the plugin, advertises its tools, and the tool reaches the platform',
  { timeout: 180_000, skip: dsh.skip ?? false },
  async () => {
    const platform = await startMockPlatform()
    const llm = await startFakeLlm({ finalText: FINAL_TEXT })
    const home = await mkdtemp(join(tmpdir(), 'nju-e2e-'))

    try {
      // 把插件与假模型端点一起塞进 headless profile
      const overlay = join(home, 'overlay.yml')
      await writeFile(
        overlay,
        [
          '- insert:',
          '    - id: nju-lab-client',
          `      name: '${PLUGIN_ENTRY}'`,
          '      config:',
          `        serverUrl: '${platform.url}'`,
          `        token: '${platform.token}'`,
          '- id: llm-deepseek',
          '  config:',
          `    baseURL: '${llm.url}'`,
          "    apiKeyEnv: 'NJU_TEST_API_KEY'",
          '',
        ].join('\n'),
      )

      const { stdout } = await run(
        dsh.cmd,
        ['--profile', 'headless', '--patch', overlay, '列出我的实验任务'],
        {
          timeout: 150_000,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, DSH_HOME: home, NJU_TEST_API_KEY: 'test' },
        },
      )

      // 1) 插件被 DSH 加载
      assert.match(stdout, /\[nju-lab-client\] host half loaded/)

      // 2) 插件的工具进入模型可见的工具面
      const dialogCalls = llm.calls.filter(
        (call) => Array.isArray(call.body?.tools) && call.body.tools.length > 0,
      )
      assert.ok(dialogCalls.length > 0, 'no dialog request ever reached the model')
      const advertised = dialogCalls[0].body.tools.map((t) => t?.function?.name ?? t?.name)
      assert.ok(
        advertised.includes('nju_lab_list_assignments'),
        `nju_lab_list_assignments was not advertised; got: ${advertised.join(', ')}`,
      )
      assert.ok(advertised.includes('nju_lab_claim'), 'nju_lab_claim was not advertised')

      // 3) 工具真的执行了，并打通到平台，且带着插件配置里的 token
      const listRequest = platform.requests.find((r) => r.path === '/me/assignments')
      assert.ok(listRequest, 'the platform never received GET /me/assignments')
      assert.equal(listRequest.method, 'GET')
      assert.equal(listRequest.auth, `Bearer ${platform.token}`)

      // 4) 工具结果回传给模型，最终回答被打印
      const followUp = llm.calls.find((call) =>
        (call.body?.messages ?? []).some((m) => m.role === 'tool'),
      )
      assert.ok(followUp, 'the tool result was never sent back to the model')
      assert.match(stdout, new RegExp(FINAL_TEXT))
    } finally {
      await llm.close()
      await platform.close()
    }
  },
)

test(
  'L2: evalConfig.tools 收窄模型可见的工具面（能力名 → DSH 工具名）',
  { timeout: 180_000, skip: dsh.skip ?? false },
  async () => {
    const platform = await startMockPlatform()
    const llm = await startFakeLlm({ finalText: 'ok' })
    const home = await mkdtemp(join(tmpdir(), 'nju-e2e-tools-'))

    try {
      // 直接在配置里给一份 evalConfig（等价于 claim 之后的状态），这样 agent 一创建
      // 就带着条件，不需要先跑一轮 claim。
      const overlay = join(home, 'overlay.yml')
      await writeFile(
        overlay,
        [
          '- insert:',
          '    - id: nju-lab-client',
          `      name: '${PLUGIN_ENTRY}'`,
          '      config:',
          `        serverUrl: '${platform.url}'`,
          `        token: '${platform.token}'`,
          '        evalConfig:',
          '          tools:',
          '            - shell',
          '            - fs',
          '- id: llm-deepseek',
          '  config:',
          `    baseURL: '${llm.url}'`,
          "    apiKeyEnv: 'NJU_TEST_API_KEY'",
          '',
        ].join('\n'),
      )

      await run(dsh.cmd, ['--profile', 'headless', '--patch', overlay, '你好'], {
        timeout: 150_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, DSH_HOME: home, NJU_TEST_API_KEY: 'test' },
      })

      const dialogCalls = llm.calls.filter(
        (call) => Array.isArray(call.body?.tools) && call.body.tools.length > 0,
      )
      assert.ok(dialogCalls.length > 0, 'no dialog request ever reached the model')
      const advertised = dialogCalls[0].body.tools.map((t) => t?.function?.name ?? t?.name)

      // a) 能力名被翻成了真实的 DSH 工具名（证明 restrict 接受了这些名字，没有抛错）
      for (const name of ['bash', 'read', 'write', 'edit', 'glob', 'grep']) {
        assert.ok(advertised.includes(name), `${name} 应被允许（来自 shell / fs 能力）`)
      }
      // b) 白名单之外的全局工具被真的收窄掉了
      for (const name of ['web_fetch', 'web_search', 'subagent', 'todo_write']) {
        assert.ok(!advertised.includes(name), `${name} 应被 evalConfig.tools 收窄掉`)
      }
      // c) scoped 注册的插件工具不受 restrict 影响（否则学生连提交都调不了）
      for (const name of ['nju_lab_list_assignments', 'nju_lab_claim', 'nju_lab_submit']) {
        assert.ok(advertised.includes(name), `${name} 是 scoped 注册，不该被收窄`)
      }
      // d) 平台用的抽象能力名不该原样出现在工具面上
      assert.ok(!advertised.includes('shell'), '"shell" 不是 DSH 工具名')
      assert.ok(!advertised.includes('fs'), '"fs" 不是 DSH 工具名')
    } finally {
      await llm.close()
      await platform.close()
    }
  },
)

test(
  'L2: claim 之后同一个会话里的后续请求就受约束（不必等下次会话）',
  { timeout: 180_000, skip: dsh.skip ?? false },
  async () => {
    // 首次让模型去 claim；claim 会带回平台下发的 evalConfig（mock 的默认值已与
    // 真实平台对齐：model 是 deepseek-official 支持的 `deepseek-flash`，且不带
    // reasoningEffort —— 带上会让 DSH 直接抛 UNSUPPORTED_REASONING_EFFORT）。
    const platform = await startMockPlatform()
    const llm = await startFakeLlm({
      toolName: 'nju_lab_claim',
      toolArguments: JSON.stringify({ assignmentId: 'a-unlocked' }),
      finalText: 'ok',
    })
    const home = await mkdtemp(join(tmpdir(), 'nju-e2e-claim-'))

    try {
      const overlay = join(home, 'overlay.yml')
      await writeFile(
        overlay,
        [
          '- insert:',
          '    - id: nju-lab-client',
          `      name: '${PLUGIN_ENTRY}'`,
          '      config:',
          `        serverUrl: '${platform.url}'`,
          `        token: '${platform.token}'`,
          '- id: llm-deepseek',
          '  config:',
          `    baseURL: '${llm.url}'`,
          "    apiKeyEnv: 'NJU_TEST_API_KEY'",
          '',
        ].join('\n'),
      )

      await run(dsh.cmd, ['--profile', 'headless', '--patch', overlay, '领取实验任务'], {
        timeout: 150_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, DSH_HOME: home, NJU_TEST_API_KEY: 'test' },
      })

      const dialogCalls = llm.calls.filter(
        (call) => Array.isArray(call.body?.tools) && call.body.tools.length > 0,
      )
      assert.ok(dialogCalls.length >= 2, `应有 claim 前/后两次带工具的请求，实际 ${dialogCalls.length}`)
      const namesOf = (call) => call.body.tools.map((t) => t?.function?.name ?? t?.name)
      const before = namesOf(dialogCalls[0])
      const after = namesOf(dialogCalls[dialogCalls.length - 1])

      // claim 之前：平台条件还没到手，工具面是完整的
      assert.ok(before.includes('web_fetch'), `claim 前不该被收窄，实际：${before.join(', ')}`)
      assert.ok(before.includes('bash'), 'claim 前也应有 bash')

      // claim 之后：立刻按平台下发的 tools: ['shell'] 收窄
      assert.ok(after.includes('bash'), 'bash 应保留（shell 能力）')
      for (const name of ['nju_lab_list_assignments', 'nju_lab_claim', 'nju_lab_submit']) {
        assert.ok(after.includes(name), `${name} 应保留（插件自己的工具）`)
      }
      for (const name of ['web_fetch', 'web_search', 'subagent', 'write']) {
        assert.ok(!after.includes(name), `${name} 应在 claim 之后被收窄掉`)
      }
    } finally {
      await llm.close()
      await platform.close()
    }
  },
)

test(
  'L2: submit 把本会话的审计证据导出进 .dshc（真 sessionPersistence）',
  { timeout: 180_000, skip: dsh.skip ?? false },
  async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-e2e-dshc-'))
    const skillDir = join(workspaceDir, 'nju-lab', 'a-unlocked', 'skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '# 学生的 Skill\n')

    // 先起模型替身：它要在 finally 里关闭，不能等到断言之后才创建 ——
    // 断言失败会让 finally 撞上 TDZ，mock 平台泄漏，测试进程挂住不退出。
    const llm = await startFakeLlm({
      toolName: 'nju_lab_submit',
      toolArguments: JSON.stringify({ assignmentId: 'a-unlocked', skillDir }),
      finalText: 'ok',
    })

    // 平台状态机要求先 claim —— 直接用平台 API 领掉，省一轮对话
    const claimed = await fetch(`${platform.url}/assignments/a-unlocked/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${platform.token}` },
    })
    assert.equal(claimed.status, 201, 'claim 应成功')
    const home = await mkdtemp(join(tmpdir(), 'nju-e2e-dshc-home-'))

    try {
      const overlay = join(home, 'overlay.yml')
      await writeFile(
        overlay,
        [
          '- insert:',
          '    - id: nju-lab-client',
          `      name: '${PLUGIN_ENTRY}'`,
          '      config:',
          `        serverUrl: '${platform.url}'`,
          `        token: '${platform.token}'`,
          '- id: llm-deepseek',
          '  config:',
          `    baseURL: '${llm.url}'`,
          "    apiKeyEnv: 'NJU_TEST_API_KEY'",
          '',
        ].join('\n'),
      )

      // cwd = workspaceDir：会话的 header.cwd 就是它，证据按 cwd 归属项目
      await run(dsh.cmd, ['--profile', 'headless', '--patch', overlay, '提交我的 Skill'], {
        timeout: 150_000,
        maxBuffer: 16 * 1024 * 1024,
        cwd: workspaceDir,
        env: { ...process.env, DSH_HOME: home, NJU_TEST_API_KEY: 'test' },
      })

      const capsule = JSON.parse(
        await readFile(join(workspaceDir, 'nju-lab', 'a-unlocked', 'evidence.dshc'), 'utf8'),
      )

      assert.equal(capsule.format, 'nju-lab.capsule/v1')
      assert.equal(capsule.note, undefined, `采集不该走降级：${capsule.note}`)
      assert.ok(capsule.sessions.length >= 1, '应至少采到本会话')
      assert.equal(capsule.sessions[0].cwd, workspaceDir)
      assert.ok(capsule.sessions[0].eventCount > 0, '本会话应当有事件')
      assert.ok(Array.isArray(capsule.auditEvents))
      assert.match(capsule.integrity, /^[0-9a-f]{64}$/)
    } finally {
      await llm.close()
      await platform.close()
    }
  },
)
