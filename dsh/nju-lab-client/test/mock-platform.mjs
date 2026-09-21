/**
 * 最小 NJU-Lab 平台替身，供 client 独立测试使用。
 *
 * **契约以 `REQ-2026-09-21-submit-pipeline.md` §0 为准**（那份文档是从真实
 * server 的 curl 实测得来的），不要照 client 的类型声明反推 —— 之前的版本就是
 * 照 client 写的，结果把一处契约漂移固化成了"通过的测试"。
 *
 * 覆盖的端点：
 *   GET  /api/me/assignments        任务列表（嵌套 project 对象）
 *   POST /api/assignments/:id/claim 领取（下发 skillTemplate/testDataset + evalConfig）
 *   POST /api/files                 multipart 上传（字段名 file，服务端算 sha256）
 *   GET  /api/files/:id             下载（UUID 即能力凭证）
 *   POST /api/assignments/:id/submit 提交（fileId 模式）
 *
 * 所有请求都会记录到 `requests`，供断言与契约测试使用。
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

/** 最小合法空 ZIP（EOCD 记录），让 claim 的解压步骤有真实输入。 */
const EMPTY_ZIP = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
])

const DEFAULT_ASSIGNMENTS = [
  {
    id: 'a-unlocked',
    status: 'pending',
    claimedAt: null,
    unlocked: true,
    project: {
      id: 'p-1',
      title: '实验：数据清洗',
      deadline: null,
      chapterTitle: '第2章 实验',
    },
    submission: null,
  },
  {
    id: 'a-locked',
    status: 'pending',
    claimedAt: null,
    unlocked: false,
    project: {
      id: 'p-2',
      title: '实验一：CSV 数据清洗 Skill',
      deadline: '2026-12-31T15:59:59.000Z',
      chapterTitle: '第 2 章：实验一',
    },
    submission: null,
  },
]

/**
 * 平台下发的评估条件：真实字段是 model / reasoningEffort / tools / timeoutSeconds。
 *
 * 取值与**真实平台**对齐（`experiment_projects.evalConfig`）：`model` 用 DSH 默认的
 * `deepseek-flash`，且**不带** `reasoningEffort` —— deepseek-official 不支持推理档位，
 * 带上会让 DSH 在 claim 之后每个请求都抛 UNSUPPORTED_REASONING_EFFORT。
 */
const DEFAULT_EVAL_CONFIG = {
  model: 'deepseek-flash',
  tools: ['shell'],
  timeoutSeconds: 600,
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function readRaw(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** 用 undici 的 Request 解析 multipart，拿到字段名 `file` 的内容。 */
async function parseMultipart(req) {
  const request = new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: req.headers,
    body: Readable.toWeb(req),
    duplex: 'half',
  })
  const form = await request.formData()
  const file = form.get('file')
  if (!file || typeof file === 'string') return null
  return {
    originalName: file.name || 'unnamed',
    mimeType: file.type || 'application/octet-stream',
    buf: Buffer.from(await file.arrayBuffer()),
  }
}

/**
 * @param {{
 *   token?: string,
 *   assignments?: unknown[],
 *   evalConfig?: object | null,
 *   skillTemplate?: Buffer,
 *   testDataset?: Buffer,
 * }} [options]
 */
export async function startMockPlatform(options = {}) {
  const token = options.token ?? 'test-token'
  const evalConfig = options.evalConfig === undefined ? DEFAULT_EVAL_CONFIG : options.evalConfig
  const skillTemplateBuf = options.skillTemplate ?? EMPTY_ZIP
  const testDatasetBuf = options.testDataset ?? EMPTY_ZIP

  /** fileId → { buf, originalName, mimeType, sha256, uploaderId } */
  const files = new Map()
  /**
   * 记录到的请求。注意 `path` 已剥离 `/api` 前缀 —— 它是 mock 内部的路由路径
   * （例如 `/me/assignments`、`/files`），断言时按这个口径写。
   * @type {Array<{method:string,path:string,auth:string,body:any}>}
   */
  const requests = []
  /** @type {Array<object>} */
  const submissions = []
  const assignments = structuredClone(options.assignments ?? DEFAULT_ASSIGNMENTS)

  function storeFile({ buf, originalName, mimeType }, uploaderId) {
    const fileId = `file-${files.size + 1}-${sha256(buf).slice(0, 8)}`
    const record = { buf, originalName, mimeType, sha256: sha256(buf), uploaderId }
    files.set(fileId, record)
    return {
      fileId,
      url: `/api/files/${fileId}`,
      originalName,
      size: buf.length,
      sha256: record.sha256,
    }
  }

  const templateId = 'file-template'
  const datasetId = 'file-dataset'
  files.set(templateId, {
    buf: skillTemplateBuf,
    originalName: 'template.zip',
    mimeType: 'application/zip',
    sha256: sha256(skillTemplateBuf),
    uploaderId: 'teacher',
  })
  files.set(datasetId, {
    buf: testDatasetBuf,
    originalName: 'dataset.zip',
    mimeType: 'application/zip',
    sha256: sha256(testDatasetBuf),
    uploaderId: 'teacher',
  })

  const info = (fileId) => {
    const f = files.get(fileId)
    return f
      ? {
          fileId,
          url: `/api/files/${fileId}`,
          originalName: f.originalName,
          size: f.buf.length,
          sha256: f.sha256,
        }
      : null
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname.replace(/^\/api/, '')
    const method = req.method ?? 'GET'
    const auth = String(req.headers['authorization'] ?? '')

    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    const ok = (data) => send(200, { code: 0, data, message: 'ok' })
    // 真实平台是 NestJS：`@Post` 且没有 `@HttpCode` → 201 Created。
    // claim / submit 两个端点照此返回，别让替身的状态码漂移固化成"通过的测试"。
    const created = (data) => send(201, { code: 0, data, message: 'ok' })
    const fail = (status, message) => send(status, { code: status, data: null, message })

    // 下载是二进制流，不走 JSON 包装
    const downloadMatch = /^\/files\/([^/]+)$/.exec(path)
    if (method === 'GET' && downloadMatch) {
      requests.push({ method, path, auth, body: null })
      if (auth !== `Bearer ${token}`) return fail(401, 'unauthorized')
      const file = files.get(downloadMatch[1])
      if (!file) return fail(404, '文件不存在')
      res.writeHead(200, {
        'content-type': file.mimeType,
        'content-length': String(file.buf.length),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      })
      res.end(file.buf)
      return
    }

    // 上传是 multipart，也不走 JSON 请求解析
    if (method === 'POST' && path === '/files') {
      if (auth !== `Bearer ${token}`) {
        requests.push({ method, path, auth, body: '(multipart)' })
        return fail(401, 'unauthorized')
      }
      const parsed = await parseMultipart(req)
      requests.push({
        method,
        path,
        auth,
        body: parsed ? { field: 'file', originalName: parsed.originalName, size: parsed.buf.length } : null,
      })
      if (!parsed) return fail(400, '缺少 file 字段')
      return ok(storeFile(parsed, 'student-1'))
    }

    const raw = await readRaw(req)
    let body = null
    if (raw.length) {
      try {
        body = JSON.parse(raw.toString('utf8'))
      } catch {
        body = raw.toString('utf8')
      }
    }
    requests.push({ method, path, auth, body })

    if (auth !== `Bearer ${token}`) return fail(401, 'unauthorized')

    if (method === 'GET' && path === '/me') {
      return ok({ id: 'student-1', username: 'student1', role: 'student' })
    }
    if (method === 'GET' && path === '/me/courses') return ok([])
    if (method === 'GET' && path === '/me/assignments') return ok(assignments)

    const claimMatch = /^\/assignments\/([^/]+)\/claim$/.exec(path)
    if (method === 'POST' && claimMatch) {
      const assignment = assignments.find((a) => a.id === claimMatch[1])
      if (!assignment) return fail(404, '任务不存在')
      if (!assignment.unlocked) return fail(403, '尚未满足解锁条件')
      assignment.status = 'claimed'
      assignment.claimedAt = new Date().toISOString()
      return created({
        assignment,
        skillTemplate: info(templateId),
        testDataset: info(datasetId),
        evalConfig,
      })
    }

    const submitMatch = /^\/assignments\/([^/]+)\/submit$/.exec(path)
    if (method === 'POST' && submitMatch) {
      const assignmentId = submitMatch[1]
      const assignment = assignments.find((a) => a.id === assignmentId)
      if (!assignment) return fail(404, '任务不存在')
      if (assignment.status === 'pending') return fail(400, '请先领取任务再提交')

      const skillZip = files.get(body?.skillZipFileId)
      const capsule = files.get(body?.capsuleFileId)
      if (!skillZip) return fail(400, 'Skill 包缺失')
      if (!capsule) return fail(400, '证据包（.dshc）缺失')

      const submission = {
        id: `submission-${submissions.length + 1}`,
        assignmentId,
        skillZipRef: `file:${body.skillZipFileId}`,
        skillZipSha256: skillZip.sha256,
        capsuleRef: `file:${body.capsuleFileId}`,
        capsuleSha256: capsule.sha256,
        auditEvents: body.auditEvents ?? null,
        fileHashes: body.fileHashes ?? null,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
      }
      submissions.push(submission)
      assignment.status = 'submitted'
      assignment.submission = {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt,
      }
      return created(submission)
    }

    return fail(404, `no mock route for ${method} ${path}`)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}/api`,
    token,
    requests,
    submissions,
    files,
    reset() {
      requests.length = 0
    },
    close() {
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
