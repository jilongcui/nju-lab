/**
 * 真实 Chromium 验证 ClaimPanel 的两条口径（2026-10-17，用户明确）：
 *
 *  1. **列表只列已领取**：`claimed` / `submitted` 进列表，`pending` 不进（底部只留一行汇总）；
 *  2. **打开面板即材料化**：已领取但本地没材料的任务自动下发一次（只下发缺的那些），
 *     下发失败给错误横幅、按钮退回「重新下载」，且**只自动试一次**（不静默重试）。
 *
 * 为什么不在 `npm test` 里：它要 Chromium + 系统库，学生机/CI 上不一定有。
 * 手动跑：
 *
 *   npm run test:browser            # 18 条断言 + 截图（截图总是保留，供人看）
 *
 * 前置：`web/` 已装 playwright（仓库里就是这样）；Chromium 在 `~/.cache/ms-playwright`。
 * `PLAYWRIGHT_BROWSERS_PATH` 在这里**显式设上**：默认会落到 `/tmp/ms-playwright`，
 * 那里会被清，还会留下 `__dirlock` 让下次安装失败（HANDOFF §10.1 的坑）。
 *
 * 面板接的是**假平台**（`window.fetch` 桩）：GET 快照 / POST 领取，并记录每次调用，
 * 所以"只对缺材料的任务下发一次"这类断言是直接看请求体得出的，不靠界面文字猜。
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PKG_DIR = new URL('../', import.meta.url).pathname
const SHOT_DIR = join(PKG_DIR, '.verify-scratch', 'panel-shots')
const requireFromWeb = createRequire(new URL('../../../web/package.json', import.meta.url))

process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(homedir(), '.cache', 'ms-playwright')

const { chromium } = requireFromWeb('playwright')
const { build } = requireFromWeb('esbuild')

/** 面板入口：包目录作 resolveDir，`react` 从本包 node_modules 解析。 */
const ENTRY = `
import { createRoot } from 'react-dom/client'
import { ClaimPanel } from './src/client/ClaimPanel.tsx'

createRoot(document.getElementById('root')).render(<ClaimPanel />)
`

/** 假平台：三态任务 + 缺材料/已落盘两种本地状态，全部调用都记账。 */
const STUB = `
window.__calls = []
const ASSIGNMENTS = [
  { id: 'a-doing', status: 'claimed', unlocked: true, submission: null,
    project: { id: 'p1', title: '实验：鸢尾花品种识别', chapterTitle: '第2章 机器学习', deadline: null } },
  { id: 'a-done', status: 'submitted', unlocked: true,
    submission: { id: 's1', status: 'passed', submittedAt: '2026-10-17T10:00:00Z', version: 2 },
    project: { id: 'p2', title: '实验：按面积估算房价', chapterTitle: '第2章 机器学习', deadline: null } },
  { id: 'a-todo-1', status: 'pending', unlocked: true, submission: null,
    project: { id: 'p3', title: '实验：手写数字分拣', chapterTitle: '第3章 深度学习', deadline: null } },
  { id: 'a-todo-2', status: 'pending', unlocked: false, submission: null,
    project: { id: 'p4', title: '实验：练习情况估算成绩', chapterTitle: '第3章 深度学习', deadline: null } },
]
// 本地材料清单跨刷新保留 —— 真实 host 是实测工作区目录，刷新不会重置
const storeKey = '__downloaded'
let downloaded = JSON.parse(localStorage.getItem(storeKey) || 'null') || ['a-done']
// 故障注入：非 null 时下一次 claim 返回这个错误
let failNextClaim = localStorage.getItem('__failClaim') || null
const json = (data) => ({ ok: true, status: 200, json: async () => data })
window.fetch = async (url, init = {}) => {
  const u = String(url)
  window.__calls.push({ url: u, method: init.method || 'GET', body: init.body || null })
  if (u.includes('nju-lab.assignments')) {
    return json({ assignments: ASSIGNMENTS, downloaded, evalConfig: null,
      workspaceDir: '/tmp/ws', tokenConfigured: true, pinnedFrom: undefined, update: null })
  }
  if (u.includes('nju-lab.claim')) {
    if (failNextClaim) {
      const message = failNextClaim
      failNextClaim = null
      localStorage.removeItem('__failClaim')
      return { ok: false, status: 502, json: async () => ({ message }) }
    }
    const id = JSON.parse(init.body || '{}').assignmentId
    downloaded = [...new Set([...downloaded, id])]
    localStorage.setItem(storeKey, JSON.stringify(downloaded))
    return json({ assignmentId: id, dir: '/tmp/ws/nju-lab/' + id, artifacts: [],
      skillDir: '/tmp/ws/nju-lab/' + id + '/skill', skillRoot: '/tmp/ws/nju-lab/' + id + '/skill',
      evalConfig: { model: 'deepseek-flash' } })
  }
  return json({})
}
`

/**
 * 页面本身写成 `.verify-scratch/` 下的**真文件**再 `file://` 打开：`about:blank`
 * 与 `setContent()` 的文档是 opaque origin，读 `localStorage` 直接 SecurityError，
 * 而"刷新不再自动下发"这条断言要靠 localStorage 跨刷新保留本地材料清单。
 * 假平台（STUB）内联在 HTML 里，刷新后自动跟随；bundle 每次 reload 后重新注入。
 */
const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8" /></head>
<body style="margin:0;font:13px/1.5 system-ui,'Noto Sans CJK SC',sans-serif;background:#1e1e1e;color:#ddd">
<div id="root" style="width:420px;min-height:900px"></div>
<script>${STUB}</script></body></html>`

const results = []
const check = (label, ok, extra = '') => {
  results.push([label, ok])
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? `  | ${extra}` : ''}`)
}

/**
 * 每个场景一个干净 context（localStorage 不互相污染）。
 *
 * seed 用 `addInitScript` 在文档脚本之前写 localStorage，且只写一次（`__seeded`
 * 标记）—— 场景里的 reload 不能把"已落盘"清掉，否则"刷新不再下发"永远失败。
 */
async function openPanel(browser, { failClaim, seed } = {}) {
  const context = await browser.newContext({ viewport: { width: 460, height: 900 } })
  await context.addInitScript(
    ([seedJson, fail]) => {
      try {
        if (localStorage.getItem('__seeded')) return
        localStorage.clear()
        localStorage.setItem('__seeded', '1')
        if (seedJson) localStorage.setItem('__downloaded', seedJson)
        if (fail) localStorage.setItem('__failClaim', fail)
      } catch {
        /* opaque origin：本脚本用 file:// 打开，正常到不了这里 */
      }
    },
    [seed ? JSON.stringify(seed) : null, failClaim ?? null],
  )
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error('[panel 页面异常]', error.message))
  await page.goto(PAGE_URL)
  await page.addScriptTag({ content: bundle })
  return { context, page }
}

const text = (page) => page.locator('#root').innerText()
const claims = (calls) => calls.filter((c) => c.url.includes('nju-lab.claim'))

await mkdir(SHOT_DIR, { recursive: true })
const bundle = (
  await build({
    stdin: { contents: ENTRY, resolveDir: PKG_DIR, loader: 'tsx', sourcefile: 'panel-entry.tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    // 必须显式开 automatic：少这一行 JSX 会编译成 React.createElement，
    // 而 entry 没有 import React → 页面上只报一句 "React is not defined"。
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  })
).outputFiles[0].text

const PAGE_FILE = join(SHOT_DIR, 'page.html')
await writeFile(PAGE_FILE, PAGE)
const PAGE_URL = `file://${PAGE_FILE}`

const browser = await chromium.launch()

// ---------- 场景 1：默认列表 + 自动下发 ----------
{
  const { context, page } = await openPanel(browser, { seed: ['a-done'] })
  await page.waitForSelector('text=实验：鸢尾花品种识别', { timeout: 10_000 })
  await page.waitForSelector('text=已自动下发已领取实验的材料', { timeout: 10_000 })
  await page.waitForTimeout(300)

  const body = await text(page)
  check('已领取的 claimed 任务在列表里', body.includes('实验：鸢尾花品种识别'))
  check('已提交的任务在列表里', body.includes('实验：按面积估算房价'))
  check('未领取的任务不在列表里（已解锁）', !body.includes('实验：手写数字分拣'))
  check('未领取的任务不在列表里（未解锁）', !body.includes('实验：练习情况估算成绩'))
  check('有「另有 N 个未领取」汇总行', body.includes('另有 2 个未领取的实验'))
  check('自动下发横幅出现', body.includes('已自动下发已领取实验的材料'))
  check('横幅里带落盘目录', body.includes('/tmp/ws/nju-lab/a-doing'))

  const calls = await page.evaluate(() => window.__calls)
  check('只对缺材料的任务下发 1 次', claims(calls).length === 1, `实际 ${claims(calls).length} 次`)
  check(
    '下发的是 claimed 且本地缺材料的那一个',
    claims(calls)[0] && JSON.parse(claims(calls)[0].body).assignmentId === 'a-doing',
  )
  check(
    '本地已有材料的 submitted 任务没被重复下发',
    !claims(calls).some((c) => c.body && c.body.includes('a-done')),
  )
  await page.waitForTimeout(200)
  check('下发后按钮变「已领取」', /已领取/.test(await text(page)))

  // 手动展开未领取
  await page.getByRole('button', { name: '显示' }).click()
  await page.waitForTimeout(200)
  const expanded = await text(page)
  check(
    '点「显示」后未领取的出现',
    expanded.includes('实验：手写数字分拣') && expanded.includes('实验：练习情况估算成绩'),
  )
  await page.getByRole('button', { name: '收起' }).click()
  await page.waitForTimeout(200)
  check('再点「收起」后回到只列已领取', !(await text(page)).includes('实验：手写数字分拣'))
  await page.screenshot({ path: join(SHOT_DIR, 'default.png'), fullPage: true })

  // 材料已落盘 → 刷新不再自动下发
  await page.evaluate(() => {
    window.__calls = []
  })
  await page.reload()
  await page.addScriptTag({ content: bundle })   // STUB 内联在 HTML 里会跟随刷新，bundle 要重新注入
  await page.waitForSelector('text=实验：鸢尾花品种识别')
  await page.waitForTimeout(800)
  const afterReload = await page.evaluate(() => window.__calls)
  check('材料已落盘时刷新不再自动下发', claims(afterReload).length === 0)
  await context.close()
}

// ---------- 场景 2：下发失败 → 错误横幅 + 退回手动 ----------
{
  const { context, page } = await openPanel(browser, { failClaim: '模块下载超时（模拟）' })
  await page.waitForSelector('text=没下发成功', { timeout: 10_000 })
  const body = await text(page)
  check('下发失败时给错误横幅', body.includes('没下发成功'))
  check('横幅里带上平台给的原因', body.includes('模块下载超时（模拟）'))
  check('失败后按钮退回「重新下载」', body.includes('重新下载'))
  const calls = await page.evaluate(() => window.__calls)
  check('失败也只自动试一次（不静默重试）', claims(calls).length === 1, `实际 ${claims(calls).length} 次`)
  await page.screenshot({ path: join(SHOT_DIR, 'failed.png'), fullPage: true })
  await context.close()
}

await browser.close()

const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
console.log(`截图：${SHOT_DIR}`)
process.exit(failed.length ? 1 : 0)
