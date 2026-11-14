/**
 * 侧边栏「预览」tab：选中一个任务 → 起预览服务 → iframe 里直接跟它对话。
 *
 * 关键点：**不需要提交**。预览服务指向工作区里的 `nju-lab/<assignmentId>/skill`，
 * 你改完文件，下一次对话就是新代码（`app_host` 每次请求都重新加载学生的入口模块）。
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
  /** 平台返回的任务带着 project（里面有可读标题），别只显示 uuid */
  project?: { title?: string }
}

interface SnapshotDto {
  assignments: AssignmentDto[]
  workspaceDir: string
}

export function PreviewPanel({ getSessionId }: { getSessionId: () => string | null | undefined }) {
  const [snapshot, setSnapshot] = useState<SnapshotDto | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [state, setState] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [nonce, setNonce] = useState(0)
  const loaded = useRef(false)

  const load = useCallback(async () => {
    try {
      const sessionId = getSessionId() ?? ''
      const res = await fetch(`${ROUTES.assignments}?sessionId=${encodeURIComponent(sessionId)}`)
      const data = (await res.json()) as SnapshotDto
      setSnapshot(data)
      const first = data.assignments?.find((a) => a.status !== 'pending') ?? data.assignments?.[0]
      if (first) setSelected((prev) => prev || first.id)
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [getSessionId])

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    void load()
  }, [load])


  const start = useCallback(async () => {
    if (!snapshot?.workspaceDir || !selected) return
    const skillDir = `${snapshot.workspaceDir}/nju-lab/${selected}/skill`
    setState('starting')
    setMessage('正在启动预览服务…')
    try {
      const res = await fetch(ROUTES.select, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillDir, assignmentId: selected }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (data.ok) {
        setState('ready')
        setMessage('')
        setNonce((n) => n + 1)
      } else {
        setState('error')
        setMessage(data.error || '预览服务启动失败')
      }
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [selected, snapshot])


  // 自动跑：选好任务就起预览，学生不用再点一次（改完代码回来就是新版本）
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current || !selected || !snapshot?.workspaceDir) return
    autoStarted.current = true
    void start()
  }, [selected, snapshot, start])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8, padding: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value)
            setState('idle')
          }}
          style={{ flex: 1, minWidth: 0, padding: '4px 6px' }}
        >
          <option value="">选择任务…</option>
          {(snapshot?.assignments ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.project?.title || a.title || a.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <button onClick={() => void start()} disabled={!selected || state === 'starting'}>
          {state === 'ready' ? '重启' : '预览'}
        </button>
      </div>
      {message ? (
        <div style={{ fontSize: 12, color: state === 'error' ? '#b42318' : '#6b7280' }}>{message}</div>
      ) : null}
      {state === 'ready' ? (
        <iframe
          key={nonce}
          src={ROUTES.page}
          title="预览"
          style={{ flex: 1, minHeight: 0, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
        />
      ) : (
        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.7 }}>
          选一个任务点「预览」——它直接跑工作区里的 <code>skill/</code>。
          <br />
          改完文件不用提交，回到这里再问一句就是新代码。
        </div>
      )}
    </div>
  )
}
