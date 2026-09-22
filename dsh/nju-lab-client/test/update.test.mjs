/**
 * L1：插件自更新（`src/host/update.ts` + 面板 update 路由）。
 *
 * 用 mock 平台的 `/kit/nju-lab-student-kit.zip`（生产是 nginx 静态托管）+ 一个
 * 假的插件目录（`NJU_LAB_PLUGIN_DIR` 逃生门，避免动到仓库的真实 lib/）驱动：
 * 快照报"有更新" → POST 更新 → 文件被覆盖、旧产物被清掉、版本凭据落盘 → 再查无更新。
 *
 * 跑法：`npm test`。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

const run = promisify(execFile)

/** 造一个内容真实的安装包 zip：kit-version.json + nju-lab-client/ 子树。 */
async function makeKitZip(version) {
  const dir = await mkdtemp(join(tmpdir(), 'nju-kit-'))
  await mkdir(join(dir, 'nju-lab-client', 'lib', 'host'), { recursive: true })
  await writeFile(join(dir, 'kit-version.json'), JSON.stringify({ version }))
  await writeFile(join(dir, 'nju-lab-client', 'package.json'), '{"name":"nju-lab-client"}')
  await writeFile(join(dir, 'nju-lab-client', 'lib', 'host', 'index.js'), `// ${version}\n`)
  const zipPath = join(dir, 'kit.zip')
  await run('zip', ['-q', '-r', zipPath, 'kit-version.json', 'nju-lab-client'], { cwd: dir })
  return readFile(zipPath)
}

/** 捕获插件注册的 host 路由（与 host-panel.test.mjs 同一模式）。 */
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
    settings: { installSection: () => {} },
  }
  ctx.inject = (deps, callback) => {
    if (deps.every((dep) => ctx[dep] !== undefined)) callback(ctx)
    return () => {}
  }
  return {
    ctx,
    route(path) {
      const found = routes.get(path)
      assert.ok(found, `route ${path} was not registered`)
      return found
    },
  }
}

const BASE = 'http://127.0.0.1/api'
const get = (harness, path) => harness.route(path).fetch(new Request(`${BASE}${path}`))
const post = (harness, path) =>
  harness.route(path).fetch(new Request(`${BASE}${path}`, { method: 'POST' }))

describe('插件自更新', () => {
  test('快照报有更新 → 更新覆盖插件目录 → 再查无更新', async () => {
    const platform = await startMockPlatform({ kitZip: await makeKitZip('v2-test') })
    // 假的"已安装插件"：旧版本凭据 + 一个会被清掉的旧产物文件
    const dir = await mkdtemp(join(tmpdir(), 'nju-plugin-'))
    await mkdir(join(dir, 'lib'), { recursive: true })
    await writeFile(join(dir, 'kit-version.json'), JSON.stringify({ version: 'v1-old' }))
    await writeFile(join(dir, 'lib', 'stale.js'), '// 旧版残留\n')
    process.env.NJU_LAB_PLUGIN_DIR = dir

    try {
      const harness = makeHarness()
      apply(harness.ctx, { serverUrl: platform.url, token: platform.token })

      // 1. 快照：本地 v1-old ≠ 远端 v2-test → available
      const before = await (await get(harness, '/api/nju-lab.assignments')).json()
      assert.deepEqual(before.update, { current: 'v1-old', latest: 'v2-test', available: true })

      // 2. 执行更新
      const done = await (await post(harness, '/api/nju-lab.update')).json()
      assert.match(done.message, /v2-test/)
      assert.equal(done.restartRequired, true)

      // 3. 插件目录被覆盖：版本凭据更新、新文件写入、旧 lib 残留被清掉
      const marker = JSON.parse(await readFile(join(dir, 'kit-version.json'), 'utf8'))
      assert.equal(marker.version, 'v2-test')
      assert.equal(await readFile(join(dir, 'lib', 'host', 'index.js'), 'utf8'), '// v2-test\n')
      await assert.rejects(access(join(dir, 'lib', 'stale.js')), '旧产物应被清掉')

      // 4. 再查：本地 == 远端 → 无更新
      const after = await (await get(harness, '/api/nju-lab.assignments')).json()
      assert.equal(after.update.available, false)
    } finally {
      delete process.env.NJU_LAB_PLUGIN_DIR
      await platform.close()
    }
  })
})
