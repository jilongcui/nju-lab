/**
 * 插件自更新：从平台拉安装包 zip，只解出 `nju-lab-client/` 覆盖本地插件目录。
 *
 * 为什么需要它：插件以 `file:` 依赖拷进 `$DSH_HOME/nju-lab-client`，dsh 没有针对
 * 本地插件的更新通道 —— 每次修 bug 都让学生重新下载安装包、解压、跑 install.sh，
 * 步骤多且容易拿错旧包。安装包本来就静态托管在平台上（`/kit/…zip`，公开可读），
 * 插件自己也有纯 JS 的 ZIP 实现（`zip.ts`），所以更新可以就地完成。
 *
 * 产物里的 `kit-version.json`（build-kit.sh 生成：日期 + git rev）是版本凭据：
 * 本地版本 ≠ 远端版本即"有更新"。旧安装没有该文件（current=null）→ 视为可更新。
 *
 * 更新只写文件、不碰进程：host 半已在内存里，**重启 dsh 才生效**（面板负责提示）。
 */
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readZip } from './zip.ts'

export interface UpdateInfo {
  /** 本地 kit-version.json 的版本；旧安装没有该文件时为 null。 */
  current: string | null
  latest: string
  available: boolean
}

export interface UpdateResult {
  version: string
  files: number
}

/** 检查结果的进程内缓存：快照每次刷新都查，不能每次都真拉 zip。 */
const CACHE_MS = 5 * 60 * 1000
let cache: { at: number; zip: Buffer; version: string } | null = null

/** 安装包地址：跟平台 serverUrl 同源（serverUrl 形如 https://host/api）。 */
export function kitUrl(serverUrl: string): string {
  return `${new URL(serverUrl).origin}/kit/nju-lab-student-kit.zip`
}

/**
 * 插件目录（学生机上即 `$DSH_HOME/nju-lab-client`）。
 * profile 经 pnpm `file:` 链接挂载，Node 解析模块 URL 时已穿透符号链接，
 * 所以 import.meta.url 落在真实插件目录的 lib/host 下。
 * `NJU_LAB_PLUGIN_DIR` 是测试/调试逃生门：显式指定时优先。
 */
export async function pluginDir(): Promise<string> {
  if (process.env.NJU_LAB_PLUGIN_DIR) return realpath(process.env.NJU_LAB_PLUGIN_DIR)
  const here = dirname(fileURLToPath(import.meta.url))
  return realpath(join(here, '..', '..'))
}

async function fetchKit(url: string, force = false): Promise<{ zip: Buffer; version: string }> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载安装包失败：HTTP ${res.status}`)
  const zip = Buffer.from(await res.arrayBuffer())
  const entry = readZip(zip).find((e) => e.name === 'kit-version.json')
  const version = entry
    ? ((JSON.parse(entry.data.toString('utf8')) as { version?: string }).version ?? 'unknown')
    : 'unknown'
  cache = { at: Date.now(), zip, version }
  return cache
}

async function readCurrentVersion(dir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, 'kit-version.json'), 'utf8')) as {
      version?: string
    }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/** 比较本地与远端版本。拉取失败（平台不可达等）向上抛，由调用方降级为"不知道"。 */
export async function checkUpdate(serverUrl: string, dir: string): Promise<UpdateInfo> {
  const remote = await fetchKit(kitUrl(serverUrl))
  const current = await readCurrentVersion(dir)
  return { current, latest: remote.version, available: current !== remote.version }
}

/**
 * 把远端安装包里的 `nju-lab-client/` 与 `kit-version.json` 写进插件目录。
 * 先删 `lib/` 再写，避免新版已移除的产物文件残留。
 */
export async function applyUpdate(serverUrl: string, dir: string): Promise<UpdateResult> {
  const { zip, version } = await fetchKit(kitUrl(serverUrl), true)
  const entries = readZip(zip).filter(
    (e) => e.name.startsWith('nju-lab-client/') || e.name === 'kit-version.json',
  )
  if (!entries.length) throw new Error('安装包里没有 nju-lab-client 目录')

  await rm(join(dir, 'lib'), { recursive: true, force: true })
  let files = 0
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue
    const rel =
      entry.name === 'kit-version.json' ? entry.name : entry.name.slice('nju-lab-client/'.length)
    if (!rel || rel.split('/').includes('..')) continue
    const target = join(dir, rel)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entry.data)
    files += 1
  }
  return { version, files }
}
