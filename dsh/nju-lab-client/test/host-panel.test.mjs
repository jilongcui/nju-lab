/**
 * L1：ClaimPanel 的 host 路由（`src/host/panel.ts`）。
 *
 * 面板本身是浏览器组件（需要真页面才能渲染），但它的**数据面**全在 host 半 ——
 * 这里用假 ctx 捕获 `ctx.connection.fetch.register` 注册的路由，直接拿
 * Fetch `Request` 驱动它们，断言返回给面板的 JSON。
 *
 * 跑法：`npm test`。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

const run = promisify(execFile)

/** 造一个内容真实的模板 ZIP —— mock 的默认模板不是合法 ZIP，解压会失败。 */
async function makeTemplateZip() {
  const dir = await mkdtemp(join(tmpdir(), 'nju-panel-tpl-'))
  await writeFile(join(dir, 'SKILL.md'), '# 模板 Skill\n')
  const zipPath = join(dir, 'template.zip')
  await run('zip', ['-q', '-r', zipPath, '.'], { cwd: dir })
  return readFile(zipPath)
}

/** 捕获插件注册的 host 路由（与工具）。 */
function makeHarness() {
  /** @type {Map<string, {path:string,methods:string[],fetch:(r:Request)=>Promise<Response>}>} */
  const routes = new Map()
  const ctx = {
    tools: { register: () => () => {} },
    on: () => () => {},
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return async () => {}
        },
      },
    },
    // 插件会把 Config 装进 settings；这个 harness 不需要真的设置存储。
    settings: { configure: () => () => {} }, effect: (callback) => { callback(); return () => {} },
  }
  // 插件用 ctx.inject 声明可选依赖；照 cordis 语义：只在该服务存在时执行回调
  // （所以这个 harness 没有 systemPrompt / skills 时，引导注册会被跳过）。
  ctx.inject = (deps, callback) => {
    if (deps.every((dep) => ctx[dep] !== undefined)) callback(ctx)
    return () => {}
  }
  return {
    ctx,
    routePaths: () => [...routes.keys()].sort(),
    route(path) {
      const found = routes.get(path)
      assert.ok(found, `route ${path} was not registered (have: ${[...routes.keys()]})`)
      return found
    },
  }
}

async function withClient(options = {}, fn) {
  const platform = await startMockPlatform({
    skillTemplate: await makeTemplateZip(),
    ...options.platform,
  })
  const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-panel-'))
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

const BASE = 'http://127.0.0.1/api'

function get(harness, path) {
  return harness.route(path).fetch(new Request(`${BASE}${path}`))
}

function post(harness, path, body) {
  return harness.route(path).fetch(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('host routes: nju-lab panel', () => {
  test('registers the four routes on the shared /api channel', async () => {
    await withClient({}, async ({ harness }) => {
      assert.deepEqual(harness.routePaths(), [
        '/api/nju-lab.assignments',
        '/api/nju-lab.claim',
        '/api/nju-lab.submit',
        '/api/nju-lab.update',
      ])
      assert.deepEqual(harness.route('/api/nju-lab.claim').methods, ['POST'])
      assert.deepEqual(harness.route('/api/nju-lab.assignments').methods, ['GET'])
    })
  })

  test('GET assignments returns the first-screen snapshot', async () => {
    await withClient({}, async ({ harness, workspaceDir }) => {
      const res = await get(harness, '/api/nju-lab.assignments')
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('cache-control'), 'no-store')

      const body = await res.json()
      assert.equal(body.tokenConfigured, true)
      assert.equal(body.workspaceDir, workspaceDir)
      assert.equal(body.evalConfig, null, '还没有 claim，条件应未钉定')
      assert.equal(body.assignments.length, 2)
      assert.deepEqual(body.downloaded, [], '还没有任何本地材料')

      const unlocked = body.assignments.find((a) => a.id === 'a-unlocked')
      assert.equal(unlocked.unlocked, true)
      assert.equal(unlocked.project.title, '实验：数据清洗')
      assert.equal(unlocked.project.chapterTitle, '第2章 实验')
    })
  })

  test('POST claim downloads both artifacts and pins evalConfig', async () => {
    await withClient({}, async ({ harness, workspaceDir }) => {
      const res = await post(harness, '/api/nju-lab.claim', { assignmentId: 'a-unlocked' })
      assert.equal(res.status, 200)

      const body = await res.json()
      assert.equal(body.assignmentId, 'a-unlocked')
      assert.equal(body.dir, join(workspaceDir, 'nju-lab', 'a-unlocked'))
      assert.deepEqual(
        body.artifacts.map((a) => a.label).sort(),
        ['skillTemplate', 'testDataset'],
      )
      for (const artifact of body.artifacts) {
        assert.ok(artifact.bytes > 0)
        assert.match(artifact.sha256, /^[0-9a-f]{64}$/)
      }
      // 模板是合法 ZIP，应当解出 skill/
      assert.equal(body.skillDir, join(workspaceDir, 'nju-lab', 'a-unlocked', 'skill'))
      assert.equal(body.unzipError, undefined)
      assert.equal(body.evalConfig.model, 'deepseek-flash')
      assert.equal(body.evalConfig.reasoningEffort, undefined)
    })
  })

  test('after claim, the snapshot carries the pinned evalConfig', async () => {
    await withClient({}, async ({ harness }) => {
      await post(harness, '/api/nju-lab.claim', { assignmentId: 'a-unlocked' })
      const body = await (await get(harness, '/api/nju-lab.assignments')).json()

      assert.equal(body.evalConfig.model, 'deepseek-flash')
      assert.deepEqual(body.evalConfig.tools, ['shell'])
      assert.equal(body.evalConfig.timeoutSeconds, 600)
      assert.deepEqual(body.downloaded, ['a-unlocked'], 'claim 后本地材料应在 downloaded 里')
    })
  })

  test('POST submit packs the claimed skill dir and reports the submission', async () => {
    await withClient({}, async ({ harness, workspaceDir, platform }) => {
      // 领取会把模板解压成 skill/；再改一改，模拟学生改过 Skill
      await post(harness, '/api/nju-lab.claim', { assignmentId: 'a-unlocked' })
      const skillDir = join(workspaceDir, 'nju-lab', 'a-unlocked', 'skill')
      await writeFile(join(skillDir, 'SKILL.md'), '# 学生改过的 Skill\n')

      // skillDir 省略时应默认用领取目录下的 skill/
      const res = await post(harness, '/api/nju-lab.submit', { assignmentId: 'a-unlocked' })
      assert.equal(res.status, 200)

      const body = await res.json()
      assert.equal(body.assignmentId, 'a-unlocked')
      assert.match(body.skillZip.fileId, /^file-/)
      assert.match(body.capsule.fileId, /^file-/)
      assert.equal(body.submission.status, 'submitted')
      assert.equal(platform.submissions.length, 1)

      // 平台收到的是两个上传 + 一次提交
      const paths = platform.requests.map((r) => `${r.method} ${r.path}`)
      assert.deepEqual(paths.slice(-3), [
        'POST /files',
        'POST /files',
        'POST /assignments/a-unlocked/submit',
      ])
    })
  })

  test('missing assignmentId is a readable error, not a crash', async () => {
    await withClient({}, async ({ harness }) => {
      const res = await post(harness, '/api/nju-lab.claim', {})
      assert.equal(res.status, 502)
      assert.match((await res.json()).message, /缺少参数 assignmentId/)
    })
  })

  test('without a token, the snapshot says so and actions fail readably', async () => {
    await withClient({ config: { token: undefined } }, async ({ harness }) => {
      // 没 token 时不去碰平台：面板拿到空列表 + 标记，好渲染"去配置"的指引
      const snapshot = await (await get(harness, '/api/nju-lab.assignments')).json()
      assert.equal(snapshot.tokenConfigured, false)
      assert.deepEqual(snapshot.assignments, [])

      // 但真去点动作时，必须是可读提示而不是裸 401
      const res = await post(harness, '/api/nju-lab.claim', { assignmentId: 'a-unlocked' })
      assert.equal(res.status, 502)
      assert.match((await res.json()).message, /未配置平台 token[\s\S]*NJU_LAB_TOKEN/)
    })
  })
})
