/**
 * 平台动作核心：`nju_lab_*` 工具与 ClaimPanel 的 host 路由**共用这一份实现**。
 *
 * 抽出来的原因：面板和对话式工具要做同样的事（领取 = 领取 + 下载 + 校验 + 解压）。
 * 如果各写一份，两边迟早漂移。这里返回**结构化结果**，由调用方决定渲染成文本还是 JSON。
 *
 * 打包与解压都走 `./zip.ts` 的纯 JS 实现 —— 不依赖学生机器上有 `zip`/`unzip`。
 */
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { constants } from 'node:fs'

import { fileSha256, type Assignment, type PlatformApi, type StoredFileInfo } from './api.ts'
import type { EvalConfig } from './config.ts'
import { clearPinnedEvalConfig, loadPinnedEvalConfig, savePinnedEvalConfig } from './eval-state.ts'
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

export type ArtifactLabel = 'skillTemplate' | 'problem'

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

/**
 * 实验报告检查结果。
 *
 * 口径**必须**与平台复验一致（`server/verify-image/run-eval.mjs` 的 `scanReport`）：
 * 否则"本地说没问题、复验却扣分"比不提示更糟。改一边就要同步改另一边。
 *
 * 2026-10-22 起（用户口径）：平台**只判断实验报告**（`report.md`，模板结构已给好、学生只填数字），
 * **不再判断 `SKILL.md` 的内容**。老作业没有 `report.md` 时依次回落到 `dossier.md` /
 * `SKILL.md` 旧位置，避免历史提交突然掉分。
 */
export interface ReportCheck {
  /** 报告齐全：自测时间 + 两个 case 的表格行有数字 + 至少一条踩坑记录 */
  reportComplete: boolean
  /** 踩坑记录条数（按行计数，与平台 `dossierSnapshot.pitfallsRecorded` 同口径） */
  pitfallsRecorded: number
  /** 这份报告是从哪个文件读到的（排查用） */
  reportSource: 'report.md' | 'dossier.md' | 'SKILL.md' | 'none'
  /** 给人看的提醒；报告齐全时为空数组 */
  warnings: string[]
}

/**
 * 扫提交目录里的实验报告，把平台**提交后才扣分**的过程项提前到提交那一刻说明。
 *
 * 用途：`nju_lab_submit` 与面板的提交动作返回里带上 `warnings`，**不阻断提交**
 * （用户口径：警告不拦截）。学生只交一份空模板时，从这里第一次被点名。
 */
export async function scanReport(skillRoot: string): Promise<ReportCheck> {
  const readOptional = async (name: string): Promise<string | null> => {
    try {
      return await readFile(join(skillRoot, name), 'utf8')
    } catch {
      return null
    }
  }
  /** 踩坑记录可能是独立二级标题，也可能是小节里的列表项（报告模板即后者）。 */
  const pitfallsOf = (md: string | null): string => {
    const m = /##[^\n]*踩坑记录[^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(md ?? '')
    let text = m?.[1] ?? ''
    if (!text.trim()) {
      const inline = /踩坑记录[^\n]*\n((?:[ \t]+(?:[-*]|\d+\.)[^\n]*\n?)+)/.exec(md ?? '')
      text = inline?.[1] ?? ''
    }
    return text
  }
  const count = (text: string): number =>
    text
      .split('\n')
      .filter((line) => /^\s*(?:[-*]|\d+\.)\s*\S/.test(line) && !line.includes('TODO')).length
  const hasSelfTest = (md: string | null): boolean => /自测时间[：:][ \t]*\S/.test(md ?? '')
  /** 报告第 2 节表格行里，第 3 个单元格起是否有数字（前两个是 case 名与数据特点）。 */
  const caseRowFilled = (md: string | null, n: number): boolean => {
    const line = (md ?? '')
      .split('\n')
      .find((l) => new RegExp(`case\\s*0?${n}`, 'i').test(l))
    if (!line) return false
    const cells = line.split('|').slice(1)
    return cells.slice(2).some((cell) => /\d/.test(cell))
  }

  let raw = await readOptional('report.md')
  let reportSource: ReportCheck['reportSource'] = raw ? 'report.md' : 'none'
  if (!raw) {
    raw = await readOptional('dossier.md')
    reportSource = raw ? 'dossier.md' : 'none'
  }
  if (!raw) {
    raw = await readOptional('SKILL.md')
    reportSource = raw ? 'SKILL.md' : 'none'
  }

  const pitfallsRecorded = count(pitfallsOf(raw))
  const reportComplete =
    reportSource === 'report.md'
      ? hasSelfTest(raw) && caseRowFilled(raw, 1) && caseRowFilled(raw, 2) && pitfallsRecorded >= 1
      : hasSelfTest(raw) && pitfallsRecorded >= 1

  const warnings: string[] = []
  if (!reportComplete) {
    const missing: string[] = []
    if (!hasSelfTest(raw)) missing.push('自测时间')
    if (reportSource === 'report.md' && !(caseRowFilled(raw, 1) && caseRowFilled(raw, 2))) {
      missing.push('两个 case 的指标数字')
    }
    if (pitfallsRecorded === 0) missing.push('踩坑记录（≥1 条）')
    warnings.push(
      `实验报告 ${reportSource === 'none' ? '还没建（report.md）' : `缺：${missing.join('、')}`}` +
        ' —— 平台过程分从 20 降到 10',
    )
  }
  return { reportComplete, pitfallsRecorded, reportSource, warnings }
}

export interface SubmitOutcome {
  assignmentId: string
  /** 实际被打包的 Skill 根 */
  skillRoot: string
  fileCount: number
  zipPath: string
  skillZip: { fileId: string; sha256: string }
  capsule: { fileId: string; sha256: string }
  submission: { id: string; status: string; version?: number }
  /** 实验报告检查（只警告不阻断 —— 提交本身已经成功） */
  report: ReportCheck
}

export interface NjuLabActions {
  /** 兜底根：显式配置 workspaceDir，或进程启动目录（无会话上下文时使用）。 */
  readonly workspaceRoot: string
  /**
   * 本次操作的工作区根。解析顺序：显式 `workspaceDir` 配置 → 会话工作区
   * （`sessionId` 经 `resolveSessionCwd` 解析）→ 进程启动目录。
   *
   * 为什么是会话工作区优先于启动目录：学生常在任意目录（~/Downloads）启动
   * dsh，而项目语义（agent 读写、沙箱、Skill、提交打包）都绑在 UI 里选的
   * 会话工作区上 —— 材料落在启动目录就是"下载了但找不到"。
   */
  resolveRoot(sessionId?: string): Promise<string>
  /** 领取物落盘与打包产物的目录（随 resolveRoot 的会话工作区走）。 */
  assignmentDir(assignmentId: string, sessionId?: string): Promise<string>
  /** 当前钉定的评估条件（claim 后写入；供面板显示锁定状态）。 */
  currentEvalConfig(): EvalConfig | undefined
  /**
   * 当前钉定条件来自哪个任务（claim 时记录，并在重启后从工作区恢复）。
   * 用于面板提示"这条条件是哪次 claim 带来的"。
   */
  currentPinnedFrom(): string | undefined
  /**
   * 从指定工作区恢复上次 claim 钉下的条件（agent 创建时按其 cwd 调用）。
   * 返回是否恢复成功；成功时经 onEvalConfig 回调生效。
   */
  restorePinnedFor(workspaceRoot: string): boolean
  /**
   * 当前学生身份：`{ name, studentId }`。
   *
   * 报告要写姓名与学号（用户 2026-10-23 要求），学员模式下也要让模型知道"在帮谁做"。
   * 平台没有单独的"学生资料"接口，`GET /me` 里 `nickname` 是姓名、`username` 是学号。
   */
  whoAmI(): Promise<{ name?: string; studentId?: string }>
  listAssignments(): Promise<Assignment[]>
  /**
   * 本地材料是否已落盘（换机、清理工作区后为 false）。
   * 平台侧的 claimed 状态是云端的，本地有没有文件要另判 —— 面板据此把
   * 「已领取」换成「重新下载」（平台对 claimed/submitted 的 claim 是幂等重发）。
   */
  isMaterialized(assignmentId: string, sessionId?: string): Promise<boolean>
  claimAssignment(assignmentId: string, sessionId?: string): Promise<ClaimOutcome>
  /**
   * 提交一个 Skill 目录。`skillDir` 省略时用领取目录下的 `skill/`（随会话工作区）。
   * 自检（经 {@link resolveSkillRoot}）失败会抛错，且**不发起任何上传**。
   */
  submitAssignment(
    assignmentId: string,
    skillDir?: string,
    note?: string,
    sessionId?: string,
  ): Promise<SubmitOutcome>
}

/**
 * 把 `from` 目录里 `to` **缺少**的文件补过去（已存在的绝不覆盖）。
 *
 * 为什么需要它：`nju_lab_claim` 的"重新下载"是给学生换机/清工作区用的，
 * 但如果直接解压覆盖，会把学生已经改好的 `scripts/train.py`、写好的 `SKILL.md` 与
 * `report.md` 一起冲掉 —— 那是不可恢复的损失（2026-10-23 实测踩到）。
 *
 * @returns 补上的相对路径列表（空 = 本来就齐全）
 */
async function fillMissing(from: string, to: string): Promise<string[]> {
  const filled: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const src = join(dir, entry.name)
      const dst = join(to, rel)
      if (entry.isDirectory()) {
        await mkdir(dst, { recursive: true })
        await walk(src, rel)
        continue
      }
      if (await pathExists(dst)) continue
      await writeFile(dst, await readFile(src))
      filled.push(rel)
    }
  }
  await walk(from, '')
  return filled
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
  /** 显式落盘根目录（优先级最高）；省略时按"会话工作区 → 进程启动目录"解析。 */
  workspaceDir?: string
  /**
   * 由 sessionId 解析会话工作区（host 半经 sessionPersistence 注入）。
   * 缺席或解析失败时回落到进程启动目录。
   */
  resolveSessionCwd?: (sessionId: string) => Promise<string | undefined>
  /** 初始评估条件（来自插件配置，或启动时从工作区恢复的钉定值）；claim 后会被平台下发值覆盖。 */
  initialEvalConfig?: EvalConfig
  /** 初始钉定来源任务（启动时从工作区恢复的）；claim 时会被覆盖。 */
  initialPinnedFrom?: string
  /** claim 拿到 evalConfig 后回调，用于钉死后续模型请求的条件。 */
  onEvalConfig?: (next: EvalConfig | undefined) => void
  /**
   * 收集 `.dshc` 的过程证据（会话审计事件）。由 host 半注入 —— 它需要
   * `ctx.sessionPersistence`。返回空也无妨，**绝不因此挡住提交**。
   * 参数是本次提交归属的工作区根（随会话工作区）。
   */
  collectEvidence?: (workspaceRoot: string) => Promise<{
    sessions: EvidenceSession[]
    auditEvents: AuditEvent[]
  }>
}

export function createActions(
  api: PlatformApi,
  options: CreateActionsOptions = {},
): NjuLabActions {
  const fallbackRoot = resolve(options.workspaceDir ?? process.cwd())

  let evalConfig: EvalConfig | undefined = options.initialEvalConfig
  /** 这份条件来自哪个任务：claim 时写入；启动时可能由 index.ts 从工作区恢复。 */
  let pinnedFrom: string | undefined = options.initialPinnedFrom

  return {
    workspaceRoot: fallbackRoot,

    async resolveRoot(sessionId?: string): Promise<string> {
      if (options.workspaceDir) return fallbackRoot
      if (sessionId && options.resolveSessionCwd) {
        const cwd = await options.resolveSessionCwd(sessionId).catch(() => undefined)
        if (cwd) return resolve(cwd)
      }
      return fallbackRoot
    },

    assignmentDir(assignmentId: string, sessionId?: string): Promise<string> {
      return this.resolveRoot(sessionId).then((root) => join(root, 'nju-lab', assignmentId))
    },

    currentEvalConfig: () => evalConfig,
    currentPinnedFrom: () => pinnedFrom,

    restorePinnedFor(workspaceRoot: string): boolean {
      const pinned = loadPinnedEvalConfig(workspaceRoot)
      if (!pinned) return false
      evalConfig = pinned.evalConfig
      pinnedFrom = pinned.assignmentId
      options.onEvalConfig?.(evalConfig)
      return true
    },

    async whoAmI() {
      try {
        const me = await api.me()
        return { name: me.nickname, studentId: me.username }
      } catch {
        // 拿不到身份不该拖累报告生成：调用方会显示"未取到"
        return {}
      }
    },

    listAssignments: () => api.myAssignments(),

    async isMaterialized(assignmentId: string, sessionId?: string): Promise<boolean> {
      try {
        return (await readdir(await this.assignmentDir(assignmentId, sessionId))).length > 0
      } catch {
        return false
      }
    },

    async claimAssignment(assignmentId: string, sessionId?: string): Promise<ClaimOutcome> {
      const result = await api.claim(assignmentId)
      evalConfig = result.evalConfig ?? undefined
      options.onEvalConfig?.(evalConfig)

      const root = await this.resolveRoot(sessionId)

      // 跨进程持久化（见 `eval-state.ts` 顶部注释）：DSH 每次启动都是新进程，条件不落盘
      // 的话，学生关掉再打开就丢了 —— 工具面会重新放开，等于"自测条件 ≠ 复验条件"。
      if (result.evalConfig) {
        try {
          savePinnedEvalConfig(root, assignmentId, result.evalConfig)
        } catch (error) {
          // 不阻断领取：本次会话内的钉定仍然生效，只是重启后不再恢复。
          console.warn(
            `[nju-lab-client] 评估条件落盘失败（重启后将无法恢复钉定）：${(error as Error).message}`,
          )
        }
        pinnedFrom = assignmentId
      } else {
        // 平台这次没下发条件 → 清掉旧的，别把上个实验的限制"继承"到这次。
        clearPinnedEvalConfig(root)
        pinnedFrom = undefined
      }

      const dir = join(root, 'nju-lab', assignmentId)
      await mkdir(dir, { recursive: true })

      const artifacts: DownloadedArtifact[] = []
      const pending: Array<[ArtifactLabel, StoredFileInfo | null]> = [
        ['skillTemplate', result.skillTemplate],
        ['problem', result.problem],
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
          // **不覆盖学生已有的文件**（2026-10-23 修）：模板解压到临时目录后只补缺失的，
          // 否则"重新下载"会把学生改过的 scripts/train.py、SKILL.md、report.md 冲掉。
          const zipPath = join(dir, result.skillTemplate.originalName)
          const staging = join(dir, '.template-staging')
          await rm(staging, { recursive: true, force: true })
          await mkdir(staging, { recursive: true })
          await extractZip(await readFile(zipPath), staging)
          const filled = await fillMissing(staging, target)
          await rm(staging, { recursive: true, force: true })
          if (filled.length > 0) {
            // 只报"补了哪些"，让调用方能说清"没有覆盖你的东西"
            console.log(`[nju-lab-client] 模板补齐缺失文件 ${filled.length} 个：${filled.slice(0, 5).join(', ')}`)
          }
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
      sessionId?: string,
    ): Promise<SubmitOutcome> {
      const root = await this.resolveRoot(sessionId)
      const outDir = join(root, 'nju-lab', assignmentId)
      const given = resolve(skillDir ?? join(outDir, 'skill'))

      // 1) 提交前自检：先经 resolveSkillRoot 找到真正的 Skill 根，不通过就直接抛，
      //    一个字节都不上传。
      const skillRoot = await resolveSkillRoot(given)
      const files = await collectFiles(skillRoot)

      // 实验报告检查：与平台复验同口径，但**只警告不阻断**（见 scanReport 注释）。
      // 放在打包前算，是因为它读的是同一个 skillRoot，与上传内容一致。
      const report = await scanReport(skillRoot)

      // ZIP 内路径：Skill 根比 `given` 深一层时保留那层目录名 —— 即"单层顶层目录"
      // 风格（`csv-cleaner/SKILL.md`），与服务端复验的探测语义一致。
      const prefix = skillRoot === given ? '' : `${basename(skillRoot)}/`
      const zipName = (rel: string): string => `${prefix}${toPosix(rel)}`

      // 2) 逐文件 sha256（防篡改登记），键与 ZIP 内路径一致
      const fileHashes: Record<string, string> = {}
      const entries: Array<{ name: string; data: Buffer }> = []
      for (const file of files) {
        fileHashes[zipName(file.rel)] = await fileSha256(file.abs)
        entries.push({ name: zipName(file.rel), data: await readFile(file.abs) })
      }

      // 3) 打包 ZIP（纯 JS，跳过 node_modules/.git）
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
          evidence = await options.collectEvidence(root)
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

      // 6) 以 fileId 模式提交（平台支持多版本：重复提交生成 v2、v3…）
      const submission = (await api.submit(assignmentId, {
        skillZipFileId: skillUpload.fileId,
        capsuleFileId: capsuleUpload.fileId,
        auditEvents: capsule.auditEvents,
        fileHashes,
      })) as { id?: string; status?: string; version?: number } | null

      return {
        assignmentId,
        skillRoot,
        fileCount: entries.length,
        zipPath,
        skillZip: { fileId: skillUpload.fileId, sha256: skillUpload.sha256 },
        capsule: { fileId: capsuleUpload.fileId, sha256: capsuleUpload.sha256 },
        submission: {
          id: submission?.id ?? '(unknown)',
          status: submission?.status ?? '(unknown)',
          version: submission?.version,
        },
        report,
      }
    },
  }
}
