/**
 * L1：学员模式（步骤状态机 + 报告自动生成）。
 *
 * 覆盖三件事：
 *  1. 纯逻辑：实验类型识别、步骤推进与产出记录、报告渲染与"缺什么"判定；
 *  2. 工具面：`nju_lab_step` 的 status/record/advance 会落盘 `progress.json`；
 *  3. `nju_lab_finalize_report` 从各 case 的 `output.json` 生成 `report.md`
 *     （数字取自运行结果、图用相对路径嵌入、踩坑来自过程记录）。
 *
 * 跑法：`npm test`（会先 `npm run build`）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  advanceStep,
  apply,
  detectKind,
  guidePath,
  loadGuide,
  missingReportParts,
  newGuideState,
  recordStep,
  renderReport,
  reportLooksComplete,
  saveGuide,
  stepsFor,
} from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

function makeHarness() {
  const tools = []
  const ctx = {
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    on: () => () => {},
    connection: { fetch: { register: () => async () => {} } },
    settings: { configure: () => () => {} },
    effect: (callback) => {
      callback()
      return () => {}
    },
  }
  ctx.inject = (deps, callback) => {
    if (deps.every((dep) => ctx[dep] !== undefined)) callback(ctx)
    return () => {}
  }
  return {
    ctx,
    tool(name) {
      const found = tools.find((entry) => entry.name === name)
      assert.ok(found, `tool ${name} was not registered (have: ${tools.map((t) => t.name)})`)
      return found
    },
    toolNames: () => tools.map((t) => t.name),
  }
}

async function withClient(config, fn) {
  const platform = await startMockPlatform()
  const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-guide-'))
  try {
    const harness = makeHarness()
    apply(harness.ctx, {
      serverUrl: platform.url,
      token: platform.token,
      workspaceDir,
      guidedMode: true,
      ...config,
    })
    await fn({ harness, workspaceDir, platform })
  } finally {
    await platform.close()
  }
}

const OUTPUT_CLASSIFICATION = {
  model: 'LogisticRegression',
  n_train: 112,
  n_test: 38,
  metrics: { accuracy: 0.9474, macro_f1: 0.9487 },
  baseline: { name: 'most_frequent', accuracy: 0.3158 },
  figures: [
    { path: 'figures/data_overview.png', takeaway: 'setosa 单独挤在左下角' },
    { path: 'figures/evaluation.png', takeaway: 'versicolor 有 1 朵被判成 virginica' },
  ],
  notes: '两个品种在交界处会互相误判；相比基线提升约 63 个百分点。',
}

describe('学员模式：步骤状态机（纯逻辑）', () => {
  test('从 output.json 的形状识别实验类型', () => {
    assert.equal(detectKind(OUTPUT_CLASSIFICATION), 'classification')
    assert.equal(detectKind({ ...OUTPUT_CLASSIFICATION, training: { history: [] } }), 'dl-classification')
    assert.equal(detectKind({ metrics: { mae: 6.09 }, baseline: { mae: 9.27 } }), 'regression')
    assert.equal(detectKind({ metrics: { mae: 6.09 }, training: { history: [] } }), 'dl-regression')
    assert.equal(detectKind({}), 'generic')
    assert.equal(detectKind(null), 'generic')
  })

  test('六步，最后一步是生成报告；推进到顶不再前进', () => {
    const kind = 'classification'
    const steps = stepsFor(kind)
    assert.equal(steps.length, 6)
    assert.equal(steps[5].id, 'report')

    let state = newGuideState('a-1', kind)
    assert.equal(state.step, 0)
    for (let i = 0; i < 6; i += 1) state = advanceStep(state)
    assert.equal(state.step, steps.length - 1, '到顶后停在最后一步')
    assert.equal(state.confirmed, steps.length - 1)
  })

  test('record 浅合并同一步的多次产出', () => {
    let state = newGuideState('a-1', 'classification')
    state = recordStep(state, 'baseline', { accuracy: 0.3158 })
    state = recordStep(state, 'baseline', { label: 'setosa' })
    assert.deepEqual(state.records.baseline, { accuracy: 0.3158, label: 'setosa' })
  })

  test('进度落盘后可读回（跨进程恢复的前提）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nju-progress-'))
    let state = newGuideState('a-1', 'regression')
    state = advanceStep(recordStep(state, 'understand', { ok: true }))
    await saveGuide(root, state)
    const loaded = await loadGuide(root, 'a-1')
    assert.ok(loaded)
    assert.equal(loaded.kind, 'regression')
    assert.equal(loaded.step, 1)
    assert.deepEqual(loaded.records.understand, { ok: true })
    assert.match(guidePath(root, 'a-1'), /nju-lab\/a-1\/progress\.json$/)
  })
})

describe('学员模式：报告渲染', () => {
  const INPUT = {
    title: '按花瓣尺寸识别鸢尾花品种',
    kind: 'classification',
    cases: [
      { name: 'case01', output: OUTPUT_CLASSIFICATION },
      { name: 'case02', output: { ...OUTPUT_CLASSIFICATION, metrics: { accuracy: 0.9333, macro_f1: 0.9333 } } },
    ],
    pitfalls: ['只报 accuracy 不够，macro F1 会掉', '只用花瓣长度时重叠区错得更多'],
    thresholds: { accuracy: 0.9, macroF1: 0.85 },
    generatedAt: '2026-10-22T12:00:00.000Z',
  }

  test('数字取自 output.json，表格与图片、踩坑都在', () => {
    const md = renderReport(INPUT)
    assert.match(md, /^# 实验报告：按花瓣尺寸识别鸢尾花品种/m)
    assert.match(md, /\| case01 \| 0\.9474 \| 0\.9487 \| 达标 \|/)
    assert.match(md, /\| case02 \| 0\.9333 \| 0\.9333 \| 达标 \|/)
    assert.match(md, /基线 accuracy ≈ 0\.3158/)
    assert.match(md, /!\[case01 图 1\]\(figures\/data_overview\.png\)/)
    assert.match(md, /1\. 只报 accuracy 不够/)
    assert.match(md, /自测时间：2026-10-22/)
    assert.equal(reportLooksComplete(md), true)
    assert.deepEqual(missingReportParts(md), [])
  })

  test('回归报告用 MAE / 基线 / 比值列，并算出是否达标', () => {
    const md = renderReport({
      title: '按面积估算房子总价',
      kind: 'regression',
      cases: [
        { name: 'case01', output: { model: 'LinearRegression', metrics: { mae: 6.0905 }, baseline: { mae: 9.271 }, figures: [] } },
      ],
      pitfalls: ['基线用测试集算会虚高'],
      thresholds: { maeRatio: 0.8 },
      generatedAt: '2026-10-22T12:00:00.000Z',
    })
    assert.match(md, /\| case01 \| 6\.0905 \| 9\.271 \| 0\.66 \| 达标 \|/)
  })

  test('缺数字/缺踩坑时能报出缺什么', () => {
    const md = renderReport({
      title: 'x',
      kind: 'classification',
      cases: [{ name: 'case01', output: null }, { name: 'case02', output: null }],
      pitfalls: [],
      generatedAt: '2026-10-22T12:00:00.000Z',
    })
    assert.equal(reportLooksComplete(md), false)
    const missing = missingReportParts(md)
    assert.ok(missing.includes('两个 case 的指标数字'))
    assert.ok(missing.some((m) => m.includes('踩坑记录')))
  })
})

describe('学员模式：工具面', () => {
  test('nju_lab_step 走 status → record → advance，并落盘 progress.json', async () => {
    await withClient({}, async ({ harness, workspaceDir }) => {
      const step = harness.tool('nju_lab_step')
      const status = await step.execute({ action: 'status', assignmentId: 'a-unlocked' })
      assert.match(status, /【学员模式】第 1\/6 步/)
      assert.match(status, /等学生说继续|可以进下一步|明确说继续/)
      // 学生情况也要在上下文里：工作区有什么、做到哪了
      assert.match(status, /学生当前情况/)
      assert.match(status, /还没有 output\.json/)

      const recorded = await step.execute({
        action: 'record',
        assignmentId: 'a-unlocked',
        record: { baseline_accuracy: 0.3158 },
      })
      assert.match(recorded, /已记录/)

      const advanced = await step.execute({ action: 'advance', assignmentId: 'a-unlocked' })
      assert.match(advanced, /第 2\/6 步/)

      const saved = JSON.parse(
        await readFile(join(workspaceDir, 'nju-lab', 'a-unlocked', 'progress.json'), 'utf8'),
      )
      assert.equal(saved.step, 1)
      assert.deepEqual(saved.records.understand, { baseline_accuracy: 0.3158 })
    })
  })

  test('nju_lab_finalize_report 从 output.json 生成 report.md', async () => {
    await withClient({}, async ({ harness, workspaceDir }) => {
      for (const [dir, acc] of [
        ['run_case01', 0.9474],
        ['run_case02', 0.9333],
      ]) {
        await mkdir(join(workspaceDir, dir), { recursive: true })
        await writeFile(
          join(workspaceDir, dir, 'output.json'),
          JSON.stringify({ ...OUTPUT_CLASSIFICATION, metrics: { accuracy: acc, macro_f1: acc } }),
        )
      }
      const skillDir = join(workspaceDir, 'nju-lab', 'a-unlocked', 'skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), '# demo skill\n')

      const report = harness.tool('nju_lab_finalize_report')
      const out = await report.execute({
        assignmentId: 'a-unlocked',
        title: '按花瓣尺寸识别鸢尾花品种',
        pitfalls: ['只报 accuracy 不够', '只用花瓣长度时错得更多'],
        thresholds: { accuracy: 0.9, macroF1: 0.85 },
      })
      assert.match(out, /已生成实验报告/)
      assert.match(out, /齐全/)

      const md = await readFile(join(skillDir, 'report.md'), 'utf8')
      assert.match(md, /\| run_case01 \| 0\.9474 \|/)
      assert.match(md, /!\[run_case01 图 1\]\(figures\/data_overview\.png\)/)
      assert.equal(reportLooksComplete(md), true, '生成的报告应满足平台齐全口径')
    })
  })

  test('没有 output.json 时给出可操作的提示，而不是生成空报告', async () => {
    await withClient({}, async ({ harness }) => {
      const out = await harness.tool('nju_lab_finalize_report').execute({ assignmentId: 'a-unlocked' })
      assert.match(out, /没找到 output\.json/)
    })
  })
})
