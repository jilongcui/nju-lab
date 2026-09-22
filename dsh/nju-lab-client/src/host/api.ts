import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import type { Config, EvalConfig } from './config.ts'

/**
 * 平台文件信息。对应 server/src/files/files.service.ts 的 `StoredFileInfo`。
 * `sha256` 是**服务端计算的权威值**，下载后应与之比对。
 */
export interface StoredFileInfo {
  fileId: string
  /** 形如 `/api/files/<fileId>` —— 注意带站点根的 /api 前缀，不要直接拼 serverUrl */
  url: string
  originalName: string
  size: number
  sha256: string
}

/**
 * `GET /me/assignments` 的条目。
 * 真实形状见 server/src/projects/projects.service.ts:226 —— 注意是嵌套的
 * `project` 对象，**没有** `projectId`，也**没有** `unlockHint`。
 */
export interface Assignment {
  id: string
  status: 'pending' | 'claimed' | 'submitted' | string
  claimedAt?: string | null
  unlocked: boolean
  project: {
    id: string
    title: string
    deadline?: string | null
    chapterTitle?: string | null
  }
  submission?: { id: string; status: string; submittedAt: string; version?: number } | null
}

/**
 * `POST /assignments/:id/claim` 的响应（server/src/projects/projects.service.ts:276）。
 * 注意：旧的 `templateUrl` / `datasetUrl` 字符串字段**已不存在**。
 */
export interface ClaimResult {
  assignment: { id: string; projectId?: string; status: string } & Record<string, unknown>
  skillTemplate: StoredFileInfo | null
  testDataset: StoredFileInfo | null
  evalConfig: EvalConfig | null
}

/**
 * `POST /assignments/:id/submit` 的请求体（fileId 模式，推荐）。
 * 见 REQ-2026-09-21 §0.3：文件须本人上传，否则 403；服务端 sha256 为准。
 */
export interface SubmitPayload {
  skillZipFileId?: string
  capsuleFileId?: string
  auditEvents?: unknown[]
  fileHashes?: Record<string, string>
}

/** 未配置 token 时的提示：告诉学生"去哪拿、写在哪"。 */
const MISSING_TOKEN_HINT = [
  '未配置平台 token，无法访问 NJU-Lab 平台。',
  'token 由平台个人页生成（长期 token 接口），拿到后二选一：',
  '① 在 DSH 运行环境里设置环境变量 NJU_LAB_TOKEN；② 填进本插件的 token 配置项。',
].join(' ')

/** 有 token 但被平台拒绝时的提示。 */
function rejectedTokenHint(path: string): string {
  return (
    `平台拒绝了当前 token（HTTP 401，${path}）：通常是已过期或被吊销。` +
    '请重新获取 token 并更新配置。'
  )
}

/**
 * 平台 API 客户端。统一 `/api` 前缀、`Authorization: Bearer <token>`、
 * 响应 `{ code, data, message }`（`code = 0` 为成功）。
 */
export class PlatformApi {
  private readonly read: () => Config

  /**
   * 传取值函数时，**每次请求都重新读** —— 用户在设置页改了 `serverUrl` / `token`
   * 会立刻生效，不必重启 DSH（settings 服务用 thunk 表达"当前权威值"）。
   */
  constructor(cfg: Config | (() => Config)) {
    this.read = typeof cfg === 'function' ? cfg : () => cfg
  }

  private get cfg(): Config {
    return this.read()
  }

  private get base(): string {
    return this.cfg.serverUrl.replace(/\/+$/, '')
  }

  private get auth(): Record<string, string> {
    return this.cfg.token ? { authorization: `Bearer ${this.cfg.token}` } : {}
  }

  /** 没有 token 就别发请求，直接给出可操作的提示。 */
  private requireToken(path: string): void {
    if (!this.cfg.token) {
      throw new Error(`${MISSING_TOKEN_HINT}（请求：${path}）`)
    }
  }

  /** 把裸 401 换成可读原因；非 401 返回 null。 */
  private rejection(status: number, path: string): Error | null {
    return status === 401 ? new Error(rejectedTokenHint(path)) : null
  }

  /** 解包统一响应；失败时抛出带平台 message 的错误。 */
  private async unpack<T>(res: Response, path: string): Promise<T> {
    const body = (await res.json().catch(() => null)) as {
      code?: number
      data?: T
      message?: string
    } | null
    if (!res.ok || (body && body.code !== undefined && body.code !== 0)) {
      throw new Error(body?.message ?? `HTTP ${res.status} ${path}`)
    }
    return body && 'data' in body ? (body.data as T) : (body as unknown as T)
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    this.requireToken(path)
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...this.auth,
        ...(init?.headers ?? {}),
      },
    })
    const rejected = this.rejection(res.status, path)
    if (rejected) throw rejected
    return this.unpack<T>(res, path)
  }

  me() {
    return this.req<{ id: string; username: string; role: string }>('/me')
  }

  myCourses() {
    return this.req<unknown[]>('/me/courses')
  }

  myAssignments() {
    return this.req<Assignment[]>('/me/assignments')
  }

  claim(assignmentId: string) {
    return this.req<ClaimResult>(`/assignments/${assignmentId}/claim`, { method: 'POST' })
  }

  submit(assignmentId: string, payload: SubmitPayload) {
    return this.req<unknown>(`/assignments/${assignmentId}/submit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  /**
   * `POST /files` —— multipart 上传（字段名 `file`，≤100MB）。
   * 返回服务端计算的 sha256，作为权威值。
   */
  async uploadFile(localPath: string, filename?: string): Promise<StoredFileInfo> {
    this.requireToken('/files')
    const buf = await readFile(localPath)
    const form = new FormData()
    form.append('file', new Blob([buf]), filename ?? basename(localPath))
    // 不要手动设置 content-type：multipart 的 boundary 由 fetch 生成
    const res = await fetch(`${this.base}/files`, {
      method: 'POST',
      headers: this.auth,
      body: form,
    })
    const rejected = this.rejection(res.status, '/files')
    if (rejected) throw rejected
    return this.unpack<StoredFileInfo>(res, '/files')
  }

  /**
   * `GET /files/:id` —— 下载到 `destPath`，并**校验 sha256**。
   * 用 `fileId` 拼路径而不是 `info.url`：后者带 `/api` 前缀，而 `base` 已包含它。
   */
  async downloadFile(
    info: StoredFileInfo,
    destPath: string,
  ): Promise<{ path: string; bytes: number; sha256: string }> {
    const path = `/files/${info.fileId}`
    this.requireToken(path)
    const res = await fetch(`${this.base}${path}`, { headers: this.auth })
    const rejected = this.rejection(res.status, path)
    if (rejected) throw rejected
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}（${info.originalName}）`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const sha256 = createHash('sha256').update(buf).digest('hex')
    if (info.sha256 && sha256 !== info.sha256) {
      throw new Error(
        `sha256 校验失败（${info.originalName}）：服务端 ${info.sha256}，实际收到 ${sha256}`,
      )
    }
    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(destPath, buf)
    return { path: destPath, bytes: buf.length, sha256 }
  }
}

/** 计算本地文件的 sha256（与平台口径一致：十六进制小写）。 */
export async function fileSha256(path: string): Promise<string> {
  const buf = await readFile(path)
  return createHash('sha256').update(buf).digest('hex')
}
