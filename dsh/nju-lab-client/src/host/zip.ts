/**
 * 最小 ZIP 编解码（纯 JS，无外部依赖、不调用系统 `zip`/`unzip`）。
 *
 * 为什么要自己写：REQ-2026-09-21 §1.4 要求打包用纯 JS 实现 —— 学生机器的 PATH 上
 * 不保证有 `zip`（Windows 默认没有）。解压同理，所以两边都收在这里。
 *
 * 写入用 **store（无压缩）** 模式：平台 `server/fixtures/` 里的模板也是 store，
 * 且无压缩让输出对相同输入**逐字节确定**，重算 sha256 才能复现。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/** CRC-32（IEEE 802.3），ZIP 用的那个。表驱动，不依赖 zlib.crc32 的版本可用性。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

/** @returns CRC-32 校验值（无符号 32 位）。 */
export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** ZIP 内的路径，用 `/` 分隔（如 `csv-cleaner/SKILL.md`）。 */
  name: string
  data: Buffer
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

/** 把一个文件列表打成 ZIP（store 模式）。 */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed (2.0)
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(0, 10) // mtime
    local.writeUInt16LE(0x21, 12) // mdate: 1980-01-01（固定值，保证可复现）
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    locals.push(local, name, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(0, 10) // method
    central.writeUInt16LE(0, 12) // mtime
    central.writeUInt16LE(0x21, 14) // mdate
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(size, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0o644 << 16, 38) // external attrs: rw-r--r--
    central.writeUInt32LE(offset, 42)

    centrals.push(central, name)
    offset += local.length + name.length + size
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // disk with central dir
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralBuf, eocd])
}

/**
 * 读出一个 ZIP 的所有条目。
 *
 * 走 **central directory** 而不是顺序扫 local header：后者在带 data descriptor
 * （flag bit 3）的 ZIP 上读不到长度 —— 模板 ZIP 未必是我们生成的，所以按规范来。
 */
export function readZip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16) // central directory offset
  const entries: ZipEntry[] = []

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new Error(`ZIP 解析失败：第 ${i} 个中央目录项签名不对`)
    }
    const method = buf.readUInt16LE(pos + 10)
    const compressedSize = buf.readUInt32LE(pos + 20)
    const uncompressedSize = buf.readUInt32LE(pos + 24)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8')

    // 必须按**压缩后**大小切数据：store 时两者相同，deflate 时不同。
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(dataStart, dataStart + compressedSize)

    let data: Buffer
    if (method === 0) data = raw
    else if (method === 8) data = inflateRawSync(raw)
    else {
      throw new Error(
        `ZIP 解析失败：${name} 用了不受支持的压缩方法 ${method}（只支持 store / deflate）`,
      )
    }
    if (data.length !== uncompressedSize) {
      throw new Error(
        `ZIP 解析失败：${name} 解压后大小不符（${data.length} ≠ ${uncompressedSize}）`,
      )
    }
    entries.push({ name, data })

    pos += 46 + nameLen + extraLen + commentLen
  }

  return entries
}

/** 从尾部回扫 EOCD（注释最长 65535 字节）。 */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error('ZIP 解析失败：找不到 End of Central Directory（可能不是 ZIP 文件）')
}

/** 拒绝 `../` 之类的条目名，避免解压写出目标目录之外。 */
function safeJoin(destDir: string, name: string): string | null {
  const normalized = normalize(name.replaceAll('\\', '/')).replace(/^([/\\])+/, '')
  if (normalized.startsWith('..') || normalized.split(sep).includes('..')) return null
  return join(destDir, normalized)
}

/** 把 ZIP 解压到目录。@returns 实际写出的文件相对路径（`/` 分隔）。 */
export async function extractZip(buf: Buffer, destDir: string): Promise<string[]> {
  const written: string[] = []
  for (const entry of readZip(buf)) {
    if (entry.name.endsWith('/')) continue // 目录项：按需由文件创建
    const target = safeJoin(destDir, entry.name)
    if (!target) continue // 越界条目直接跳过
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entry.data)
    written.push(entry.name)
  }
  return written
}
