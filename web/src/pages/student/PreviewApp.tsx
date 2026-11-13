/**
 * 预览我的应用（不提交也能对话）。
 *
 * 右侧/独立窗口用：它把工作台容器里的预览服务指向 `<workspaceDir>/nju-lab/<aid>/skill`，
 * 然后 iframe 直接跟它对话。**改完代码不用提交** —— 预览服务每次请求都重新加载学生的入口模块。
 *
 * 为什么不放工作台的侧栏 tab：那要改 DSH 客户端的 tab 机制；走平台页面更稳，
 * 且能直接复用已验证的 `/lab/ws/<key>/api/nju-lab.preview*` 路由。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Empty, Select, Space, Typography } from 'antd'
import { getWorkspaceStatus, listMyAssignments, startWorkspace } from '../../api'
import type { WorkspaceInfo } from '../../types'

interface MyAssignment {
  id: string
  title?: string
  status?: string
}

export default function PreviewApp() {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null)
  const [items, setItems] = useState<MyAssignment[]>([])
  const [selected, setSelected] = useState<string>('')
  const [state, setState] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [nonce, setNonce] = useState(0)
  const [warmSrc, setWarmSrc] = useState('')
  const booted = useRef(false)

  /** 起（或复用）工作台，等 running */
  const ensureWorkspace = useCallback(async (): Promise<WorkspaceInfo | null> => {
    let info = await getWorkspaceStatus()
    if (!info || info.status !== 'running') {
      await startWorkspace()
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 3000))
        info = await getWorkspaceStatus()
        if (info?.status === 'running') break
        if (info?.status === 'failed') break
      }
    }
    setWs(info ?? null)
    return info?.status === 'running' ? info : null
  }, [])

  const loadAssignments = useCallback(async () => {
    try {
      // 走平台 API（`/lab/api/`），不要用根路径 `/api/` —— 那个前缀归 FoxCMS
      const list = (await listMyAssignments()) as unknown as MyAssignment[]
      setItems(Array.isArray(list) ? list : [])
      const first = list.find((a) => a.status !== 'pending') ?? list[0]
      if (first) setSelected((prev) => prev || first.id)
    } catch {
      // 拿不到就让学生手选；不影响预览本身
    }
  }, [])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      await loadAssignments()
      await ensureWorkspace()
    })()
  }, [ensureWorkspace, loadAssignments])

  const start = useCallback(async () => {
    if (!selected) return
    setState('starting')
    setMessage('正在启动预览服务…')
    const info = await ensureWorkspace()
    if (!info?.wsKey) {
      setState('error')
      setMessage('工作台没起来，去「实验环境」页看下状态')
      return
    }
    const skillDir = `${info.workspaceDir ?? '/home/ubuntu'}/nju-lab/${selected}/skill`
    try {
      // 预热：`/lab/ws/<key>/api/*` 要两样东西 —— nginx 的 `nju_ws` cookie（`enter` 种）
      // 和 dsh 自己种的浏览器凭证（**只有真的加载一次工作台页面才会种**，fetch 不执行 JS）。
      // 所以先挂一个隐藏 iframe 把工作台页面加载一遍，等一下再发 select。
      if (info.enterUrl) {
        setWarmSrc(`/lab${info.enterUrl}`)
        await new Promise((r) => setTimeout(r, 6000))
      }
      // dsh 的 browser-trust fence 要求 launch token（`?token=` 不可省），否则 401
      const tq = info.token ? `?token=${encodeURIComponent(info.token)}` : ''
      const res = await fetch(`/lab/ws/${info.wsKey}/api/nju-lab.preview.select${tq}`, {
        method: 'POST',
        credentials: 'include',
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
    } catch (e) {
      setState('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }, [ensureWorkspace, selected])

  const src = ws?.wsKey
    ? `/lab/ws/${ws.wsKey}/api/nju-lab.preview${ws.token ? `?token=${encodeURIComponent(ws.token)}` : ''}`
    : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', gap: 12 }}>
      <Card size="small">
        <Space wrap>
          <Typography.Text strong>预览我的应用</Typography.Text>
          <Select
            style={{ minWidth: 320 }}
            value={selected || undefined}
            onChange={(v) => {
              setSelected(v)
              setState('idle')
            }}
            placeholder="选一个实验任务"
            options={items.map((a) => ({ value: a.id, label: a.title || a.id.slice(0, 8) }))}
          />
          <Button type="primary" loading={state === 'starting'} onClick={() => void start()}>
            {state === 'ready' ? '重启预览' : '开始预览'}
          </Button>
          {state === 'ready' ? (
            <Button onClick={() => setNonce((n) => n + 1)}>刷新页面</Button>
          ) : null}
        </Space>
        <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
          它直接跑工作区里的 <code>nju-lab/&lt;任务&gt;/skill</code>：改完代码**不用提交**，
          下次对话就是新代码。数据要放在 skill 根目录（`assets.csv` / `kb/` 等）。
        </div>
      </Card>

      {warmSrc ? (
        <iframe
          src={warmSrc}
          title="预热工作台"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      ) : null}
      {message ? <Alert type={state === 'error' ? 'error' : 'info'} message={message} showIcon /> : null}

      {state === 'ready' && src ? (
        <iframe
          key={nonce}
          src={src}
          title="预览"
          style={{ flex: 1, minHeight: 420, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
        />
      ) : (
        <Card style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="选一个任务，点「开始预览」" />
        </Card>
      )}
    </div>
  )
}
