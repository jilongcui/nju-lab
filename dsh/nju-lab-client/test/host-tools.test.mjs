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
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    // settings 服务：0.1.7 里插件只调 configure（关闭按 schema 自动生成的页面），
    // 记录调用即可 —— 配置值本身由 volatile 引用承载，不经过这个服务。
    settings: {
      configure(presentation, owner) {
        sections.push({ presentation, owner })
        return () => {}
      },
    },
    effect(callback) {
      callback()
      return () => {}
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
    /** settings.configure 收到的调用（页面策略），用来验证设置页接线。 */
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

  test('POST /assignments/:id/claim returns file info objects, not templateUrl/problemUrl', async () => {
    await withClient({}, async ({ platform }) => {
      const raw = await fetch(`${platform.url}/assignments/a-unlocked/claim`, {
        method: 'POST',
        headers: { authorization: `Bearer ${platform.token}` },
      }).then((r) => r.json())

      const d = raw.data
      assert.deepEqual(Object.keys(d).sort(), ['assignment', 'evalConfig', 'problem', 'skillTemplate'])
      assert.ok(!('templateUrl' in d), 'the old templateUrl field must not exist')

      for (const key of ['skillTemplate', 'problem']) {
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
  test('downloads template + problem package into the workspace and verifies sha256', async () => {
    const templateZip = await makeTemplateZip()
    await withClient({ platform: { skillTemplate: templateZip } }, async ({ harness, workspaceDir }) => {
      const out = await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })

      const dir = join(workspaceDir, 'nju-lab', 'a-unlocked')
      const tplPath = join(dir, 'template.zip')
      const pkgPath = join(dir, 'problem.zip')
      assert.ok(existsSync(tplPath), 'template.zip should be written')
      assert.ok(existsSync(pkgPath), 'problem.zip should be written')

      const onDisk = await readFile(tplPath)
      assert.equal(
        createHash('sha256').update(onDisk).digest('hex'),
        createHash('sha256').update(templateZip).digest('hex'),
        'downloaded bytes must match the served bytes',
      )

      assert.match(out, /sha256 校验通过/)
      // 模板是 ZIP，应被解压出 SKILL.md
      assert.ok(existsSync(join(dir, 'skill', 'SKILL.md')), 'template should be unzipped into skill/')
      // 不再打印 templateUrl/problemUrl
      assert.doesNotMatch(out, /templateUrl|problemUrl/)
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

describe('host half: nju_lab_claim 不覆盖学生文件', () => {
  test('重新下载只补缺失文件，已改过的不动', async () => {
    // 需要一个**有内容**的模板 ZIP（默认 mock 是空包，补缺失无从谈起）
    await withClient({ platform: { skillTemplate: await makeTemplateZip() } }, async ({ harness, workspaceDir }) => {
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      const skillDir = join(workspaceDir, 'nju-lab', 'a-unlocked', 'skill')
      const file = join(skillDir, 'SKILL.md')

      // 学生改过模板
      await writeFile(file, '# 我改过的 SKILL\n')
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      assert.equal(await readFile(file, 'utf8'), '# 我改过的 SKILL\n', '再下载不能覆盖学生改过的文件')

      // 删掉后应被补回（模板里有）
      await rm(file)
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      assert.match(await readFile(file, 'utf8'), /模板 Skill/, '缺失的文件要补回来')
    })
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

  // 2026-10-22：平台只判断实验报告（report.md），不再判断 SKILL.md 的内容。
  // 口径仍是「只警告不阻断」——学生交了空报告时，从这里第一次被点名。
  const REPORT_TEMPLATE = [
    '# 实验报告：demo',
    '',
    '## 1. 自测概况',
    '',
    '- 自测时间：',
    '',
    '## 2. 两个 case 的结果',
    '',
    '| case | 数据特点 | accuracy | macro F1 | 是否达标 |',
    '|---|---|---|---|---|',
    '| case01 | 150 行 |  |  |  |',
    '| case02 | 120 行 |  |  |  |',
    '',
    '## 3. 基线对照',
    '',
    '- 基线 accuracy：',
    '',
    '## 4. 踩坑记录（每条一行，平台按行计数）',
    '',
    '1. ',
    '',
    '## 5. 结论',
    '',
  ].join('\n')

  const SKILL_WITH_BOUNDARY = [
    '# demo skill',
    '',
    '## 能力边界',
    '',
    '- 能处理：UTF-8 的 CSV',
    '- 不处理：GBK 编码',
    '',
  ].join('\n')

  test('报告还是空模板：提交照常成功，但输出点名缺什么', async () => {
    await withClient({}, async ({ harness, platform }) => {
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      const skillDir = await mkdtemp(join(tmpdir(), 'nju-report-empty-'))
      await writeFile(join(skillDir, 'SKILL.md'), SKILL_WITH_BOUNDARY)
      await writeFile(join(skillDir, 'report.md'), REPORT_TEMPLATE)

      const out = await harness.tool('nju_lab_submit').execute({ assignmentId: 'a-unlocked', skillDir })

      assert.match(out, /submitted a-unlocked/, '警告不能变成拦截')
      assert.match(out, /实验报告还没填完/)
      assert.match(out, /自测时间/)
      assert.match(out, /踩坑记录/)
      assert.equal(platform.submissions.length, 1, '提交确实完成了')
    })
  })

  test('报告填好时不出现警告（SKILL.md 内容不再被判断）', async () => {
    await withClient({}, async ({ harness }) => {
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      const skillDir = await mkdtemp(join(tmpdir(), 'nju-report-ok-'))
      await writeFile(join(skillDir, 'SKILL.md'), SKILL_WITH_BOUNDARY)
      await writeFile(
        join(skillDir, 'report.md'),
        [
          '# 实验报告：demo',
          '',
          '## 1. 自测概况',
          '',
          '- 自测时间：2026-10-22',
          '',
          '## 2. 两个 case 的结果',
          '',
          '| case | 数据特点 | accuracy | macro F1 | 是否达标 |',
          '|---|---|---|---|---|',
          '| case01 | 150 行 | 0.9474 | 0.9487 | 达标 |',
          '| case02 | 120 行 | 0.9333 | 0.9333 | 达标 |',
          '',
          '## 4. 踩坑记录（每条一行，平台按行计数）',
          '',
          '1. 只报 accuracy 不够，macro F1 会掉',
          '2. 只用花瓣长度时重叠区错得更多',
          '',
        ].join('\n'),
      )

      const out = await harness.tool('nju_lab_submit').execute({ assignmentId: 'a-unlocked', skillDir })
      assert.match(out, /submitted a-unlocked/)
      assert.doesNotMatch(out, /实验报告还没填完/, '报告填好了就不该再提醒')
    })
  })

  test('向后兼容：老作业只有 dossier.md 时照旧算齐全', async () => {
    await withClient({}, async ({ harness }) => {
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      const skillDir = await mkdtemp(join(tmpdir(), 'nju-report-legacy-'))
      await writeFile(join(skillDir, 'SKILL.md'), SKILL_WITH_BOUNDARY)
      await writeFile(
        join(skillDir, 'dossier.md'),
        [
          '# 实测档案',
          '',
          '- 自测时间：2026-10-17',
          '- 踩坑记录（pitfalls）：',
          '  - 表头有空列：按列名取值抛 KeyError',
          '',
        ].join('\n'),
      )

      const out = await harness.tool('nju_lab_submit').execute({ assignmentId: 'a-unlocked', skillDir })
      assert.match(out, /submitted a-unlocked/)
      assert.doesNotMatch(out, /实验报告还没填完/, '老档案写了就不该提醒')
    })
  })

  test('向后兼容：更老的作业把实测档案写在 SKILL.md 里也算数', async () => {
    await withClient({}, async ({ harness }) => {
      await harness.tool('nju_lab_claim').execute({ assignmentId: 'a-unlocked' })
      const skillDir = await mkdtemp(join(tmpdir(), 'nju-report-oldest-'))
      await writeFile(
        join(skillDir, 'SKILL.md'),
        [
          SKILL_WITH_BOUNDARY,
          '## 实测档案',
          '',
          '- 自测时间：2026-10-17',
          '- 踩坑记录（pitfalls）：',
          '  - 表头有空列：按列名取值抛 KeyError',
          '',
        ].join('\n'),
      )

      const out = await harness.tool('nju_lab_submit').execute({ assignmentId: 'a-unlocked', skillDir })
      assert.match(out, /submitted a-unlocked/)
      assert.doesNotMatch(out, /实验报告还没填完/, '最老的写法也照旧算数')
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

  test('turns off the auto-generated settings page (configure auto=false)', async () => {
    await withClient({}, async ({ harness }) => {
      const [policy] = harness.settingsSections
      assert.ok(policy, 'settings.configure was not called')
      assert.deepEqual(policy.presentation, { auto: false })
    })
  })

  test('reads settings through volatile refs (0.1.7 config model)', async () => {
    // token 走 volatile 引用：host 每次请求都该读到引用里的最新值（'token-from-settings'）。
    await withClient(
      { config: { token: { get: () => 'token-from-settings' } } },
      async ({ harness, platform }) => {
        await assert.rejects(
          () => harness.tool('nju_lab_list_assignments').execute({}),
          /平台拒绝了当前 token/,
        )
        assert.equal(platform.requests.at(-1).auth, 'Bearer token-from-settings')
      },
    )
  })
})
