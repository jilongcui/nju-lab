/**
 * L1：REQ-2026-09-21 §1.0「Skill 目录探测约定」与 §1.4.2「纯 JS 打包」。
 *
 * 这两条是学生主流程上的坑：模板 ZIP 允许包一层顶层目录（`csv-cleaner/SKILL.md`），
 * 如果自检只认 `<dir>/SKILL.md`，学生改完就直接卡在"没有 SKILL.md"。
 *
 * 这里用**面板的 host 路由**驱动（返回 JSON，好断言），平台侧仍是 mock。
 * 造测试输入用的是系统 `zip`（独立于被测的纯 JS 实现，避免自我验证）。
 *
 * 跑法：`npm test`。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

const run = promisify(execFile)
const BASE = 'http://127.0.0.1/api'

/**
 * 造模板 ZIP。`nested` 包一层 `csv-cleaner/`（模拟平台 fixtures 的风格）；
 * `compress` 强制 deflate —— 真实模板就是 deflate，我们自己的解压必须能处理。
 */
async function makeTemplateZip({ nested = false, compress = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nju-tpl-'))
  const root = nested ? join(dir, 'csv-cleaner') : dir
  await mkdir(join(root, 'scripts'), { recursive: true })
  await writeFile(join(root, 'SKILL.md'), '# csv-cleaner\n')
  await writeFile(join(root, 'scripts', 'clean.py'), 'print("clean")\n')
  if (compress) {
    // 给一个够大的可压缩文件，确保 zip 真的选 deflate 而不是退回 store
    await writeFile(join(root, 'references.md'), 'checklist line\n'.repeat(2000))
  }
  const zipPath = join(dir, 'template.zip')
  const args = [
    ...(compress ? ['-Z', 'deflate'] : []),
    '-q',
    '-r',
    zipPath,
    nested ? 'csv-cleaner' : '.',
  ]
  await run('zip', args, { cwd: dir })
  return readFile(zipPath)
}

/** 从 ZIP 里读出各条目的压缩方法（独立于被测实现的最小解析）。 */
function zipMethods(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
  const methods = new Map()
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(pos + 10)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    methods.set(buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8'), method)
    pos += 46 + nameLen + extraLen + commentLen
  }
  return methods
}

function makeHarness() {
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
    settings: { configure: () => () => {} }, effect: (callback) => { callback(); return () => {} },
  }
  // 照 cordis 语义：只在该服务存在时执行回调（这里没有 systemPrompt / skills，
  // 所以引导注册被跳过 —— 与 headless 下缺 connection 是同一类情形）。
  ctx.inject = (deps, cb) => {
    if (deps.every((dep) => ctx[dep] !== undefined)) cb(ctx)
    return () => {}
  }
  return {
    ctx,
    route(path) {
      const found = routes.get(path)
      assert.ok(found, `route ${path} not registered`)
      return found
    },
  }
}

async function withClient(platformOptions, fn) {
  const platform = await startMockPlatform(platformOptions)
  const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-root-'))
  try {
    const harness = makeHarness()
    apply(harness.ctx, { serverUrl: platform.url, token: platform.token, workspaceDir })
    const call = (path, init) =>
      harness.route(path).fetch(new Request(`${BASE}${path}`, init))
    const post = (path, body) =>
      call(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    await fn({ platform, workspaceDir, call, post })
  } finally {
    await platform.close()
  }
}

describe('§1.0 Skill 根探测', () => {
  test('模板带一层顶层目录时，Skill 根是那一层', async () => {
    await withClient({ skillTemplate: await makeTemplateZip({ nested: true }) }, async (h) => {
      const outcome = await (await h.post('/api/nju-lab.claim', { assignmentId: 'a-unlocked' })).json()

      assert.equal(outcome.skillDir, join(h.workspaceDir, 'nju-lab', 'a-unlocked', 'skill'))
      assert.equal(outcome.skillRoot, join(outcome.skillDir, 'csv-cleaner'))
      assert.equal(outcome.unzipError, undefined, '纯 JS 解压不该失败')
    })
  })

  test('模板没有顶层目录时，Skill 根就是 skill/', async () => {
    await withClient({ skillTemplate: await makeTemplateZip() }, async (h) => {
      const outcome = await (await h.post('/api/nju-lab.claim', { assignmentId: 'a-unlocked' })).json()

      assert.equal(outcome.skillRoot, outcome.skillDir)
    })
  })

  test('模板是 deflate 压缩时也能解压（真实模板就是 deflate）', async () => {
    const zip = await makeTemplateZip({ nested: true, compress: true })
    // 先确认这份测试输入真的用了 deflate —— 否则这条测试等于没测
    assert.ok(
      [...zipMethods(zip).values()].includes(8),
      `测试输入应当含 deflate(8) 条目，实际：${JSON.stringify([...zipMethods(zip)])}`,
    )

    await withClient({ skillTemplate: zip }, async (h) => {
      const outcome = await (
        await h.post('/api/nju-lab.claim', { assignmentId: 'a-unlocked' })
      ).json()

      assert.equal(outcome.unzipError, undefined, '纯 JS 解压必须支持 deflate')
      assert.equal(outcome.skillRoot, join(outcome.skillDir, 'csv-cleaner'))
    })
  })

  test('提交时传 skill/（即带顶层目录）也能识别并打包', async () => {
    await withClient({ skillTemplate: await makeTemplateZip({ nested: true }) }, async (h) => {
      await h.post('/api/nju-lab.claim', { assignmentId: 'a-unlocked' })
      // 学生改的是 Skill 根里的文件
      await writeFile(
        join(h.workspaceDir, 'nju-lab', 'a-unlocked', 'skill', 'csv-cleaner', 'SKILL.md'),
        '# 改过了\n',
      )

      // 不传 skillDir → 默认 skill/，这正是以前会撞自检的路径
      const res = await h.post('/api/nju-lab.submit', { assignmentId: 'a-unlocked' })
      assert.equal(res.status, 200, '带顶层目录时也应能提交')

      const outcome = await res.json()
      assert.equal(outcome.skillRoot, join(h.workspaceDir, 'nju-lab', 'a-unlocked', 'skill', 'csv-cleaner'))

      // ZIP 内保持"单层顶层目录"风格
      const listing = await run('unzip', ['-l', outcome.zipPath])
      assert.match(listing.stdout, /csv-cleaner\/SKILL\.md/)
      assert.match(listing.stdout, /csv-cleaner\/scripts\/clean\.py/)
    })
  })

  test('传 Skill 根本身也可以', async () => {
    await withClient({ skillTemplate: await makeTemplateZip({ nested: true }) }, async (h) => {
      const skillRoot = join(h.workspaceDir, 'nju-lab', 'a-unlocked', 'skill', 'csv-cleaner')
      await h.post('/api/nju-lab.claim', { assignmentId: 'a-unlocked' })

      const rootRes = await h.post('/api/nju-lab.submit', {
        assignmentId: 'a-unlocked',
        skillDir: skillRoot,
      })
      assert.equal(rootRes.status, 200)
      assert.equal((await rootRes.json()).skillRoot, skillRoot)
    })
  })

  test('没有 SKILL.md 时拒绝，且不上传任何东西', async () => {
    await withClient({ skillTemplate: await makeTemplateZip() }, async (h) => {
      const bad = await mkdtemp(join(tmpdir(), 'nju-bad-'))
      await writeFile(join(bad, 'notes.md'), 'no skill here\n')

      const res = await h.post('/api/nju-lab.submit', { assignmentId: 'a-unlocked', skillDir: bad })
      assert.equal(res.status, 502)
      assert.match((await res.json()).message, /找不到 SKILL\.md/)
      assert.equal(h.platform.submissions.length, 0)
      assert.equal(
        h.platform.requests.filter((r) => r.path === '/files').length,
        0,
        '自检失败不该发起上传',
      )
    })
  })
})

describe('§1.4.2 纯 JS 打包', () => {
  test('产出的 ZIP 通过了系统 unzip 的完整性校验', async () => {
    await withClient({ skillTemplate: await makeTemplateZip() }, async (h) => {
      await h.post('/api/nju-lab.claim', { assignmentId: 'a-unlocked' })
      const outcome = await (
        await h.post('/api/nju-lab.submit', { assignmentId: 'a-unlocked' })
      ).json()

      // unzip -t 会逐条校验 CRC：我们自己算的 CRC 必须与标准一致
      const check = await run('unzip', ['-t', outcome.zipPath])
      assert.match(check.stdout, /No errors detected/)
    })
  })

  test('fileHashes 的键与 ZIP 内路径一致（供服务端防篡改比对）', async () => {
    await withClient({ skillTemplate: await makeTemplateZip({ nested: true }) }, async (h) => {
      await h.post('/api/nju-lab.claim', { assignmentId: 'a-unlocked' })
      await h.post('/api/nju-lab.submit', { assignmentId: 'a-unlocked' })

      const submission = h.platform.submissions.at(-1)
      assert.deepEqual(Object.keys(submission.fileHashes).sort(), [
        'csv-cleaner/SKILL.md',
        'csv-cleaner/scripts/clean.py',
      ])

      // 哈希是真实算出来的：与本地文件对照
      const local = await readFile(
        join(h.workspaceDir, 'nju-lab', 'a-unlocked', 'skill', 'csv-cleaner', 'SKILL.md'),
      )
      const { createHash } = await import('node:crypto')
      assert.equal(
        submission.fileHashes['csv-cleaner/SKILL.md'],
        createHash('sha256').update(local).digest('hex'),
      )
    })
  })
})
