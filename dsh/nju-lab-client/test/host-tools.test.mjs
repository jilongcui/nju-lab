/**
 * L1：host 半的代码级测试。
 *
 * 不启动 DSH、不调用模型 —— 直接 `apply(fakeCtx, config)` 捕获插件注册的工具与
 * hook，再驱动它们；平台侧由 `./mock-platform.mjs` 承担（其契约以
 * `REQ-2026-09-21-submit-pipeline.md` §0 为准）。
 *
 * 跑法：`npm test`（会先 `npm run build`）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

const run = promisify(execFile)

/** 捕获插件向 ctx 注册的工具与事件处理器。 */
function makeHarness() {
  const tools = []
  const handlers = new Map()
  const sections = []
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
    // 面板路由需要 connection 服务；这个 harness 只关心工具，给它一个空实现。
    connection: { fetch: { register: () => async () => {} } },
    // settings 服务：只记录 installSection 的参数，测试再手动驱动 setSource。
    settings: {
      installSection: (owner, ns, schema, entry, hooks) => {
        sections.push({ owner, ns, schema, entry, hooks })
      },
    },
  }
  // 插件用 ctx.inject 声明可选依赖；照 cordis 语义：只在该服务存在时执行回调
  // （所以这个 harness 没有 systemPrompt / skills 时，引导注册会被跳过）。
  ctx.inject = (deps, callback) => {
    if (deps.every((dep) => ctx[dep] !== undefined)) callback(ctx)
    return () => {}
  }
  return {
    ctx,
    /** installSection 收到的调用（含 setSource hooks），用来验证设置页接线。 */
    settingsSections: sections,
    tool(name) {
      const found = tools.find((entry) => entry.name === name)
      assert.ok(found, `tool ${name} was not registered`)
      return found
    },
    registeredNames: () => tools.map((t) => t.name),
    requestHandler() {
      const handler = handlers.get('agent/request')
      assert.ok(handler, 'agent/request handler was not registered')
      return handler
    },
  }
}

/** 起一个 mock 平台 + 独立工作区、装上插件、跑完关掉。 */
async function withClient(options = {}, fn) {
  const platform = await startMockPlatform(options.platform)
  const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-ws-'))
  try {
    const harness = makeHarness()
    apply(harness.ctx, {
      serverUrl: platform.url,
      token: platform.token,
      workspaceDir,
      ...(options.config ?? {}),
    })
    await fn({ platform, harness, workspaceDir })
  } finally {
    await platform.close()
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

describe('contract: platform shapes (REQ-2026-09-21 §0)', () => {
  test('GET /me/assignments nests project and carries no projectId/unlockHint', async () => {
    await withClient({}, async ({ platform }) => {
      const raw = await fetch(`${platform.url}/me/assignments`, {
        headers: { authorization: `Bearer ${platform.token}` },
      }).then((r) => r.json())

      const [first] = raw.data
      assert.ok(first.project, 'assignment should nest `project`')
      assert.equal(typeof first.project.id, 'string')
      assert.equal(typeof first.project.title, 'string')
      assert.ok('chapterTitle' in first.project)
      assert.ok(!('projectId' in first), 'server does NOT send projectId')
      assert.ok(!('unlockHint' in first), 'server does NOT send unlockHint')
      assert.ok('unlocked' in first && 'status' in first && 'submission' in first)
    })
  })

  test('POST /assignments/:id/claim returns file info objects, not templateUrl/datasetUrl', async () => {
    await withClient({}, async ({ platform }) => {
      const raw = await fetch(`${platform.url}/assignments/a-unlocked/claim`, {
        method: 'POST',
        headers: { authorization: `Bearer ${platform.token}` },
      }).then((r) => r.json())

      const d = raw.data
      assert.deepEqual(Object.keys(d).sort(), ['assignment', 'evalConfig', 'skillTemplate', 'testDataset'])
      assert.ok(!('templateUrl' in d), 'the old templateUrl field must not exist')

      for (const key of ['skillTemplate', 'testDataset']) {
        const info = d[key]
        assert.deepEqual(
          Object.keys(info).sort(),
          ['fileId', 'originalName', 'sha256', 'size', 'url'],
          `${key} should be a StoredFileInfo`,
        )
      }

      // evalConfig 的真实字段（没有 provider / maxTokens）
      assert.deepEqual(Object.keys(d.evalConfig).sort(), ['model', 'timeoutSeconds', 'tools'])
    })
  })
})

describe('host half: nju_lab_list_assignments', () => {
  test('renders unlock state, project title and chapter', async () => {
    await withClient({}, async ({ harness, platform }) => {
      const out = await harness.tool('nju_lab_list_assignments').execute({})

      assert.match(out, /\[unlocked\] a-unlocked \(pending\) — 实验：数据清洗 — chapter=第2章 实验/)
      assert.match(out, /\[locked\] a-locked \(pending\) — 实验一：CSV 数据清洗 Skill/)
      assert.match(out, /deadline=2026-12-31T15:59:59\.000Z/)

      const [request] = platform.requests
      // 注意：mock 记录的是剥离 /api 前缀后的路由路径
      assert.equal(request.path, '/me/assignments')
      assert.equal(request.auth, `Bearer ${platform.token}`)
    })
  })

  test('reports an empty list verbatim', async () => {
    await withClient({ platform: { assignments: [] } }, async ({ harness }) => {
      const out = await harness.tool('nju_lab_list_assignments').execute({})
      assert.equal(out, '(no assignments)')
    })
  })
})

describe('host half: nju_lab_claim', () => {
  test('downloads template + dataset into the workspace and verifies sha256', async () => {
    const templateZip = await makeTemplateZip()
    await withClient({ platform: { skillTemplate: templateZip } }, async ({ harness, workspaceDir }) => {
      const out = await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })

      const dir = join(workspaceDir, 'nju-lab', 'a-unlocked')
      const tplPath = join(dir, 'template.zip')
      const dsPath = join(dir, 'dataset.zip')
      assert.ok(existsSync(tplPath), 'template.zip should be written')
      assert.ok(existsSync(dsPath), 'dataset.zip should be written')

      const onDisk = await readFile(tplPath)
      assert.equal(
        createHash('sha256').update(onDisk).digest('hex'),
        createHash('sha256').update(templateZip).digest('hex'),
        'downloaded bytes must match the served bytes',
      )

      assert.match(out, /sha256 校验通过/)
      // 模板是 ZIP，应被解压出 SKILL.md
      assert.ok(existsSync(join(dir, 'skill', 'SKILL.md')), 'template should be unzipped into skill/')
      // 不再打印 templateUrl/datasetUrl
      assert.doesNotMatch(out, /templateUrl|datasetUrl/)
    })
  })

  test('claim 下发的条件会覆盖配置里的初始值', async () => {
    await withClient(
      {
        config: {
          evalConfig: { model: 'student-configured', reasoningEffort: 'high' },
        },
      },
      async ({ harness }) => {
        const before = await harness.requestHandler()({}, async () => ({
          provider: 'x',
          model: 'student-picked',
          temperature: 0.7,
        }))
        assert.equal(before.model, 'student-configured')

        await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })

        const after = await harness.requestHandler()({}, async () => ({
          provider: 'x',
          model: 'student-picked',
          temperature: 0.7,
        }))
        // claim 下发的值（deepseek-flash，当前不带 reasoningEffort）接管
        assert.equal(after.model, 'deepseek-flash')
        assert.equal(after.reasoningEffort, undefined)
        assert.equal(after.temperature, 0.7, 'unrelated fields must survive')
      },
    )
  })

  test('waterfall 仍钉得住 reasoningEffort（能力保留，只是平台当前不下发）', async () => {
    await withClient(
      { config: { evalConfig: { model: 'deepseek-chat', reasoningEffort: 'medium' } } },
      async ({ harness }) => {
        const after = await harness.requestHandler()({}, async () => ({
          provider: 'x',
          model: 'student-picked',
        }))
        assert.equal(after.model, 'deepseek-chat')
        assert.equal(after.reasoningEffort, 'medium')
      },
    )
  })
})

describe('host half: nju_lab_submit', () => {
  test('hashes every file, packs a ZIP, uploads both artifacts and submits', async () => {
    await withClient({}, async ({ harness, platform }) => {
      // 提交前必须先领取（服务端状态机要求 claimed）
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })

      const skillDir = await mkdtemp(join(tmpdir(), 'nju-skill-'))
      await writeFile(join(skillDir, 'SKILL.md'), '# demo skill\n')
      await mkdir(join(skillDir, 'scripts'), { recursive: true })
      await writeFile(join(skillDir, 'scripts', 'run.sh'), 'echo hi\n')
      await mkdir(join(skillDir, 'node_modules'), { recursive: true })
      await writeFile(join(skillDir, 'node_modules', 'ignored.js'), 'nope\n')

      const out = await harness.tool('nju_lab_submit').execute({
        assignmentId: 'a-unlocked',
        skillDir,
      })

      assert.match(out, /submitted a-unlocked/)
      assert.match(out, /文件数: 2/) // node_modules 被排除

      // 两次上传
      const uploads = platform.requests.filter((r) => r.method === 'POST' && r.path === '/files')
      assert.equal(uploads.length, 2, 'should upload skill.zip and evidence.dshc')

      // 提交体是 fileId 模式，且 fileHashes 是真算的
      const submit = platform.requests.find((r) => r.path === '/assignments/a-unlocked/submit')
      assert.ok(submit, 'submit endpoint was not called')
      assert.ok(submit.body.skillZipFileId, 'should submit by fileId')
      assert.ok(submit.body.capsuleFileId)
      assert.deepEqual(Object.keys(submit.body.fileHashes).sort(), ['SKILL.md', 'scripts/run.sh'])
      assert.equal(
        submit.body.fileHashes['SKILL.md'],
        createHash('sha256').update('# demo skill\n').digest('hex'),
      )

      // 平台侧落库，且 sha256 取自服务端
      assert.equal(platform.submissions.length, 1)
      assert.match(platform.submissions[0].skillZipRef, /^file:/)
      assert.match(platform.submissions[0].skillZipSha256, /^[0-9a-f]{64}$/)
      assert.equal(platform.submissions[0].version, 1)
    })
  })

  test('resubmit creates a new version (multi-version submissions)', async () => {
    await withClient({}, async ({ harness, platform }) => {
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      const skillDir = await mkdtemp(join(tmpdir(), 'nju-skill-'))
      await writeFile(join(skillDir, 'SKILL.md'), '# demo skill\n')

      await harness.tool('nju_lab_submit').execute({ assignmentId: 'a-unlocked', skillDir })
      // 平台允许多版本：已提交后再次提交生成 v2，历史版本保留
      await harness.tool('nju_lab_submit').execute({ assignmentId: 'a-unlocked', skillDir })

      assert.equal(platform.submissions.length, 2)
      assert.deepEqual(
        platform.submissions.map((s) => s.version),
        [1, 2],
      )
    })
  })

  test('refuses to submit a directory without SKILL.md (no upload happens)', async () => {
    await withClient({}, async ({ harness, platform }) => {
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      const skillDir = await mkdtemp(join(tmpdir(), 'nju-bad-'))
      await writeFile(join(skillDir, 'README.md'), 'no skill here\n')

      await assert.rejects(
        () => harness.tool('nju_lab_submit').execute({ assignmentId: 'a-unlocked', skillDir }),
        /找不到 SKILL.md/,
      )
      assert.equal(
        platform.requests.filter((r) => r.method === 'POST' && r.path === '/files').length,
        0,
        'self-check must fail before any upload',
      )
    })
  })
})

describe('host half: platform auth', () => {
  test('explains how to obtain and set a token when none is configured', async () => {
    await withClient({ config: { token: undefined } }, async ({ harness }) => {
      await assert.rejects(
        () => harness.tool('nju_lab_list_assignments').execute({}),
        /未配置平台 token[\s\S]*NJU_LAB_TOKEN/,
      )
    })
  })

  test('explains that a rejected token is stale, not a bare 401', async () => {
    await withClient({ config: { token: 'stale-token' } }, async ({ harness }) => {
      await assert.rejects(
        () => harness.tool('nju_lab_list_assignments').execute({}),
        /平台拒绝了当前 token/,
      )
    })
  })

  test('exposes Config as a settings section and honors the user layer', async () => {
    await withClient({}, async ({ harness, platform }) => {
      const [section] = harness.settingsSections
      assert.ok(section, 'installSection was not called')
      assert.equal(section.ns, 'nju-lab')
      assert.equal(section.entry.token, platform.token, 'composition 层来自 patch 的值')

      // 模拟学生在设置页填了 token：settings 把权威值换成用户层
      section.hooks.setSource(() => ({ ...section.entry, token: 'token-from-settings' }))

      // 插件必须立刻改用新值 —— 被拒的是"设置页填的"那个 token
      await assert.rejects(
        () => harness.tool('nju_lab_list_assignments').execute({}),
        /平台拒绝了当前 token/,
      )
      assert.equal(platform.requests.at(-1).auth, 'Bearer token-from-settings')
    })
  })
})
