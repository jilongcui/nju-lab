/**
 * L1：面板的纯判定逻辑（`src/client/panel-logic.ts`）。
 *
 * 面板组件本身要真浏览器才渲染得出来，但"列表里出现哪些任务""打开面板补下发哪些
 * 材料"这两条就是面板看起来对不对的全部 —— 这里直接对纯函数断言，不启动浏览器。
 *
 * 跑法：`npm test`（先 `npm run build` 出 `lib/shared/panel-logic.js`）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isClaimed,
  pendingAutoMaterialize,
  pendingCount,
  visibleAssignments,
} from '../lib/shared/panel-logic.js'

/** 造一个最小任务：默认已解锁。 */
const task = (id, status, extra = {}) => ({ id, status, unlocked: true, ...extra })

const ASSIGNMENTS = [
  task('a-done', 'submitted'),
  task('a-doing', 'claimed'),
  task('a-todo', 'pending'),
  task('a-locked-todo', 'pending', { unlocked: false }),
]

describe('panel logic: 只列已领取的实验', () => {
  test('claimed 与 submitted 算已领取，pending 不算', () => {
    assert.equal(isClaimed(task('x', 'claimed')), true)
    assert.equal(isClaimed(task('x', 'submitted')), true)
    assert.equal(isClaimed(task('x', 'pending')), false)
    // 平台将来加新状态时按"非 pending 即已领取"处理，不静默丢掉任务
    assert.equal(isClaimed(task('x', 'graded')), true)
  })

  test('visibleAssignments 只留已领取，顺序不动', () => {
    assert.deepEqual(
      visibleAssignments(ASSIGNMENTS).map((a) => a.id),
      ['a-done', 'a-doing'],
    )
  })

  test('pendingCount 数未领取的（含未解锁的）', () => {
    assert.equal(pendingCount(ASSIGNMENTS), 2)
    assert.equal(pendingCount(visibleAssignments(ASSIGNMENTS)), 0)
    assert.equal(pendingCount([]), 0)
  })

  test('空列表不抛', () => {
    assert.deepEqual(visibleAssignments([]), [])
  })
})

describe('panel logic: 打开面板自动补下发材料', () => {
  test('已领取但本地没有材料 → 全部进候选', () => {
    assert.deepEqual(
      pendingAutoMaterialize(ASSIGNMENTS, [], new Set()).map((a) => a.id),
      ['a-done', 'a-doing'],
    )
  })

  test('未领取的绝不自动领（那是替学生做决定）', () => {
    const targets = pendingAutoMaterialize(ASSIGNMENTS, [], new Set())
    assert.equal(
      targets.some((a) => a.status === 'pending'),
      false,
    )
  })

  test('本地已有材料的不重复下发', () => {
    assert.deepEqual(
      pendingAutoMaterialize(ASSIGNMENTS, ['a-done', 'a-doing'], new Set()).map((a) => a.id),
      [],
    )
    assert.deepEqual(
      pendingAutoMaterialize(ASSIGNMENTS, ['a-doing'], new Set()).map((a) => a.id),
      ['a-done'],
    )
  })

  test('本次挂载试过的不再试（失败退回手动「重新下载」）', () => {
    assert.deepEqual(
      pendingAutoMaterialize(ASSIGNMENTS, [], new Set(['a-done', 'a-doing'])).map((a) => a.id),
      [],
    )
  })

  test('未解锁的已领取任务不下发（防御性判断）', () => {
    const locked = [task('a-claimed-locked', 'claimed', { unlocked: false })]
    assert.deepEqual(pendingAutoMaterialize(locked, [], new Set()), [])
  })

  test('换机场景：submitted 但本地没有材料也要补', () => {
    const onlySubmitted = [task('a-done', 'submitted')]
    assert.deepEqual(
      pendingAutoMaterialize(onlySubmitted, [], new Set()).map((a) => a.id),
      ['a-done'],
    )
  })
})
