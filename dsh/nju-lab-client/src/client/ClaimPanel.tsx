/**
 * NJU-Lab 任务面板。
 *
 * 数据来源：**host 半注册的同源路由**（见 `src/host/panel.ts` 的 PANEL_ROUTES）。
 * 组件拿不到 `ctx`，所以不走 cordis 服务；但也不需要 —— 平台 token 留在 host 半，
 * 这里只做同源 `fetch`，浏览器里看不到任何凭据。
 *
 * 与对话式工具的关系：两者共用 `src/host/actions.ts` 的一份实现，行为一致。
 */
import { useCallback, useEffect, useState } from 'react'

const ROUTES = {
  assignments: '/api/nju-lab.assignments',
  claim: '/api/nju-lab.claim',
  submit: '/api/nju-lab.submit',
} as const

interface ProjectDto {
  id: string
  title: string
  deadline?: string | null
  chapterTitle?: string | null
}

interface SubmissionDto {
  id: string
  status: string
  submittedAt: string
}

interface AssignmentDto {
  id: string
  status: string
  unlocked: boolean
  project: ProjectDto
  submission?: SubmissionDto | null
}

interface EvalConfigDto {
  model?: string
  reasoningEffort?: string
  tools?: string[]
  timeoutSeconds?: number
}

interface SnapshotDto {
  assignments: AssignmentDto[]
  evalConfig: EvalConfigDto | null
  workspaceDir: string
  tokenConfigured: boolean
}

interface ClaimOutcomeDto {
  assignmentId: string
  dir: string
  artifacts: Array<{ label: string; path: string; bytes: number }>
  skillDir: string | null
  /** 真正的 Skill 根：模板自带顶层目录时是 `skill/<name>` */
  skillRoot: string | null
  unzipError?: string
  evalConfig: EvalConfigDto | null
}

interface SubmitOutcomeDto {
  assignmentId: string
  /** 实际被打包的 Skill 根 */
  skillRoot: string
  fileCount: number
  zipPath: string
  skillZip: { fileId: string; sha256: string }
  submission: { id: string; status: string }
}

/** host 半的错误是 `{ message }` + 非 2xx，这里还原成异常。 */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = (await res.json().catch(() => null)) as ({ message?: string } & T) | null
  if (!res.ok) {
    throw new Error(body?.message ?? `HTTP ${res.status}`)
  }
  return body as T
}

const dim = { color: 'var(--dsh-color-text-secondary, #888)' } as const
const row = {
  borderTop: '1px solid var(--dsh-color-border, #333)',
  padding: '8px 0',
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
} as const
const button = {
  cursor: 'pointer',
  padding: '2px 8px',
  fontSize: 12,
  borderRadius: 4,
  border: '1px solid var(--dsh-color-border, #555)',
  background: 'transparent',
  color: 'inherit',
} as const
const mono = { fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 11 } as const

function formatDeadline(deadline?: string | null): string | null {
  if (!deadline) return null
  const at = new Date(deadline)
  return Number.isNaN(at.getTime()) ? deadline : at.toLocaleString()
}

export function ClaimPanel() {
  const [snapshot, setSnapshot] = useState<SnapshotDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      setError(null)
      setSnapshot(await call<SnapshotDto>(ROUTES.assignments))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 领取与提交只是两个 POST，成功后统一刷新快照。 */
  const act = useCallback(
    async (assignmentId: string, action: 'claim' | 'submit') => {
      setBusy(assignmentId)
      setNotice(null)
      setError(null)
      try {
        const path = action === 'claim' ? ROUTES.claim : ROUTES.submit
        if (action === 'claim') {
          const outcome = await call<ClaimOutcomeDto>(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assignmentId }),
          })
          const parts = [`已领取 → ${outcome.dir}`]
          if (outcome.skillRoot) parts.push(`Skill 根：${outcome.skillRoot}`)
          if (outcome.unzipError) parts.push(`模板解压失败：${outcome.unzipError.split('\n')[0]}`)
          setNotice(parts.join('；'))
        } else {
          const outcome = await call<SubmitOutcomeDto>(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assignmentId }),
          })
          setNotice(
            `已提交 ${outcome.fileCount} 个文件 → submission ${outcome.submission.id}（${outcome.submission.status}）`,
          )
        }
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  const evalConfig = snapshot?.evalConfig ?? null

  return (
    <div style={{ padding: 12, fontSize: 13, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>NJU-Lab 实验任务</strong>
        <button style={button} onClick={() => void load()} disabled={busy !== null}>
          刷新
        </button>
      </div>

      {!loaded && <div style={{ ...dim, marginTop: 8 }}>加载中…</div>}

      {error && (
        <div style={{ marginTop: 8, color: 'var(--dsh-color-danger, #e66)', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ ...dim, marginTop: 8, whiteSpace: 'pre-wrap' }}>{notice}</div>
      )}

      {snapshot && !snapshot.tokenConfigured && (
        <div style={{ ...dim, marginTop: 8 }}>
          未配置平台 token，无法拉取任务。请设置环境变量 <code style={mono}>NJU_LAB_TOKEN</code>
          （平台个人页生成）后重启 DSH。
        </div>
      )}

      {snapshot &&
        snapshot.assignments.map((a) => {
          const deadline = formatDeadline(a.project?.deadline)
          const isBusy = busy === a.id
          return (
            <div key={a.id} style={row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  {a.unlocked ? '🔓' : '🔒'} {a.project?.title ?? '(未命名)'}
                  <span style={{ ...dim, marginLeft: 6 }}>{a.status}</span>
                </div>
                {a.project?.chapterTitle && (
                  <div style={{ ...dim, marginTop: 2 }}>{a.project.chapterTitle}</div>
                )}
                {deadline && <div style={dim}>截止 {deadline}</div>}
                {a.submission && (
                  <div style={dim}>
                    最近提交 {a.submission.status}
                    {a.submission.submittedAt
                      ? ` · ${formatDeadline(a.submission.submittedAt)}`
                      : ''}
                  </div>
                )}
                <div style={{ ...mono, ...dim, marginTop: 2 }}>{a.id}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  style={button}
                  disabled={isBusy || !a.unlocked || !snapshot.tokenConfigured}
                  onClick={() => void act(a.id, 'claim')}
                >
                  领取
                </button>
                <button
                  style={button}
                  disabled={isBusy || !a.unlocked || !snapshot.tokenConfigured}
                  onClick={() => void act(a.id, 'submit')}
                >
                  提交
                </button>
              </div>
            </div>
          )
        })}

      {snapshot && snapshot.tokenConfigured && !snapshot.assignments.length && (
        <div style={{ ...dim, marginTop: 8 }}>（没有分配给你的任务）</div>
      )}

      {evalConfig && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--dsh-color-border, #333)', paddingTop: 8 }}>
          <div style={{ ...dim, marginBottom: 2 }}>已钉定的评估条件</div>
          <div style={mono}>
            model={evalConfig.model ?? '(默认)'} · effort={evalConfig.reasoningEffort ?? '(默认)'}
            <br />
            tools=[{(evalConfig.tools ?? []).join(', ')}] · timeout=
            {evalConfig.timeoutSeconds ?? '(无)'}s
          </div>
        </div>
      )}

      {snapshot && (
        <div style={{ ...mono, ...dim, marginTop: 12 }}>workspace: {snapshot.workspaceDir}</div>
      )}
    </div>
  )
}
