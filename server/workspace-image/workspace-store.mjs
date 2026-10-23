/**
 * dsh 的 workspace store（`$DSH_HOME/storages/workspace.json`）读写。
 *
 * 抽成独立模块的原因：这段逻辑决定"学生进来看到哪个分区、会话 cwd 是哪个目录"，
 * 出错的代价是**学生的文件还在、但界面里看不见**。放在 entrypoint 里没法测，所以单独出来。
 *
 * 真实记录形状（version 2，取自线上学生文件）：
 *   { unit: { name: 'workspace', version: 2 },
 *     global: { workspaceIds: [...] },
 *     tables: { workspaces: { <id>: { path, title, sessionIds, createdAt, updatedAt } } } }
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * 把旧路径/旧显示名迁移到当前布局（幂等，可重复跑）。
 *
 * - `path` 属于 `legacyPaths`（`/workspace`、`/work`）→ `workdir`
 * - `title === 'workspace'`（旧 seed 名）→ `title`
 *
 * @returns 改动的条目数（0 表示无事可做）
 */
export function migrateWorkspaceStore(
  storePath,
  { workdir, title, legacyPaths = ['/workspace', '/work'] },
) {
  if (!existsSync(storePath)) return 0
  const record = JSON.parse(readFileSync(storePath, 'utf8'))
  const table = record?.tables?.workspaces
  if (!table || typeof table !== 'object') return 0

  let changed = 0
  for (const entry of Object.values(table)) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.path === 'string' && legacyPaths.includes(entry.path) && entry.path !== workdir) {
      entry.path = workdir
      changed += 1
    }
    if (entry.title === 'workspace') {
      entry.title = title
      changed += 1
    }
  }
  if (changed > 0) writeFileSync(storePath, `${JSON.stringify(record, null, 2)}\n`)
  return changed
}

/**
 * 首次使用：补一条指向 `workdir` 的分区，学生进来直接可用（否则要先在目录选择器里点一次）。
 *
 * **只在"一个分区都没有"时写**；学生已经加过/选过分区就绝不动它。
 *
 * @returns 是否写入
 */
export function seedDefaultWorkspace(storePath, { workdir, title, id, now }) {
  const entry = { path: workdir, title, sessionIds: [], createdAt: now, updatedAt: now }
  if (existsSync(storePath)) {
    const existing = JSON.parse(readFileSync(storePath, 'utf8'))
    const ids = existing?.global?.workspaceIds
    const table = existing?.tables?.workspaces
    if (Array.isArray(ids) && ids.length > 0) return false
    if (table && Object.keys(table).length > 0) return false
    existing.global = { ...existing.global, initialized: true, workspaceIds: [id] }
    existing.tables = { ...existing.tables, workspaces: { ...(table ?? {}), [id]: entry } }
    writeFileSync(storePath, `${JSON.stringify(existing, null, 2)}\n`)
    return true
  }
  const record = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [id], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { [id]: entry } },
  }
  writeFileSync(storePath, `${JSON.stringify(record, null, 2)}\n`)
  return true
}
