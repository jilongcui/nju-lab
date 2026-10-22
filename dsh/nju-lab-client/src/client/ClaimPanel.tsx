/**
 * NJU-Lab 任务面板。
 *
 * 数据来源：**host 半注册的同源路由**（见 `src/host/panel.ts` 的 PANEL_ROUTES）。
 * 组件拿不到 `ctx`，所以不走 cordis 服务；但也不需要 —— 平台 token 留在 host 半，
 * 这里只做同源 `fetch`，浏览器里看不到任何凭据。
 *
 * 与对话式工具的关系：两者共用 `src/host/actions.ts` 的一份实现，行为一致。
 *
 * 交互规则（与 host 半的能力对齐，避免学生点到必然失败的按钮）：
 *  - 未解锁 / 未配置 token → 领取与提交都禁用，并说明原因；
 *  - 已领取且材料在本地 → 领取禁用，提交才是可用动作；
 *  - 已领取（含已提交）但本地没有材料（换机/清理）→ 领取变成「重新下载」——
 *    平台对 claimed/submitted 的 claim 都幂等重发材料，不影响提交记录；
 *  - 未领取 → 提交禁用（平台会 400「请先领取任务再提交」）。
 *
 * 2026-10-17 两条口径（用户明确）：
 *  - **列表只列已领取**（claimed / submitted）：未领取的实验不进列表，只在底部留一行
 *    「另有 N 个未领取」。学生身上可能有十几个待领取任务，面板要回答的是"我正在做哪几个"。
 *  - **打开面板即材料化**：状态已 claimed/submitted 但本地工作区没有材料的任务，挂在
 *    面板上就自动下发一次（平台对这两态的 claim 是幂等重发，不改状态、不动提交记录）。
 *    学生在平台上领完实验、进 DSH 就已在环境里，不必再点一次；失败才退回手动「重新下载」。
 *
 * 每次动作的结果（成功 / 失败）渲染成可关闭的横幅，并把 host 半返回的结构化细节
 * （落盘路径、Skill 根、文件哈希、submission id）摊开 —— 出问题时要能自己看出
 * 是"没找到 SKILL.md"还是"哈希不符"，而不是只得到一句 502。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { pendingAutoMaterialize, pendingCount, visibleAssignments } from './panel-logic.ts'

const ROUTES = {
  assignments: '/api/nju-lab.assignments',
  claim: '/api/nju-lab.claim',
  submit: '/api/nju-lab.submit',
  update: '/api/nju-lab.update',
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
  version?: number
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
  /** 本地已落盘材料的任务 id；claimed 但不在此列 → 提供「重新下载」。 */
  downloaded: string[]
  evalConfig: EvalConfigDto | null
  workspaceDir: string
  tokenConfigured: boolean
  /** 当前钉定条件来自哪个任务（重启后从工作区恢复的也会带上）。 */
  pinnedFrom?: string
  /** 插件自更新信息；null 表示检查失败（不渲染更新条）。 */
  update: { current: string | null; latest: string; available: boolean } | null
  /** 学员模式进度（只有走过步骤的任务才有） */
  guides?: Record<string, { step: number; total: number; title: string; kind: string }>
}

interface ArtifactDto {
  /** `skillTemplate` | `problem` */
  label: string
  originalName: string
  path: string
  bytes: number
  sha256?: string
}

interface ClaimOutcomeDto {
  assignmentId: string
  dir: string
  artifacts: ArtifactDto[]
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
  capsule: { fileId: string; sha256: string }
  submission: { id: string; status: string }
  /** 实验报告检查（host 半与平台复验同口径；只警告不阻断提交） */
  report?: {
    reportComplete: boolean
    pitfallsRecorded: number
    /** 报告是从哪个文件读到的（report.md / 旧 dossier.md / 旧 SKILL.md） */
    reportSource?: 'report.md' | 'dossier.md' | 'SKILL.md' | 'none'
    warnings: string[]
  }
}

/** 一次动作的结果。成功与失败分开渲染，且可关闭。 */
interface Banner {
  kind: 'ok' | 'error'
  title: string
  details: string[]
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
const linkButton = {
  ...button,
  border: 'none',
  textDecoration: 'underline',
  padding: 0,
} as const
const mono = { fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 11 } as const
const small = { fontSize: 11 } as const

const LABELS = { skillTemplate: '模板', problem: '题目包' } as const
const STATUS_LABELS: Record<string, string> = {
  pending: '未领取',
  claimed: '已领取',
  submitted: '已提交',
}

function formatDeadline(deadline?: string | null): string | null {
  if (!deadline) return null
  const at = new Date(deadline)
  return Number.isNaN(at.getTime()) ? deadline : at.toLocaleString()
}

function isOverdue(deadline?: string | null): boolean {
  if (!deadline) return false
  const at = new Date(deadline)
  return !Number.isNaN(at.getTime()) && at.getTime() < Date.now()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

/** 哈希只显示前 12 位：够人肉比对，又不至于把面板撑爆。 */
function shortHash(hash?: string): string {
  return hash ? `${hash.slice(0, 12)}…` : '(未知)'
}

function statusText(status: string): string {
  return STATUS_LABELS[status] ?? status
}

function Banner({ banner, onClose }: { banner: Banner; onClose: () => void }) {
  const danger = banner.kind === 'error'
  return (
    <div
      style={{
        marginTop: 8,
        padding: '6px 8px',
        borderRadius: 4,
        border: `1px solid ${danger ? 'var(--dsh-color-danger, #e66)' : 'var(--dsh-color-border, #333)'}`,
        color: danger ? 'var(--dsh-color-danger, #e66)' : 'inherit',
        whiteSpace: 'pre-wrap',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <strong style={{ flex: 1, ...small }}>{banner.title}</strong>
        <button style={linkButton} onClick={onClose} title="关闭">
          关闭
        </button>
      </div>
      {banner.details.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 16, ...mono, ...dim }}>
          {banner.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ClaimPanel({ getSessionId }: { getSessionId?: () => string | undefined }) {
  const [snapshot, setSnapshot] = useState<SnapshotDto | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  /** 自动材料化是否在跑：跑的时候把按钮按下去，免得学生和你抢同一次下载。 */
  const [autoBusy, setAutoBusy] = useState(false)
  /**
   * 本次挂载里自动试过的任务 id。
   *
   * 只活在这一个组件实例里：面板挂载 = 进入某个会话，换会话重新挂载就再试一次
   * （那时工作区也换了，本来就该重新判断）。记录它是因为「失败」也要算试过 ——
   * 否则快照刷新 → effect 重跑 → 再失败，会变成静默的重试循环。
   */
  const autoTried = useRef<Set<string>>(new Set())
  /** 是否展开未领取的实验（默认收起 —— 面板只回答"我正在做哪几个"）。 */
  const [showPending, setShowPending] = useState(false)

  const load = useCallback(async () => {
    try {
      // 带上当前会话 id：host 按会话工作区判断本地材料与落盘目录
      const sessionId = getSessionId?.()
      const url = sessionId
        ? `${ROUTES.assignments}?sessionId=${encodeURIComponent(sessionId)}`
        : ROUTES.assignments
      setSnapshot(await call<SnapshotDto>(url))
    } catch (e) {
      setBanner({
        kind: 'error',
        title: '拉取任务列表失败',
        details: [e instanceof Error ? e.message : String(e)],
      })
    } finally {
      setLoaded(true)
    }
  }, [getSessionId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 打开面板就把已领取实验的材料补到工作区（口径见文件头）。
   *
   * 串行而不是 `Promise.all`：一次开面板可能要补好几个实验，并行会把带宽和平台
   * 下载路径同时打满，而且失败时横幅里说不清是哪一份先坏的。数量本来就不多
   * （一个学生同时在做的一般 1–3 个），串行的体感代价可以接受。
   */
  const autoMaterialize = useCallback(
    async (snap: SnapshotDto) => {
      const targets = pendingAutoMaterialize(
        snap.assignments,
        snap.downloaded ?? [],
        autoTried.current,
      )
      if (targets.length === 0) return
      const sessionId = getSessionId?.()
      // 面板挂在会话上：会话还没选中时干脆不下发 —— 否则材料会落到进程启动目录，
      // 而不是这个会话的工作区，学生之后在会话里找不到它。这时不记 autoTried，
      // 但本组件也不订阅会话选中，所以实际表现是"这次不自动，学生手动点一下"。
      if (getSessionId && !sessionId) return
      for (const target of targets) autoTried.current.add(target.id)
      const details: string[] = []
      let failed = 0
      setAutoBusy(true)
      setBanner(null)
      for (const target of targets) {
        try {
          const outcome = await call<ClaimOutcomeDto>(ROUTES.claim, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assignmentId: target.id, sessionId }),
          })
          details.push(`${target.project?.title ?? target.id}：已下发到 ${outcome.dir}`)
          if (outcome.unzipError) {
            details.push(`⚠ 模板解压失败（ZIP 已落盘，可手动处理）：${outcome.unzipError.split('\n')[0]}`)
          }
        } catch (e) {
          failed += 1
          details.push(
            `${target.project?.title ?? target.id}：下发失败 —— ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
      setAutoBusy(false)
      setBanner({
        kind: failed > 0 ? 'error' : 'ok',
        title:
          failed > 0
            ? `${failed} 个已领取实验的材料没下发成功，可在列表里点「重新下载」重试`
            : '已自动下发已领取实验的材料（平台幂等重发，不影响提交记录）',
        details,
      })
      // 刷新快照：downloaded 与钉定条件都会变
      await load()
    },
    [getSessionId, load],
  )

  // 依赖 snapshot 对象：每次 load 都换新对象 → effect 重跑，但 autoTried 已经把
  // 试过的 id 记下，缺材料的集合为空时立即返回（不会自激）。`busy` 也进依赖：
  // 学生正在手动领取/提交时不抢同一次下载；手动动作结束后 busy 回 null，effect
  // 重跑一次，把剩下真正缺材料的任务补上。
  useEffect(() => {
    if (!snapshot || !snapshot.tokenConfigured) return
    if (busy !== null) return
    void autoMaterialize(snapshot)
  }, [snapshot, busy, autoMaterialize])

  /** 领取与提交只是两个 POST，成功后统一刷新快照。 */
  const act = useCallback(
    async (assignmentId: string, action: 'claim' | 'submit') => {
      setBusy(assignmentId)
      setBanner(null)
      const sessionId = getSessionId?.()
      try {
        if (action === 'claim') {
          const outcome = await call<ClaimOutcomeDto>(ROUTES.claim, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assignmentId, sessionId }),
          })
          const details = [`落盘目录：${outcome.dir}`]
          for (const artifact of outcome.artifacts) {
            details.push(
              `${LABELS[artifact.label as keyof typeof LABELS] ?? artifact.label}：` +
                `${artifact.originalName}（${formatBytes(artifact.bytes)}）→ ${artifact.path}`,
            )
          }
          if (outcome.skillRoot) details.push(`Skill 根：${outcome.skillRoot}`)
          if (outcome.unzipError) {
            details.push(
              `⚠ 模板解压失败（ZIP 已落盘，可手动处理）：${outcome.unzipError.split('\n')[0]}`,
            )
          }
          setBanner({ kind: 'ok', title: '领取完成', details })
        } else {
          const outcome = await call<SubmitOutcomeDto>(ROUTES.submit, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assignmentId, sessionId }),
          })
          const docWarnings = outcome.report?.warnings ?? []
          setBanner({
            kind: 'ok',
            title: `提交成功：submission ${outcome.submission.id}（${statusText(outcome.submission.status)}）`,
            details: [
              `打包 ${outcome.fileCount} 个文件，Skill 根：${outcome.skillRoot}`,
              `skill.zip sha256：${shortHash(outcome.skillZip.sha256)}`,
              `evidence.dshc sha256：${shortHash(outcome.capsule.sha256)}`,
              `本地产物：${outcome.zipPath}`,
              // 提交成功但过程记录还空着 —— 平台复验会扣分，这里当场说清楚
              ...(docWarnings.length
                ? ['⚠ 实验报告还没填完（提交本身已成功，过程分会从 20 降到 10）：', ...docWarnings]
                : []),
            ],
          })
        }
        await load()
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setBanner({
          kind: 'error',
          title: action === 'claim' ? '领取失败' : '提交失败',
          details: [message],
        })
      } finally {
        setBusy(null)
      }
    },
    [load, getSessionId],
  )

  const evalConfig = snapshot?.evalConfig ?? null
  const tokenConfigured = snapshot?.tokenConfigured ?? false
  /** 列表内容：默认只有已领取的实验；`showPending` 是学生自己按开的口子。 */
  const listed = !snapshot
    ? []
    : showPending
      ? snapshot.assignments
      : visibleAssignments(snapshot.assignments)
  const pendingTotal = snapshot ? pendingCount(snapshot.assignments) : 0

  /** 插件自更新：host 拉平台安装包覆盖插件目录，重启 dsh 生效。 */
  const doUpdate = async () => {
    setBusy('__update__')
    setBanner(null)
    try {
      const outcome = await call<{ message: string }>(ROUTES.update, { method: 'POST' })
      setBanner({ kind: 'ok', title: '插件已更新', details: [outcome.message] })
    } catch (e) {
      setBanner({
        kind: 'error',
        title: '更新失败',
        details: [e instanceof Error ? e.message : String(e)],
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ padding: 12, fontSize: 13, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>NJU-Lab 实验任务</strong>
        <button
          style={button}
          onClick={() => void load()}
          disabled={busy !== null}
          title="重新拉取任务与钉定条件"
        >
          {busy !== null ? '刷新中…' : '刷新'}
        </button>
      </div>

      {!loaded && <div style={{ ...dim, marginTop: 8 }}>加载中…</div>}

      {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}

      {autoBusy && (
        <div style={{ ...dim, marginTop: 8 }}>正在把已领取实验的材料下发到工作区…</div>
      )}

      {snapshot?.update?.available && (
        <div
          style={{
            ...row,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div>
            发现新版本插件 <b>{snapshot.update.latest}</b>
            <span style={dim}>（当前 {snapshot.update.current ?? '未知'}）</span>
          </div>
          <button
            style={button}
            disabled={busy !== null}
            title="从平台下载最新插件并覆盖本地安装，重启 dsh 后生效"
            onClick={() => void doUpdate()}
          >
            {busy === '__update__' ? '更新中…' : '立即更新'}
          </button>
        </div>
      )}

      {snapshot && !tokenConfigured && (
        <div style={{ ...dim, marginTop: 8 }}>
          未配置平台 token，无法拉取任务。二选一：在 <b>DSH 设置页 → 插件 → nju-lab</b> 填
          <code style={mono}>serverUrl</code> 与 <code style={mono}>token</code>，或设置环境变量{' '}
          <code style={mono}>NJU_LAB_TOKEN</code>。token 在平台个人页「API Token」弹窗生成。
        </div>
      )}

      {snapshot &&
        listed.map((a) => {
          const deadline = formatDeadline(a.project?.deadline)
          const overdue = isOverdue(a.project?.deadline)
          const claimed = a.status !== 'pending'
          const localReady = snapshot.downloaded?.includes(a.id) ?? false
          // 重新下载开放给 claimed 与 submitted：平台对两者的 claim 都幂等重发材料
          const canRedownload = claimed && !localReady
          const isBusy = busy === a.id
          const blocked = !a.unlocked || !tokenConfigured
          return (
            <div key={a.id} style={row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  {a.unlocked ? '🔓' : '🔒'} {a.project?.title ?? '(未命名)'}
                  <span style={{ ...dim, marginLeft: 6 }}>{statusText(a.status)}</span>
                </div>
                {a.project?.chapterTitle && (
                  <div style={{ ...dim, marginTop: 2 }}>{a.project.chapterTitle}</div>
                )}
                {/* 学员模式：面板上能直接看到"做到第几步"，不用回对话里问 */}
                {snapshot?.guides?.[a.id] && (
                  <div style={{ ...dim, marginTop: 2 }}>
                    学员模式 · 第 {snapshot.guides[a.id].step}/{snapshot.guides[a.id].total} 步：
                    {snapshot.guides[a.id].title}
                  </div>
                )}
                {deadline && (
                  <div style={overdue ? { color: 'var(--dsh-color-danger, #e66)' } : dim}>
                    截止 {deadline}
                    {overdue ? '（已过期）' : ''}
                  </div>
                )}
                {a.submission && (
                  <div style={dim}>
                    最近提交 {a.submission.version ? `v${a.submission.version} · ` : ''}
                    {statusText(a.submission.status)}
                    {a.submission.submittedAt ? ` · ${formatDeadline(a.submission.submittedAt)}` : ''}
                  </div>
                )}
                {claimed && !localReady && (
                  <div style={{ ...dim, marginTop: 2 }}>本地没有领取材料（换机或已清理）</div>
                )}
                <div style={{ ...mono, ...dim, marginTop: 2 }}>{a.id}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  style={button}
                  disabled={isBusy || blocked || autoBusy || (claimed && !canRedownload)}
                  title={
                    !a.unlocked
                      ? '尚未满足解锁条件，暂时不能领取'
                      : canRedownload
                        ? '重新下载模板与题目包（平台幂等重发材料，不影响提交记录），并钉死评估条件'
                        : claimed
                          ? '已领取，材料在工作区 nju-lab/ 下'
                          : '下载模板与题目包，并钉死评估条件'
                  }
                  onClick={() => void act(a.id, 'claim')}
                >
                  {isBusy ? '处理中…' : canRedownload ? '重新下载' : claimed ? '已领取' : '领取'}
                </button>
                <button
                  style={button}
                  disabled={isBusy || blocked || autoBusy || !claimed}
                  title={
                    claimed
                      ? a.submission
                        ? '打包 Skill 目录、生成 .dshc 并提交为新版本（历史版本保留，独立复验评分）'
                        : '打包 Skill 目录、生成 .dshc 并提交'
                      : '请先领取任务再提交'
                  }
                  onClick={() => void act(a.id, 'submit')}
                >
                  {isBusy ? '处理中…' : a.submission ? '提交新版本' : '提交'}
                </button>
              </div>
            </div>
          )
        })}

      {snapshot && tokenConfigured && !listed.length && (
        <div style={{ ...dim, marginTop: 8 }}>
          {snapshot.assignments.length === 0
            ? '（没有分配给你的任务）'
            : '还没有已领取的实验。'}
        </div>
      )}

      {/* 未领取的不进列表（口径见文件头）：这里只留一行汇总 + 学生自己按开的入口 */}
      {snapshot && tokenConfigured && pendingTotal > 0 && (
        <div style={{ ...dim, marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>另有 {pendingTotal} 个未领取的实验（领取后出现在这里）</span>
          <button
            style={linkButton}
            disabled={busy !== null}
            title={showPending ? '只显示已领取的实验' : '临时展开未领取的实验（可在这里领取）'}
            onClick={() => setShowPending((value) => !value)}
          >
            {showPending ? '收起' : '显示'}
          </button>
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          borderTop: '1px solid var(--dsh-color-border, #333)',
          paddingTop: 8,
        }}
      >
        <div style={{ ...dim, marginBottom: 2 }}>
          评估条件
          {snapshot?.pinnedFrom
            ? `（来自任务 ${snapshot.pinnedFrom}，DSH 重启后仍生效）`
            : '（领取后由平台钉定）'}
        </div>
        {evalConfig ? (
          <div style={mono}>
            model={evalConfig.model ?? '(默认)'} · effort={evalConfig.reasoningEffort ?? '(默认)'}
            <br />
            tools=[{(evalConfig.tools ?? []).join(', ')}] · timeout=
            {evalConfig.timeoutSeconds ?? '(无)'}s
          </div>
        ) : (
          <div style={{ ...dim, ...small }}>还没有领取任务，或平台未下发条件。</div>
        )}
      </div>

      {snapshot && (
        <div style={{ ...mono, ...dim, marginTop: 12 }}>workspace: {snapshot.workspaceDir}</div>
      )}
    </div>
  )
}
