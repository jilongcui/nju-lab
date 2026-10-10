#!/usr/bin/env node
/**
 * 语义模型（v2）服务端断言：校验/归一/结构自辨识/只读投影。
 *
 * 用法：`node server/tools/assert-semantic-schema.mjs`（Node 24 直接跑 TS，无需构建）
 * 覆盖：
 *   · 合法页通过；intent 非法 → 降级为 claim 并记 warning
 *   · 块级预算：evidence ≤5、metric ≤4、relation ≤6、table ≤6 行、code ≤20 行
 *   · 语义不变式：relation 中心节点有且仅有一个；flow 高亮最多一个
 *   · 非法块（未知 kind / 图片引用不合规 / 空数组）一律丢弃并记 warning，绝不产出畸形页
 *   · 结构自辨识：v2（有 intent）与 v1（有 layout）不会互相误判 —— 这是「不需要迁移」的前提
 *   · 只读 Markdown 投影：含 intent 标注，供教师端预览
 *   · 宽松 JSON：字符串内部未转义引号可被修复（真实模型输出里高频出现）
 */
import {
  isSemanticDeck,
  parseLooseJson,
  semanticToMarkdown,
  validateSemanticPages,
} from '../src/slides/semantic.schema.ts';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

const LIMITS = { maxPages: 20, maxNotes: 4000 };

// ---------------- 1. 合法页 ----------------
const good = validateSemanticPages(
  [
    {
      intent: 'claim',
      kicker: '核心',
      title: '一页只讲一件事',
      lede: '内容与版式解耦',
      blocks: [
        { kind: 'claim', text: '把讲什么和怎么排版分开' },
        { kind: 'evidence', items: ['要点一', '要点二', '要点三'] },
      ],
      notes: '讲稿：这一页强调解耦。',
    },
    {
      intent: 'relation',
      title: '关系',
      blocks: [
        {
          kind: 'relation',
          nodes: [
            { label: '中心', center: true },
            { label: 'A' },
            { label: 'B' },
          ],
        },
      ],
    },
  ],
  LIMITS,
);
check('合法页全部通过（无 warning）', good.pages.length === 2 && good.warnings.length === 0, `warnings=${good.warnings.length}`);
check('页面 id/字段按白名单保留', good.pages[0].intent === 'claim' && good.pages[0].blocks.length === 2);

// ---------------- 2. intent 非法 → claim ----------------
const badIntent = validateSemanticPages([{ intent: 'whatever', blocks: [{ kind: 'claim', text: 'x' }] }], LIMITS);
check('intent 非法降级为 claim 并记 warning', badIntent.pages[0].intent === 'claim' && badIntent.warnings.length === 1);

// ---------------- 3. 块级预算 ----------------
const over = validateSemanticPages(
  [
    {
      intent: 'claim',
      blocks: [
        { kind: 'evidence', items: Array.from({ length: 9 }, (_, i) => `要点${i}`) },
        { kind: 'metric', items: Array.from({ length: 7 }, (_, i) => ({ value: String(i), label: `指标${i}` })) },
        { kind: 'code', content: Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') },
      ],
    },
  ],
  LIMITS,
);
const blocks = over.pages[0].blocks;
check('evidence 超量被裁到 5 条', blocks[0].items.length === 5);
check('metric 超量被裁到 4 个', blocks[1].items.length === 4);
check(`code 超行被裁到 20 行（实际 ${String(blocks[2].content).split('\n').length}）`, String(blocks[2].content).split('\n').length === 20);

const table = validateSemanticPages(
  [
    {
      intent: 'table',
      blocks: [
        {
          kind: 'table',
          head: ['a', 'b'],
          rows: Array.from({ length: 9 }, (_, i) => [`r${i}`, 'x']),
        },
      ],
    },
  ],
  LIMITS,
);
check('table 超行被裁到 6 行', table.pages[0].blocks[0].rows.length === 6);

// ---------------- 4. 语义不变式 ----------------
const center = validateSemanticPages(
  [
    {
      intent: 'relation',
      blocks: [{ kind: 'relation', nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }],
    },
  ],
  LIMITS,
);
const nodes = center.pages[0].blocks[0].nodes;
check('relation 没有中心节点时自动指定第一个', nodes.filter((n) => n.center).length === 1 && nodes[0].center === true);

const multiCenter = validateSemanticPages(
  [
    {
      intent: 'relation',
      blocks: [
        {
          kind: 'relation',
          nodes: [
            { label: 'A', center: true },
            { label: 'B', center: true },
            { label: 'C' },
          ],
        },
      ],
    },
  ],
  LIMITS,
);
check(
  'relation 多个中心节点时只保留一个',
  multiCenter.pages[0].blocks[0].nodes.filter((n) => n.center).length === 1,
);

const flow = validateSemanticPages(
  [
    {
      intent: 'flow',
      blocks: [
        {
          kind: 'flow',
          nodes: [{ title: 'A', highlight: true }, { title: 'B', highlight: true }, { title: 'C' }],
        },
      ],
    },
  ],
  LIMITS,
);
check(
  'flow 高亮节点最多一个',
  flow.pages[0].blocks[0].nodes.filter((n) => n.highlight).length === 1,
);

// ---------------- 5. 非法块与空页 ----------------
const junk = validateSemanticPages(
  [
    {
      intent: 'pillars',
      blocks: [
        { kind: 'unknown-kind', text: 'x' },
        { kind: 'image', fileId: 'not-a-uuid' },
        { kind: 'evidence', items: [] },
        { kind: 'claim', text: '' },
      ],
    },
    { intent: 'claim', blocks: [{ kind: 'evidence', items: [] }] },
    'not-an-object',
  ],
  LIMITS,
);
check('非法/空块全部丢弃，空页被跳过（不留畸形页）', junk.pages.length === 0, `pages=${junk.pages.length}`);
check('丢弃时给出可读 warning', junk.warnings.length >= 2, `warnings=${junk.warnings.length}`);

// ---------------- 6. 结构自辨识 ----------------
check('v2 deck 被识别为语义 deck', isSemanticDeck([{ intent: 'cover', blocks: [] }]) === true);
check('v1 deck 不会被误判为语义 deck', isSemanticDeck([{ id: 'x', layout: 'cover', bullets: ['a'] }]) === false);
check('空数组不算语义 deck', isSemanticDeck([]) === false);

// ---------------- 7. 只读 Markdown 投影 ----------------
const markdown = semanticToMarkdown(good.pages);
check('投影含 intent 标注与正文', markdown.includes('intent=claim') && markdown.includes('一页只讲一件事'));
check('投影标明只读（不接受回写）', markdown.includes('只读预览'));

// ---------------- 8. 宽松 JSON 解析 ----------------
const broken = '{"pages":[{"intent":"claim","notes":"他说"不要改"这句","title":"t"}]}';
let parsed = null;
let parseError = '';
try {
  parsed = parseLooseJson(broken);
} catch (error) {
  parseError = error.message;
}
check(
  '字符串内部未转义引号可被修复（真实模型高频输出）',
  !!parsed && !parseError,
  parseError || `title=${parsed.pages[0].title}`,
);

// ---------------- 汇总 ----------------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(([label]) => console.log(`  · ${label}`));
  process.exit(1);
}
