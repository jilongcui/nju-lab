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
  upgradeKind,
  kindFromDeclaration,
  rebaseKind,
  stepList,
  renderStepList,
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
    // 二分类看 recall/precision；检索类看 recall_at_*；rmse 也算回归
    assert.equal(detectKind({ metrics: { recall: 0.7, precision: 0.5, accuracy: 0.9 } }), 'detection')
    assert.equal(detectKind({ metrics: { recall_at_3_vector: 0.8, recall_at_3_keyword: 0.5 } }), 'retrieval')
    assert.equal(detectKind({ metrics: { mae: 1.2, rmse: 1.5 } }), 'regression')
    assert.equal(detectKind({ metrics: { recall: 0.7 }, training: { history: [] } }), 'detection')
    // 工程实现型（2026-10-31）：没有 metrics，交付的是"逐字段可比的结构"
    assert.equal(detectKind({ items: [], critical_alerts: [], summary: {} }), 'engineering')
    assert.equal(detectKind({ responses: [], discovered: {}, stats: {} }), 'engineering')
    assert.equal(detectKind({ snapshots: [], retrievals: [], final: {} }), 'engineering')
    assert.equal(detectKind({ perceive: [], decisions: [], messages: [], memory_after: {}, counts: {} }), 'engineering')
    assert.equal(detectKind({}), 'generic')
    assert.equal(detectKind(null), 'generic')
  })

  test('工程实现型的六步：不出现"定基线 / 报指标"', () => {
    const steps = stepsFor('engineering')
    assert.equal(steps.length, 6)
    assert.deepEqual(steps.map((s) => s.id), ['understand', 'look', 'build', 'verify', 'edge', 'report'])
    const text = steps.map((s) => `${s.title} ${s.ask}`).join(' ')
    assert.doesNotMatch(text, /定基线/)
    assert.doesNotMatch(text, /accuracy|macro F1/)
    assert.equal(steps[2].title.includes('口径'), true)
    assert.equal(steps[5].owner, 'coach')
    assert.equal(steps[0].owner, 'student')
  })

  test('工程实现型的报告：列换成交付项/边界结果，第 3 节不是基线对照', () => {
    const md = renderReport({
      title: '把检验判定写成脚本',
      kind: 'engineering',
      cases: [
        {
          name: 'case01',
          output: {
            items: new Array(10).fill({ item: 'K', flag: 'normal' }),
            critical_alerts: [{ item: 'K', value: 6.2, threshold: 6.2, side: 'high' }],
            summary: { counts: { normal: 9 }, n_unknown: 1 },
            figures: [{ path: 'figures/flags.png', takeaway: '10 项里 1 项危急' }],
            notes: '判定下沉给脚本，边界方向照题干。',
          },
        },
        {
          name: 'case02',
          output: {
            items: new Array(12).fill({ item: 'K', flag: 'normal' }),
            critical_alerts: [],
            summary: { counts: { normal: 10 }, n_unknown: 2 },
            figures: [],
            notes: '两个 case 的判定都与 expected 一致。',
          },
        },
      ],
      pitfalls: ['恰好等于危急阈值也要报警'],
      generatedAt: '2026-10-31T12:00:00.000Z',
    })
    assert.match(md, /\| case \| 交付项 \| 边界 \/ 关键结果 \| 是否达标（按任务要求） \|/)
    assert.match(md, /\| case01 \| items 10 项 \| 危急 1 条，unknown 1 项 \| 按任务要求 \|/)
    assert.match(md, /## 3\. 对照做法（偷懒解）/)
    assert.doesNotMatch(md, /## 3\. 基线对照/)
    assert.match(md, /偷懒做法：/)
    assert.equal(reportLooksComplete(md), true)
  })

  test('先判成 generic，等产出出现再升级为 engineering（只在没动过时）', () => {
    const base = newGuideState('a-2', 'generic')
    const up = upgradeKind(base, { items: [], critical_alerts: [] })
    assert.equal(up.kind, 'engineering')
    assert.equal(up.step, 0)
    assert.equal(up.confirmed, 0)
    // 已经动过（走到后面 / 记录过产出）就不升级，避免把进度打回第 1 步
    assert.equal(upgradeKind({ ...base, step: 2, confirmed: 1 }, { items: [] }).kind, 'generic')
    assert.equal(upgradeKind({ ...base, records: { understand: { ok: true } } }, { items: [] }).kind, 'generic')
    // 别的类型不动；识别不出也保持 generic；节奏选择保留
    assert.equal(upgradeKind(newGuideState('a-3', 'classification'), { items: [] }).kind, 'classification')
    assert.equal(upgradeKind(base, {}).kind, 'generic')
    assert.equal(upgradeKind({ ...base, mode: 'manual' }, { items: [] }).mode, 'manual')
  })

  test('题目包里的声明优先：manifest 的 flow / task.md 的「流程归属」', () => {
    assert.equal(kindFromDeclaration('{"flow": "engineering"}'), 'engineering')
    assert.equal(kindFromDeclaration('> **流程归属（给引导用的提示）**：本实验是**工程实现型**'), 'engineering')
    assert.equal(kindFromDeclaration('{"flow": "ml"}'), null)
    assert.equal(kindFromDeclaration('# 关系数据库\n\n## 业务背景'), null)
    assert.equal(kindFromDeclaration(null), null)
  })

  test('数据库 / 知识库类：声明与产出都能认出来，且没有"定基线"', () => {
    assert.equal(kindFromDeclaration('{"flow": "database"}'), 'database')
    assert.equal(kindFromDeclaration('> **流程归属**：本实验是**数据库 / 知识库类**'), 'database')
    assert.equal(detectKind({ schema: {}, query_results: {} }), 'database')
    assert.equal(detectKind({ retrieval: [] }), 'database')
    const steps = stepsFor('database')
    assert.deepEqual(steps.map((s) => s.id), ['understand', 'look', 'setup', 'crud', 'verify', 'report'])
    const text = steps.map((s) => `${s.title} ${s.ask}`).join(' ')
    assert.doesNotMatch(text, /定基线/)
    assert.match(text, /建库建表|向量化入库|三元组建图/)
  })

  test('落盘 kind 与声明不符时重排（保留 records / mode，step 归零）', () => {
    const stale = { ...newGuideState('a-4', 'classification'), step: 3, confirmed: 2, mode: 'auto', records: { understand: { ok: true } } }
    const fixed = rebaseKind(stale, 'engineering')
    assert.equal(fixed.kind, 'engineering')
    assert.equal(fixed.step, 0)
    assert.equal(fixed.confirmed, 0)
    assert.equal(fixed.mode, 'auto')
    assert.deepEqual(fixed.records, { understand: { ok: true } })
    // 没有声明 / 声明相同 → 原样不动
    assert.equal(rebaseKind(stale, null), stale)
    assert.equal(rebaseKind(stale, 'classification'), stale)
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

describe('学员模式：六步清单', () => {
  test('✓ 已完成 / ▶ 当前 / ○ 未开始，并标出谁动手', () => {
    let state = newGuideState('a-1', 'classification')
    state = { ...state, mode: 'manual' }
    let list = stepList(state)
    assert.equal(list.length, 6)
    assert.equal(list[0].current, true)
    assert.equal(list[0].done, false)
    assert.equal(list[5].owner, 'coach')
    assert.match(renderStepList(state), /▶ 1\. 看清需求 {2}← 当前步（学员做）/)

    state = advanceStep(advanceStep(state))
    list = stepList(state)
    assert.deepEqual(list.map((s) => s.done), [true, true, false, false, false, false])
    assert.equal(list[2].current, true)

    // auto 模式下前几步改成 AI 做
    const auto = { ...state, mode: 'auto' }
    assert.equal(stepList(auto)[2].owner, 'coach')
    assert.equal(stepList(auto)[5].owner, 'coach')
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
      // 学生情况也要在上下文里：在帮谁做、工作区有什么、做到哪了
      assert.match(status, /正在帮：示例学生一（学号 student1）/)
      assert.match(status, /学生情况|学生当前情况/)
      // 教导模式：动手的是学员，AI 只讲解/检查（否则模型会一路替他做完）
      assert.match(status, /这一步由\*\*学员\*\*完成/)
      assert.match(status, /不要替他写脚本/)
      // 最后一步才归 AI
      const steps = stepsFor('classification')
      assert.deepEqual(
        steps.map((s2) => s2.owner),
        ['student', 'student', 'student', 'student', 'student', 'coach'],
      )
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

  test('实验开始时先让学员选节奏；set_mode 后按模式换口径', async () => {
    await withClient({}, async ({ harness, workspaceDir }) => {
      const step = harness.tool('nju_lab_step')
      const first = await step.execute({ action: 'status', assignmentId: 'a-unlocked' })
      assert.match(first, /先让他选节奏/, '第一次进来必须先问自动还是手动')
      assert.match(first, /还没选/)

      const manual = await step.execute({ action: 'set_mode', mode: 'manual', assignmentId: 'a-unlocked' })
      assert.match(manual, /手动模式/)
      assert.match(manual, /这一步由\*\*学员\*\*完成/)
      assert.match(manual, /点审批卡片的「允许」/)

      const auto = await step.execute({ action: 'set_mode', mode: 'auto', assignmentId: 'a-unlocked' })
      assert.match(auto, /自动模式/)
      assert.match(auto, /这一步由\*\*你\*\*完成/)

      const saved = JSON.parse(
        await readFile(join(workspaceDir, 'nju-lab', 'a-unlocked', 'progress.json'), 'utf8'),
      )
      assert.equal(saved.mode, 'auto')
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
      // 学生信息写进报告头部（用户 2026-10-23 要求）
      assert.match(md, /- 学生姓名：示例学生一/)
      assert.match(md, /- 学号：student1/)
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
