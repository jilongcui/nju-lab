/**
 * 证据采集：把学生的**会话审计事件**导出、脱敏、打包成 `.dshc`（dsh capsule）。
 *
 * 背景（`nju-lab-client-design.md` §4）：`.dshc` **不是** DSH 的标准格式 ——
 * `@deepseek-ai/` 下没有任何 `*capsule*` 包，craft 文档里的 "dsh-capsule" 在 npm 上
 * 不存在，所以这一步是自研的。可用的构件是真实存在的两个包：
 *  - `@deepseek-ai/dsh-session-persistence`（`ctx.sessionPersistence`，逐会话追加日志）
 *  - `@deepseek-ai/dsh-session-log-export`（会话日志导出）
 *
 * 它存在的理由是 craft §4 的一句话："**`.dshc` 完整性哈希 + 审计事件用于印证过程
 * 真实性**" —— 分数可以靠服务端复验重算，但"这个 Skill 是学生自己一步步调出来的"
 * 这件事没法重放，只能靠留存的过程证据。
 */
import { createHash } from 'node:crypto'

import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * 进证据包的会话事件前缀。
 *
 * craft 说的是"approval 对、permission/preset 提权日志"，对应 DSH 里真实的事件名：
 * `approval/asked`、`approval/decided`、`approval/policy`、`approval/request`、
 * `permission/preset`。用**前缀**而不是白名单，将来 DSH 加同类事件能自动纳入。
 */
const AUDIT_EVENT_PREFIXES = ['approval/', 'permission/'] as const

/** 脱敏上限：证据包要能被人读，但不该夹带整段对话内容。 */
const MAX_STRING = 200
const MAX_ARRAY = 50
const MAX_DEPTH = 6

export interface AuditEvent {
  type: string
  seq: number
  time: number
  /** 脱敏后的 data */
  data: unknown
}

/** 一个被纳入证据的会话。 */
export interface EvidenceSession {
  id: string
  cwd: string
  eventCount: number
}

export interface Capsule {
  /** 证据包格式版本 */
  format: 'nju-lab.capsule/v1'
  createdAt: string
  /** 证据来源（哪些会话、各有多少事件），便于服务端判断覆盖面 */
  sessions: EvidenceSession[]
  /** 脱敏后的审计事件（approval 对、permission/preset 提权） */
  auditEvents: AuditEvent[]
  /** 证据包完整性哈希：对 sessions + auditEvents 一起算 */
  integrity: string
  /** 降级原因（如采集失败 / 未接持久化服务），不参与哈希 */
  note?: string
}

/**
 * 递归脱敏：截断超长字符串、限制数组长度与递归深度。
 *
 * 审计事件本身就该只含"谁批准了什么工具"这类结构信息，但 `data` 是开放对象，
 * 所以这里做一次防御性收窄 —— 宁可少留，也不要把对话原文带进证据包。
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[deep]'
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
  }
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1))
    return value.length > MAX_ARRAY ? [...kept, `[+${value.length - MAX_ARRAY} more]`] : kept
  }
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redact(item, depth + 1)
  }
  return out
}

/** 该事件是否属于"过程真实性"证据。 */
export function isAuditEvent(type: string): boolean {
  return AUDIT_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix))
}

/** 把一个会话的事件筛成审计事件。 */
export function toAuditEvents(events: readonly SessionEvent[]): AuditEvent[] {
  const out: AuditEvent[] = []
  for (const event of events) {
    if (!isAuditEvent(event.type)) continue
    out.push({
      type: event.type,
      seq: event.seq,
      time: event.time,
      data: redact(event.data),
    })
  }
  return out
}

/**
 * 按工作目录收集会话证据。
 *
 * 用 `cwd` 而不是"当前会话"：学生的开发过程通常跨多个会话（反复开 DSH），
 * 只取最后一次会漏掉大部分过程。cwd 相同的会话就是这个项目里的会话。
 */
export async function collectEvidence(
  persistence: SessionPersistence,
  workspaceDir: string,
): Promise<{ sessions: EvidenceSession[]; auditEvents: AuditEvent[] }> {
  const snapshots = await persistence.list()
  const sessions: EvidenceSession[] = []
  const auditEvents: AuditEvent[] = []

  for (const snapshot of snapshots) {
    if (snapshot.header.cwd !== workspaceDir) continue

    const handle = await persistence.open(snapshot.header.id, 'read')
    try {
      const { events } = await handle.read()
      const audits = toAuditEvents(events)
      sessions.push({
        id: snapshot.header.id,
        cwd: snapshot.header.cwd,
        eventCount: events.length,
      })
      auditEvents.push(...audits)
    } finally {
      await handle.close()
    }
  }

  // 稳定顺序：先按时间、再按会话与 seq，保证同样的输入产出同样的字节
  auditEvents.sort((a, b) => a.time - b.time || a.seq - b.seq)
  return { sessions, auditEvents }
}

/**
 * 打包 capsule。`integrity` 覆盖 sessions 与 auditEvents，任一处被改都会变。
 * `note` 只说明降级原因，不参与哈希。
 */
export function buildCapsule(
  sessions: EvidenceSession[],
  auditEvents: AuditEvent[],
  note?: string,
): Capsule {
  const payload = JSON.stringify({ sessions, auditEvents })
  return {
    format: 'nju-lab.capsule/v1',
    createdAt: new Date().toISOString(),
    sessions,
    auditEvents,
    integrity: createHash('sha256').update(payload).digest('hex'),
    ...(note ? { note } : {}),
  }
}
