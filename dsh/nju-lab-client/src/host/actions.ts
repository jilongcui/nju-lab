/**
 * 平台动作核心：`nju_lab_*` 工具与 ClaimPanel 的 host 路由**共用这一份实现**。
 *
 * 抽出来的原因：面板和对话式工具要做同样的事（领取 = 领取 + 下载 + 校验 + 解压）。
 * 如果各写一份，两边迟早漂移。这里返回**结构化结果**，由调用方决定渲染成文本还是 JSON。
 *
 * 打包与解压都走 `./zip.ts` 的纯 JS 实现 —— 不依赖学生机器上有 `zip`/`unzip`。
 */
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { constants } from 'node:fs'

import { fileSha256, type Assignment, type PlatformApi, type StoredFileInfo } from './api.ts'
import type { EvalConfig } from './config.ts'
import { buildCapsule, type AuditEvent, type EvidenceSession } from './evidence.ts'
import { buildZip, extractZip } from './zip.ts'

/** 打包/哈希时跳过的目录（REQ-2026-09-21 §1.4）。 */
const EXCLUDED_DIRS = new Set(['node_modules', '.git'])

/** ZIP 规范用 `/` 分隔，Windows 上是 `\`。 */
const toPosix = (p: string): string => p.split(sep).join('/')

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 探测真正的 Skill 根 —— REQ-2026-09-21 §1.0 的约定，三处（claim / submit /
 * 服务端复验）必须同一语义。
 *
 * 模板 ZIP 与学生提交的 ZIP 都**允许包一层顶层目录**（`csv-cleaner/SKILL.md`），
 * 所以任何消费方都不能假定 `<dir>/SKILL.md` 存在。
 *
 * ```
 * 若 dir/SKILL.md 存在 → dir
 * 否则若 dir 下只有一个子目录且它含 SKILL.md → 该子目录
 * 否则 → 报错
 * ```
 */
export async function resolveSkillRoot(dir: string): Promise<string> {
  if (await pathExists(join(dir, 'SKILL.md'))) return dir

  const children = (await readdir(dir, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name),
  )
  if (children.length === 1 && (await pathExists(join(dir, children[0].name, 'SKILL.md')))) {
    return join(dir, children[0].name)
  }

  throw new Error(
    children.length === 1
      ? `找不到 SKILL.md：${dir} 及其唯一子目录 ${children[0].name}/ 下都没有`
      : `找不到 SKILL.md：${dir}（含 ${children.length} 个子目录，无法判断 Skill 根）`,
  )
}

export type ArtifactLabel = 'skillTemplate' | 'testDataset'

/** 一次成功落盘的文件。 */
export interface DownloadedArtifact {
  label: ArtifactLabel
  originalName: string
  path: string
  bytes: number
  sha256: string
}

export interface ClaimOutcome {
  assignmentId: string
  /** 领取物的落盘目录 `<workspaceDir>/nju-lab/<assignmentId>` */
  dir: string
  artifacts: DownloadedArtifact[]
  /** 模板解压目录（`<dir>/skill`）；无模板或解压失败时为 null */
  skillDir: string | null
  /** 真正的 Skill 根（可能是 `skill/csv-cleaner`）；无模板时为 null */
  skillRoot: string | null
  /** 模板不是合法 ZIP 等情形；ZIP 仍已落盘 */
  unzipError?: string
  evalConfig: EvalConfig | null
}

export interface SubmitOutcome {
  assignmentId: string
  /** 实际被打包的 Skill 根 */
  skillRoot: string
  fileCount: number
  zipPath: string
  skillZip: { fileId: string; sha256: string }
  capsule: { fileId: string; sha256: string }
  submission: { id: string; status: string }
}

export interface NjuLabActions {
  readonly workspaceRoot: string
  /** 领取物落盘与打包产物的目录。 */
  assignmentDir(assignmentId: string): string
  /** 当前钉定的评估条件（claim 后写入；供面板显示锁定状态）。 */
  currentEvalConfig(): EvalConfig | undefined
  listAssignments(): Promise<Assignment[]>
  claimAssignment(assignmentId: string): Promise<ClaimOutcome>
  /**
   * 提交一个 Skill 目录。`skillDir` 省略时用领取目录下的 `skill/`。
   * 自检（经 {@link resolveSkillRoot}）失败会抛错，且**不发起任何上传**。
   */
  submitAssignment(
    assignmentId: string,
    skillDir?: string,
    note?: string,
  ): Promise<SubmitOutcome>
}

/** 递归收集文件（相对路径 + 绝对路径），跳过排除目录。 */
async function collectFiles(root: string): Promise<Array<{ rel: string; abs: string }>> {
  const out: Array<{ rel: string; abs: string }> = []
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) await walk(abs)
      else if (entry.isFile()) out.push({ rel: relative(root, abs), abs })
    }
  }
  await walk(root)
  return out
}

export interface CreateActionsOptions {
  /** 落盘根目录；默认进程工作目录。 */
  workspaceDir?: string
  /** 初始评估条件（来自插件配置）；claim 后会被平台下发值覆盖。 */
  initialEvalConfig?: EvalConfig
  /** claim 拿到 evalConfig 后回调，用于钉死后续模型请求的条件。 */
  onEvalConfig?: (next: EvalConfig | undefined) => void
  /**
   * 收集 `.dshc` 的过程证据（会话审计事件）。由 host 半注入 —— 它需要
   * `ctx.sessionPersistence`。返回空也无妨，**绝不因此挡住提交**。
   */
  collectEvidence?: () => Promise<{
    sessions: EvidenceSession[]
    auditEvents: AuditEvent[]
  }>
}

export function createActions(
  api: PlatformApi,
  options: CreateActionsOptions = {},
): NjuLabActions {
  const workspaceRoot = resolve(options.workspaceDir ?? process.cwd())
  const assignmentDir = (assignmentId: string): string =>
    join(workspaceRoot, 'nju-lab', assignmentId)

  let evalConfig: EvalConfig | undefined = options.initialEvalConfig

  return {
    workspaceRoot,
    assignmentDir,
    currentEvalConfig: () => evalConfig,

    listAssignments: () => api.myAssignments(),

    async claimAssignment(assignmentId: string): Promise<ClaimOutcome> {
      const result = await api.claim(assignmentId)
      evalConfig = result.evalConfig ?? undefined
      options.onEvalConfig?.(evalConfig)

      const dir = assignmentDir(assignmentId)
      await mkdir(dir, { recursive: true })

      const artifacts: DownloadedArtifact[] = []
      const pending: Array<[ArtifactLabel, StoredFileInfo | null]> = [
        ['skillTemplate', result.skillTemplate],
        ['testDataset', result.testDataset],
      ]
      for (const [label, info] of pending) {
        if (!info) continue
        const got = await api.downloadFile(info, join(dir, info.originalName))
        artifacts.push({
          label,
          originalName: info.originalName,
          path: got.path,
          bytes: got.bytes,
          sha256: got.sha256,
        })
      }

      // 模板是 ZIP：解压成 Skill 目录骨架，再探测真正的 Skill 根（§1.0）。
      // 解压失败不致命 —— ZIP 已在本地，学生可自行处理。
      let skillDir: string | null = null
      let skillRoot: string | null = null
      let unzipError: string | undefined
      if (result.skillTemplate) {
        const target = join(dir, 'skill')
        try {
          await mkdir(target, { recursive: true })
          await extractZip(await readFile(join(dir, result.skillTemplate.originalName)), target)
          skillDir = target
          skillRoot = await resolveSkillRoot(target)
        } catch (error) {
          unzipError = (error as Error).message
        }
      }

      return {
        assignmentId,
        dir,
        artifacts,
        skillDir,
        skillRoot,
        unzipError,
        evalConfig: result.evalConfig,
      }
    },

    async submitAssignment(
      assignmentId: string,
      skillDir?: string,
      _note?: string,
    ): Promise<SubmitOutcome> {
      const given = resolve(skillDir ?? join(assignmentDir(assignmentId), 'skill'))

      // 1) 提交前自检：先经 resolveSkillRoot 找到真正的 Skill 根，不通过就直接抛，
      //    一个字节都不上传。
      const root = await resolveSkillRoot(given)
      const files = await collectFiles(root)

      // ZIP 内路径：Skill 根比 `given` 深一层时保留那层目录名 —— 即"单层顶层目录"
      // 风格（`csv-cleaner/SKILL.md`），与服务端复验的探测语义一致。
      const prefix = root === given ? '' : `${basename(root)}/`
      const zipName = (rel: string): string => `${prefix}${toPosix(rel)}`

      // 2) 逐文件 sha256（防篡改登记），键与 ZIP 内路径一致
      const fileHashes: Record<string, string> = {}
      const entries: Array<{ name: string; data: Buffer }> = []
      for (const file of files) {
        fileHashes[zipName(file.rel)] = await fileSha256(file.abs)
        entries.push({ name: zipName(file.rel), data: await readFile(file.abs) })
      }

      // 3) 打包 ZIP（纯 JS，跳过 node_modules/.git）
      const outDir = assignmentDir(assignmentId)
      await mkdir(outDir, { recursive: true })
      const zipPath = join(outDir, 'skill.zip')
      await writeFile(zipPath, buildZip(entries))

      // 4) 证据包：导出会话审计事件（approval 对、permission/preset 提权）并脱敏。
      //    采集失败**不阻断提交** —— 学生要能交作业；证据问题留给平台侧判断。
      let evidence: { sessions: EvidenceSession[]; auditEvents: AuditEvent[] } = {
        sessions: [],
        auditEvents: [],
      }
      let evidenceNote: string | undefined
      if (options.collectEvidence) {
        try {
          evidence = await options.collectEvidence()
        } catch (error) {
          evidenceNote = `证据采集失败：${(error as Error).message}`
        }
      } else {
        // index.ts 总会注入采集器；这条是给其它调用方的兜底
        evidenceNote = '未提供证据采集器，证据包为空'
      }
      const capsule = buildCapsule(evidence.sessions, evidence.auditEvents, evidenceNote)
      const capsulePath = join(outDir, 'evidence.dshc')
      await writeFile(capsulePath, JSON.stringify(capsule, null, 2), 'utf8')

      // 5) 上传两个文件（服务端算权威 sha256）
      const skillUpload = await api.uploadFile(zipPath, 'skill.zip')
      const capsuleUpload = await api.uploadFile(capsulePath, 'evidence.dshc')

      // 6) 以 fileId 模式提交
      const submission = (await api.submit(assignmentId, {
        skillZipFileId: skillUpload.fileId,
        capsuleFileId: capsuleUpload.fileId,
        auditEvents: capsule.auditEvents,
        fileHashes,
      })) as { id?: string; status?: string } | null

      return {
        assignmentId,
        skillRoot: root,
        fileCount: entries.length,
        zipPath,
        skillZip: { fileId: skillUpload.fileId, sha256: skillUpload.sha256 },
        capsule: { fileId: capsuleUpload.fileId, sha256: capsuleUpload.sha256 },
        submission: {
          id: submission?.id ?? '(unknown)',
          status: submission?.status ?? '(unknown)',
        },
      }
    },
  }
}
