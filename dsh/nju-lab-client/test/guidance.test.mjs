/**
 * L1：模型引导（`src/host/guidance.ts`）的注册面。
 *
 * 不启动 DSH：用假 ctx 捕获 `ctx.systemPrompt.section()` 与 `ctx.skills.register()`
 * 的入参，断言"模型能看到什么"的两条来源都接上了，且缺失其中任一服务时另一条仍工作。
 *
 * **真正的接线（引导文字与 skill 目录真的进了模型请求）由 L2 用例验证** —— 见
 * `test/dsh-e2e.test.mjs` 里"引导与 skill 到达模型"那条。
 *
 * 跑法：`npm test`。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/host/index.js'
import { startMockPlatform } from './mock-platform.mjs'

/**
 * 假 ctx：照 cordis 语义实现 `inject`（只在该服务存在时执行回调）与 `effect`。
 * `systemPrompt` / `skills` 可按需缺席，用来验证软依赖行为。
 */
function makeHarness({ systemPrompt = true, skills = true } = {}) {
  const sections = []
  const registered = []
  const effects = []
  const ctx = {
    tools: { register: () => () => {} },
    on: () => () => {},
    connection: { fetch: { register: () => async () => {} } },
    settings: { configure: () => () => {} }, effect: (callback) => { callback(); return () => {} },
  }
  // section / register 都返回真正的注销函数（真 DSH 里它们是 cordis effect）。
  ctx.effect = (callback, label) => {
    effects.push({ label, dispose: callback() })
    return () => {}
  }
  if (systemPrompt) {
    ctx.systemPrompt = {
      section(section) {
        sections.push(section)
        return () => {
          const at = sections.indexOf(section)
          if (at >= 0) sections.splice(at, 1)
        }
      },
    }
  }
  if (skills) {
    ctx.skills = {
      register(skill) {
        registered.push(skill)
        return () => {
          const at = registered.indexOf(skill)
          if (at >= 0) registered.splice(at, 1)
        }
      },
    }
  }
  ctx.inject = (deps, callback) => {
    if (deps.every((dep) => ctx[dep] !== undefined)) callback(ctx)
    return () => {}
  }
  return { ctx, sections, registered, effects }
}

async function withClient(options = {}, fn) {
  const platform = await startMockPlatform()
  const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-guidance-'))
  try {
    const harness = makeHarness(options)
    apply(harness.ctx, {
      serverUrl: platform.url,
      token: platform.token,
      workspaceDir,
      ...(options.config ?? {}),
    })
    await fn({ harness, platform })
  } finally {
    await platform.close()
  }
}

/** 注册表（dsh-skill）自己的名字语法：kebab-case。 */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

describe('模型引导：system prompt 段', () => {
  test('注册一段常驻引导，位置在工具说明之后、persona suffix 之前', async () => {
    await withClient({}, ({ harness }) => {
      assert.equal(harness.sections.length, 1, '应当只注册一段引导')

      const section = harness.sections[0]
      assert.match(section.name, /^nju-lab/, `段名应带插件前缀，实际 ${section.name}`)
      assert.equal(typeof section.text, 'string')
      assert.ok(section.text.length > 0)

      // DSH 内置段：1700 = TOOL_PTY，2000 = TOOL_WEB_SEARCH；我们的段要落在两者
      // 之间且不同号（同号会退化成按名字排序，位置就不再可控）。
      assert.ok(Number.isFinite(section.order), 'order 必须是有限数')
      assert.ok(
        section.order > 1700 && section.order < 2000,
        `order 应落在 1700~2000 之间（工具说明之后），实际 ${section.order}`,
      )
      assert.notEqual(section.order, 1700)
      assert.notEqual(section.order, 2000)
    })
  })

  test('引导文字点出三个工具与 Skill 根约定', async () => {
    await withClient({}, ({ harness }) => {
      const text = harness.sections[0].text
      for (const token of [
        'nju_lab_list_assignments',
        'nju_lab_claim',
        'nju_lab_submit',
        'SKILL.md',
        'nju-lab-experiment',
      ]) {
        assert.ok(text.includes(token), `引导文字里应提到 ${token}`)
      }
    })
  })
})

describe('模型引导：skill', () => {
  test('注册一个合法的 runtime skill，正文是操作手册', async () => {
    await withClient({}, ({ harness }) => {
      assert.equal(harness.registered.length, 1, '应当只注册一个 skill')

      const skill = harness.registered[0]
      assert.equal(skill.name, 'nju-lab-experiment')
      assert.match(skill.name, KEBAB, 'skill 名必须是 kebab-case，否则注册表会抛')
      assert.equal(typeof skill.description, 'string')
      assert.ok(skill.description.length > 0, 'description 不能为空')
      // dsh-tool-skill 的目录默认只渲染 500 字节，超了就被截断（描述失去信息量）。
      assert.ok(
        skill.description.length <= 500,
        `description 应 ≤ 500（目录渲染上限），实际 ${skill.description.length}`,
      )
      assert.equal(typeof skill.source, 'string', 'source 必须是字符串，否则候选校验失败')
      assert.ok(
        skill.whenToUse === undefined || typeof skill.whenToUse === 'string',
        'whenToUse 若有必须是字符串',
      )

      // 正文要点：流程、工作区布局、证据包、常见错误。
      assert.match(skill.content, /^# /, '正文应是 markdown')
      assert.equal(typeof skill.content, 'string')
      for (const token of ['nju_lab_list_assignments', 'nju_lab_claim', 'nju_lab_submit', 'SKILL.md', 'evidence.dshc']) {
        assert.ok(skill.content.includes(token), `正文里应提到 ${token}`)
      }
    })
  })

  test('卸载后段与 skill 都被注销', async () => {
    await withClient({}, ({ harness }) => {
      for (const { dispose } of harness.effects) dispose()
      assert.deepEqual(harness.sections, [], '段应随卸载撤销')
      assert.deepEqual(harness.registered, [], 'skill 应随卸载撤销')
    })
  })
})

describe('模型引导：软依赖', () => {
  test('只有 systemPrompt 时仍注册段，不碰 skill', async () => {
    await withClient({ skills: false }, ({ harness }) => {
      assert.equal(harness.sections.length, 1)
      assert.equal(harness.registered.length, 0)
    })
  })

  test('只有 skills 时仍注册 skill，不碰 prompt', async () => {
    await withClient({ systemPrompt: false }, ({ harness }) => {
      assert.equal(harness.sections.length, 0)
      assert.equal(harness.registered.length, 1)
    })
  })

  test('两者都缺席时不抛错，插件照常加载（tools 仍是硬依赖）', async () => {
    const platform = await startMockPlatform()
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nju-guidance-none-'))
    try {
      const harness = makeHarness({ systemPrompt: false, skills: false })
      apply(harness.ctx, {
        serverUrl: platform.url,
        token: platform.token,
        workspaceDir,
      })
      assert.deepEqual(harness.sections, [])
      assert.deepEqual(harness.registered, [])
    } finally {
      await platform.close()
    }
  })
})
