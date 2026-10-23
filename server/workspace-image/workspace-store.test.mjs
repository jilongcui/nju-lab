/**
 * L1：workspace store 的迁移与预置（`workspace-store.mjs`）。
 *
 * 跑法：`node --test server/workspace-image/workspace-store.test.mjs`
 * 这两件事错了的代价是"学生文件在、界面里看不见"，所以必须有回归。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrateWorkspaceStore, seedDefaultWorkspace } from './workspace-store.mjs'

const WORKDIR = '/home/ubuntu'
const TITLE = '实验环境'
const NOW = '2026-10-23T00:00:00.000Z'

/** 线上真实形状（version 2），path/title 可指定。 */
function storeWith(path, title, id = 'w1') {
  return JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [id], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: {
      workspaces: {
        [id]: { path, title, sessionIds: [], createdAt: NOW, updatedAt: NOW },
      },
    },
  })
}

async function tempStore(content) {
  const dir = await mkdtemp(join(tmpdir(), 'ws-store-'))
  const file = join(dir, 'workspace.json')
  if (content !== undefined) await writeFile(file, content)
  return { file, read: async () => JSON.parse(await readFile(file, 'utf8')) }
}

describe('workspace store：迁移', () => {
  test('旧路径 /workspace 与旧标题 workspace 一起改掉', async () => {
    const { file, read } = await tempStore(storeWith('/workspace', 'workspace'))
    const changed = migrateWorkspaceStore(file, { workdir: WORKDIR, title: TITLE })
    assert.equal(changed, 2, '路径 + 标题各算一处')
    const entry = Object.values((await read()).tables.workspaces)[0]
    assert.equal(entry.path, WORKDIR)
    assert.equal(entry.title, TITLE)
  })

  test('旧路径 /work 也迁移', async () => {
    const { file, read } = await tempStore(storeWith('/work', '我的项目'))
    migrateWorkspaceStore(file, { workdir: WORKDIR, title: TITLE })
    assert.equal(Object.values((await read()).tables.workspaces)[0].path, WORKDIR)
  })

  test('幂等：再跑一次不再改动、也不重写文件内容', async () => {
    const { file, read } = await tempStore(storeWith('/workspace', 'workspace'))
    migrateWorkspaceStore(file, { workdir: WORKDIR, title: TITLE })
    const once = await read()
    assert.equal(migrateWorkspaceStore(file, { workdir: WORKDIR, title: TITLE }), 0)
    assert.deepEqual(await read(), once)
  })

  test('学生自己起的分区名不动', async () => {
    const { file, read } = await tempStore(storeWith(WORKDIR, '我的项目'))
    assert.equal(migrateWorkspaceStore(file, { workdir: WORKDIR, title: TITLE }), 0)
    assert.equal(Object.values((await read()).tables.workspaces)[0].title, '我的项目')
  })

  test('没有 store / 结构不认识时安全返回 0', async () => {
    const { file } = await tempStore(undefined)
    assert.equal(migrateWorkspaceStore(file, { workdir: WORKDIR, title: TITLE }), 0)
    const broken = await tempStore('{"unit":{"name":"workspace","version":2}}')
    assert.equal(migrateWorkspaceStore(broken.file, { workdir: WORKDIR, title: TITLE }), 0)
  })
})

describe('workspace store：首次预置', () => {
  test('没有 store 时建一条指向工作目录的分区', async () => {
    const { file, read } = await tempStore(undefined)
    assert.equal(seedDefaultWorkspace(file, { workdir: WORKDIR, title: TITLE, id: 'w-new', now: NOW }), true)
    const record = await read()
    assert.deepEqual(record.global.workspaceIds, ['w-new'])
    assert.equal(record.tables.workspaces['w-new'].path, WORKDIR)
    assert.equal(record.tables.workspaces['w-new'].title, TITLE)
  })

  test('已有分区时绝不覆盖（学生选过就尊重他）', async () => {
    const { file, read } = await tempStore(storeWith('/home/ubuntu/某个项目', '我的项目'))
    assert.equal(seedDefaultWorkspace(file, { workdir: WORKDIR, title: TITLE, id: 'x', now: NOW }), false)
    assert.deepEqual((await read()).global.workspaceIds, ['w1'])
  })

  test('空 store（workspaceIds 为空）时补一条', async () => {
    const empty = JSON.stringify({ unit: { name: 'workspace', version: 2 }, global: { workspaceIds: [] } })
    const { file, read } = await tempStore(empty)
    assert.equal(seedDefaultWorkspace(file, { workdir: WORKDIR, title: TITLE, id: 'w2', now: NOW }), true)
    assert.deepEqual((await read()).global.workspaceIds, ['w2'])
  })
})
