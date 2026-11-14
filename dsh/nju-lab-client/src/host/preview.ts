/**
 * **边改边预览**：把学生工作区里的 skill 目录直接跑起来，侧边栏 iframe 里对话。
 *
 * 和"发布成应用"的区别：
 * - 发布：打包 zip → 应用容器解包 → 起 `app_host.py`（30–60 秒，且要提交一次）；
 * - 预览：**直接**用镜像里的 `app_host.py` 指向 `<workspace>/nju-lab/<aid>/skill`，
 *   改完文件下一次对话就是新代码 —— `app_host` 每次请求都会重新 `exec_module` 学生的入口。
 *
 * 路由（都注册在 DSH 的 shared API 通道上，精确路径）：
 * - `GET /preview`        → 一个自包含的对话页（iframe 用）
 * - `POST /preview/chat`  → 反代到容器内的预览服务
 * - `POST /preview/select`→ 切到某个 assignment 的 skill 目录并重启预览服务
 */
import type { Context } from '@deepseek-ai/cordis'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 预览服务在容器内的端口（只用 127.0.0.1，不出容器）。 */
const PREVIEW_PORT = 9311
/** 镜像里内置的平台 harness（app_host.py + platform_core.py）。 */
const PLATFORM_APP_DIR = '/opt/platform/app'

export const PREVIEW_ROUTES = {
  /** iframe 直接指向它（和面板其它路由一样挂在 /api/ shared 通道上） */
  page: '/api/nju-lab.preview',
  chat: '/api/nju-lab.preview.chat',
  select: '/api/nju-lab.preview.select',
} as const

interface PreviewState {
  process: ChildProcess | null
  skillDir: string | null
  assignmentId: string | null
  lastError: string | null
}

const state: PreviewState = { process: null, skillDir: null, assignmentId: null, lastError: null }

async function waitHealthy(timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PREVIEW_PORT}/api/health`)
      if (res.ok) return true
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

function stopPreview(): void {
  if (state.process) {
    try {
      state.process.kill('SIGTERM')
    } catch {
      // ignore
    }
    state.process = null
  }
}

/**
 * 找出"你正在写的那个 agent"：扫 `<workspace>/nju-lab/<aid>/skill` 里带入口文件的，
 * 按入口文件的修改时间取最新 —— 学生不需要选任务，预览永远对着他刚动过的那份代码。
 */
export function detectActiveSkill(root: string): { skillDir: string; assignmentId: string } | null {
  const base = join(root, 'nju-lab')
  if (!existsSync(base)) return null
  const found: Array<{ skillDir: string; assignmentId: string; mtime: number }> = []
  for (const name of readdirSync(base)) {
    const skillDir = join(base, name, 'skill')
    const hit = ['agent/api.py', 'scripts/api.py', 'skill/scripts/api.py']
      .map((rel) => join(skillDir, rel))
      .find((path) => existsSync(path))
    if (!hit) continue
    try {
      found.push({ skillDir, assignmentId: name, mtime: statSync(hit).mtimeMs })
    } catch {
      // 读不到时间就跳过
    }
  }
  if (!found.length) return null
  found.sort((a, b) => b.mtime - a.mtime)
  return { skillDir: found[0].skillDir, assignmentId: found[0].assignmentId }
}

/** 让预览服务跑起来，指向给定的 skill 目录（已在跑的同一目录直接复用）。 */
export async function ensurePreview(skillDir: string, assignmentId: string): Promise<{ ok: boolean; error?: string }> {
  if (state.process && state.skillDir === skillDir) return { ok: true }
  stopPreview()
  if (!existsSync(join(PLATFORM_APP_DIR, 'app_host.py'))) {
    return { ok: false, error: `预览组件缺失：${PLATFORM_APP_DIR}/app_host.py 不在镜像里` }
  }
  if (!existsSync(skillDir)) {
    return { ok: false, error: `还没领取这个任务的模板：${skillDir} 不存在` }
  }
  // 没有入口就先别起服务 —— 起起来也只会甩一段 Python 报错给学生
  const hasEntry = ['agent/api.py', 'scripts/api.py', 'skill/scripts/api.py'].some((rel) =>
    existsSync(join(skillDir, rel)),
  )
  if (!hasEntry) {
    return {
      ok: false,
      error: '还没有入口文件：先在你的包根建 agent/api.py，实现 handle(state, message, attachments, session)，然后点「重启」。',
    }
  }
  const child = spawn('python3', [join(PLATFORM_APP_DIR, 'app_host.py')], {
    cwd: PLATFORM_APP_DIR,
    env: {
      ...process.env,
      APP_SKILL_DIR: skillDir,
      APP_PORT: String(PREVIEW_PORT),
      APP_HOST: '127.0.0.1',
      APP_DATA_DIR: '/tmp/nju-preview-data',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  state.process = child
  state.skillDir = skillDir
  state.assignmentId = assignmentId
  state.lastError = null
  child.stderr?.on('data', (chunk: Buffer) => {
    state.lastError = chunk.toString().slice(-600)
  })
  child.on('exit', () => {
    if (state.process === child) state.process = null
  })
  const healthy = await waitHealthy()
  if (!healthy) {
    const detail = state.lastError ? `：${state.lastError}` : ''
    stopPreview()
    return { ok: false, error: `预览服务没起来${detail}` }
  }
  return { ok: true }
}

/** iframe 用的自包含对话页（内联样式与脚本，不依赖任何静态资源）。 */
function previewPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>预览</title>
<style>
  :root{--bg:#f7f8fa;--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--accent:#2f6feb}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);
       display:flex;flex-direction:column;height:100vh}
  header{padding:8px 12px;border-bottom:1px solid var(--line);background:#fff;display:flex;gap:8px;align-items:center}
  header b{font-size:13px}
  header .hint{color:var(--muted);font-size:12px;margin-left:auto}
  #log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
  .msg{max-width:86%;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-break:break-word}
  .me{align-self:flex-end;background:var(--accent);color:#fff}
  .it{align-self:flex-start;background:#fff;border:1px solid var(--line)}
  .err{align-self:flex-start;background:#fdecec;border:1px solid #f5b5b5;color:#8a1f1f}
  footer{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);background:#fff}
  textarea{flex:1;resize:none;height:44px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit}
  button{padding:0 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;cursor:pointer}
  button[disabled]{opacity:.5;cursor:default}
</style></head><body>
<header><b>预览</b><span class="hint">改完文件，下一次对话就是新代码</span></header>
<div id="log"></div>
<footer><textarea id="q" placeholder="问它一句试试（Enter 发送）"></textarea><button id="send">发送</button></footer>
<script>
const log=document.getElementById('log'),q=document.getElementById('q'),send=document.getElementById('send');
const esc=(s)=>String(s??'').replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function add(kind,text){const d=document.createElement('div');d.className='msg '+kind;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}
let busy=false;
async function ask(){
  const text=q.value.trim(); if(!text||busy) return;
  busy=true; send.disabled=true; q.value=''; add('me',text);
  const pending=add('it','…');
  try{
    const token=new URLSearchParams(location.search).get('token')||'';
    const r=await fetch('nju-lab.preview.chat'+(token?'?token='+encodeURIComponent(token):''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text})});
    const data=await r.json();
    pending.textContent=data.reply||'(空回复)';
    if(data.citations&&data.citations.length){pending.textContent+= '\\n\\n出处：'+data.citations.map(c=>c.ref||c).join('、')}
  }catch(e){pending.className='msg err';pending.textContent='预览服务出错：'+e}
  busy=false; send.disabled=false; q.focus();
}
send.onclick=ask;
q.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}});
q.focus();
</script></body></html>`
}

/** 注册预览路由。 */
export function registerPreviewRoutes(
  ctx: Context,
  actions: {
    resolveRoot: (sessionId?: string) => Promise<string>
    listAssignments?: () => Promise<Array<{ id: string }>>
    assignmentDir?: (assignmentId: string, sessionId?: string) => Promise<string>
  },
): void {
  ctx.connection.fetch.register({
    path: PREVIEW_ROUTES.page,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () =>
      new Response(previewPage(), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      }),
  })

  ctx.connection.fetch.register({
    path: PREVIEW_ROUTES.chat,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (!state.process) {
        return Response.json(
          { reply: '预览服务还没起来：先在左侧选一个任务（或说一句"预览"）', citations: [] },
          { status: 503 },
        )
      }
      const body = await request.text()
      try {
        const upstream = await fetch(`http://127.0.0.1:${PREVIEW_PORT}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
        const text = await upstream.text()
        return new Response(text, {
          status: upstream.status,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return Response.json({ reply: `预览服务不可达：${message}`, citations: [] }, { status: 502 })
      }
    },
  })

  ctx.connection.fetch.register({
    path: PREVIEW_ROUTES.select,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = (await request.json().catch(() => ({}))) as {
        skillDir?: string
        assignmentId?: string
        sessionId?: string
      }
      // 顺手把老的 uuid 目录归成可读名（`assignmentDir` 内部会迁移，带缓存，失败忽略）
      if (actions.listAssignments && actions.assignmentDir) {
        const list = await actions.listAssignments().catch(() => [])
        for (const a of list.slice(0, 40)) {
          await actions.assignmentDir(a.id, body.sessionId).catch(() => undefined)
        }
      }

      let skillDir = body.skillDir
      let assignmentId = body.assignmentId || ''
      if (!skillDir) {
        // 没指定就自己找：工作区里带入口、且入口刚被改过的那个 skill。
        // 先看当前会话的 cwd，再回落容器 HOME —— 会话目录是按 cwd 分的，老会话可能是 /root 或 /workspace，
        // 而实验文件永远在 HOME 下的 nju-lab/ 里。
        const candidates = [await actions.resolveRoot(body.sessionId), process.env.HOME || '/home/ubuntu']
        let active: ReturnType<typeof detectActiveSkill> = null
        const tried: string[] = []
        for (const root of candidates) {
          if (!root || tried.includes(root)) continue
          tried.push(root)
          active = detectActiveSkill(root)
          if (active) break
        }
        if (!active) {
          return Response.json(
            {
              ok: false,
              error: '工作区里还没有带入口的任务：先在 nju-lab/<任务>/skill/agent/api.py 里写 handle()。',
            },
            { status: 400 },
          )
        }
        skillDir = active.skillDir
        assignmentId = active.assignmentId
      }
      const result = await ensurePreview(skillDir, assignmentId)
      return Response.json({ ...result, assignmentId }, { status: result.ok ? 200 : 500 })
    },
  })
}
