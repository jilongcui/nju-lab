/**
 * 侧边栏「预览」tab：**跟你自己写的 agent 对话**（不是跟你聊天的那位 AI 助手）。
 *
 * 对象是自动绑定的：扫工作区 `nju-lab/<任务>/skill`，取入口文件刚被改过的那个 ——
 * 学生不用选任务，改成哪个预览就是哪个。改完代码回来再问一句就是新代码
 * （`app_host` 每次请求都重新加载学生入口）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const ROUTES = {
  assignments: '/api/nju-lab.assignments',
  select: '/api/nju-lab.preview.select',
  page: '/api/nju-lab.preview',
}

interface AssignmentDto {
  id: string
  title?: string
  status?: string
  project?: { title?: string }
}

interface SnapshotDto {
  assignments: AssignmentDto[]
  workspaceDir: string
}

export function PreviewPanel({ getSessionId }: { getSessionId: () => string | null | undefined }) {
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [active, setActive] = useState<{ id: string; title: string } | null>(null)
  const [state, setState] = useState<'starting' | 'ready' | 'error'>('starting')
  const [message, setMessage] = useState('')
  const [nonce, setNonce] = useState(0)
  const booted = useRef(false)

  const start = useCallback(async () => {
    setState('starting')
    setMessage('正在起预览…')
    const sessionId = getSessionId() ?? ''
    try {
      const res = await fetch(ROUTES.select, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 不传 skillDir：让 host 自己找"你正在写的那个"
        body: JSON.stringify({ sessionId }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string; assignmentId?: string }
      if (data.ok) {
        setActive({ id: data.assignmentId || '', title: '' })
        setState('ready')
        setMessage('')
        setNonce((n) => n + 1)
      } else {
        setState('error')
        setMessage(data.error || '预览起不来')
      }
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [getSessionId])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      // 只是为了让标题可读（id → 任务名），拿不到也不影响预览
      try {
        const sessionId = getSessionId() ?? ''
        const res = await fetch(`${ROUTES.assignments}?sessionId=${encodeURIComponent(sessionId)}`)
        const snap = (await res.json()) as SnapshotDto
        const map: Record<string, string> = {}
        for (const a of snap.assignments ?? []) {
          map[a.id] = a.project?.title || a.title || a.id.slice(0, 8)
        }
        setTitles(map)
      } catch {
        // ignore
      }
      await start()
    })()
  }, [getSessionId, start])

  const title = active?.id ? titles[active.id] || active.title || '当前任务' : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8, padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {state === 'ready' ? <>正在预览：<b>{title}</b></> : '预览我的 agent'}
        </div>
        <button onClick={() => void start()} disabled={state === 'starting'}>
          {state === 'ready' ? '重启' : '再试'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af' }}>
        这是跟你自己写的 agent 对话；左边那位是帮你写代码的助手。
      </div>
      {message ? (
        <div style={{ fontSize: 12, color: state === 'error' ? '#b42318' : '#6b7280', lineHeight: 1.6 }}>{message}</div>
      ) : null}
      {state === 'ready' ? (
        <iframe
          key={nonce}
          src={ROUTES.page}
          title="预览"
          style={{ flex: 1, minHeight: 0, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
        />
      ) : null}
    </div>
  )
}
