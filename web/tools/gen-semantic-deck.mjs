#!/usr/bin/env node
/**
 * 语义 prompt 离线验证：章节正文 →（两阶段 LLM）→ 语义 deck → 截图。
 *
 * 为什么离线做：P2 的第一风险是 **prompt 能否稳定产出「语义页 + 图示型版式」**，
 * 而不是 server 集成。用真实模型跑一遍再截图，几毛钱就能看出方向对不对；
 * 跑通了再把 prompt 搬进 `server/src/slides/slides.generator.ts`（届时 `SLIDES_PROMPT_VERSION` +1）。
 *
 * 用法：
 *   node web/tools/gen-semantic-deck.mjs                                   # 默认素材：第 4 章注意力实验
 *   node web/tools/gen-semantic-deck.mjs --source=server/fixtures/memory-strategies/README.md
 *   node web/tools/gen-semantic-deck.mjs --theme=builtin-platform-blue --pages=1,4,7
 *
 * 产物：`web/tools/shots/semantic/generated/<素材名>/`（deck.json + pNN.png + deck.html）
 * 说明：key 从 `server/.env` 现读，只用于本次调用，不落盘、不打印。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const webRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const repoRoot = resolve(webRoot, '..');
// ⚠️ 必须在 playwright 被 import 之前设置（否则它会用默认的 /tmp 路径，那里没有浏览器）
process.env.PLAYWRIGHT_BROWSERS_PATH ||= join(process.env.HOME ?? '/home/ubuntu', '.cache', 'ms-playwright');

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const sourcePath = resolve(repoRoot, argValue('source', 'server/fixtures/attention-ablation/README.md'));
const themeId = argValue('theme', 'builtin-platform-blue');
const outRoot = resolve(argValue('out', join(webRoot, 'tools', 'shots', 'semantic', 'generated')));
const onlyPages = argValue('pages', '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

// ---------- 环境（只读 server/.env，不打印任何值）----------
function readEnv() {
  const env = {};
  for (const line of readFileSync(join(repoRoot, 'server', '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = readEnv();
const API_KEY = env[env.SLIDES_LLM_API_KEY_ENV || 'DEEPSEEK_API_KEY'];
const BASE_URL = (env.SLIDES_LLM_BASE_URL || env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = env.SLIDES_MODEL || 'deepseek-flash';
if (!API_KEY) throw new Error('server/.env 里没有 DEEPSEEK_API_KEY，无法调用模型');

async function chatJson(messages, { maxTokens = 8000, temperature = 0.3 } = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`模型调用失败 ${res.status}：${raw.slice(0, 300)}`);
  const payload = JSON.parse(raw);
  const content = payload?.choices?.[0]?.message?.content ?? '';
  const usage = payload?.usage ?? {};
  console.log(
    `    · ${MODEL} ${((Date.now() - started) / 1000).toFixed(0)}s  tokens=${usage.prompt_tokens ?? '?'}+${usage.completion_tokens ?? '?'}`,
  );
  return parseLooseJson(stripFence(content));
}

/**
 * 宽松 JSON 解析：模型偶尔会在字符串**内部**用未转义的英文双引号（中文语料里很常见），
 * 直接 JSON.parse 会失败。修复思路：扫一遍，字符串内遇到的引号若后面不是结构字符
 * （`,` `}` `]` `:` 或结束），就判定为"内容引号"并补上转义。
 * （server 侧落地时必须带同样的兜底，见 `slides.generator.ts` 的 parseJsonLoose 先例。）
 */
function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        if (!inString) {
          inString = true;
          out += ch;
          continue;
        }
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j += 1;
        const next = text[j];
        if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
          inString = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
    }
    return JSON.parse(out);
  }
}

function stripFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
}

// ---------- 阶段一：大纲（intent + 骨架）----------
const INTENTS = [
  'cover', 'toc', 'section', 'claim', 'contrast', 'pillars', 'metric',
  'sequence', 'flow', 'arch', 'relation', 'timeline', 'table', 'data', 'example', 'quote', 'summary',
];

const OUTLINE_SYSTEM = [
  '你是大学课程的教学课件设计助手：把一章正文转成在线演示的**页面计划**。',
  '只输出一个 JSON 对象，不要任何解释文字。结构：',
  '{"deckTitle": string, "pages": [{"intent": string, "kicker": string, "title": string, "lede": string, "keyPoint": string, "plan": string[]}]}',
  `intent 只能取：${INTENTS.join(' | ')}。`,
  'plan 是本页要用的内容块类型，从 claim/evidence/metric/sequence/flow/arch/relation/timeline/compare/table/chart/formula/code/quote/note 里选 1–2 个。',
  '',
  '【整体结构】',
  '1) 第 1 页 intent=cover（title 用章节名，kicker 用课程名，lede 一句话交代本章要解决什么）；',
  '第 2 页 intent=toc 作「本章脉络」；最后一页 intent=summary 作小结。首尾页都不许省。',
  '2) 通读正文，梳理 2–4 个分节：每节用一页 intent=section 打头（kicker 写「第 N 节」，lede 一句话说清本节要讲清什么），',
  '其下跟 1–3 页内容页。短章可省分节页，把页数让给内容页。',
  '',
  '【选型——这是本任务的重点，务必按内容形态选，不要一水儿 claim】',
  '3) 讲清一个论断并给若干支撑 → claim；两件事/两条路线对照 → contrast；并列 2–4 个要素 → pillars；',
  '正文里有 1–4 个关键数字 → metric；有先后顺序的步骤/操作 → sequence；数据在环节间流动的管线 → flow；',
  '分层结构（层 × 组件，如系统栈）→ arch；概念之间的关系（谁依赖谁、一个中心带几个相关概念）→ relation；',
  '时间演化/路线图 → timeline；需要严格对齐的多列数值 → table；正文里有可以画成图的数值序列就用 data（柱/折线/环形）；',
  '公式推导 → formula；代码或命令 → example；一句话点睛 → quote。',
  '4) 一份 deck 至少要出现 3 种不同的内容页 intent（不许全是 claim）；relation/flow/arch/timeline 这类"图示页"',
  '只在正文确有相应结构时使用，**不要为了好看硬凑**。',
  `5) 总页数不超过 20 页（含首尾）。`,
  '',
  '【信息密度】',
  '6) keyPoint 用一句话写清「本页要让学员记住什么」（≤40 字），它只给扩写看，不上屏。',
  '7) title ≤30 字，lede ≤60 字（可省）。一页只讲一件事。',
  '',
  '【覆盖与去重】',
  '8) 分节与页面合起来覆盖正文核心知识点，不遗漏；每个知识点只讲一次，标题不许重复或高度相似。',
].join('\n');

// ---------- 阶段二：扩写（填块内容）----------
const BLOCK_SPEC = [
  'blocks 字段规范（只写本页 intent 需要的，不许写空占位）：',
  '- {"kind":"claim","text":"一句主张，≤40 字，可用 **强调**"}',
  '- {"kind":"evidence","items":["要点 3–5 条，每条 ≤20 字，电报体"]}',
  '- {"kind":"metric","items":[{"value":"0.2761","unit":"%","label":"这个数字是什么","detail":"口径/样本","tone":"up|down"}]}  1–4 个',
  '- {"kind":"sequence","items":[{"title":"步骤名","desc":"一句话","tag":"产物/耗时"}]}  2–6 步',
  '- {"kind":"flow","nodes":[{"title":"环节","desc":"做什么","highlight":true}]}  3–5 个；highlight 最多 1 个',
  '- {"kind":"arch","levels":[{"name":"层名","cells":[{"title":"组件","desc":"一句话"}]}]}  2–3 层 × ≤4 格',
  '- {"kind":"relation","nodes":[{"label":"概念","desc":"一句话","center":true}]}  3–6 个；center 只给 1 个',
  '- {"kind":"timeline","points":[{"at":"时间/阶段","title":"发生了什么","desc":"一句话","highlight":true}]}  3–6 个',
  '- {"kind":"compare","left":{"title":"A","items":["≤4 条"],"tone":"accent|up|down"},"right":{"title":"B","items":["…"]}}',
  '- {"kind":"table","head":["列名"],"rows":[["…"]],"align":["l","r"]}  ≤6 行',
  '- {"kind":"chart","chart":"bar|line|donut","labels":["≤8 个"],"series":[{"name":"系列名","values":[数字]}],"unit":"%","highlight":2}  ≤3 条序列；数值必须来自正文',
  '- {"kind":"formula","tex":"\\frac{QK^\\top}{\\sqrt{d}}","caption":"一句话说明"}  LaTeX 源码',
  '- {"kind":"code","lang":"python","content":"≤18 行代码","caption":"一句话说明"}',
  '- {"kind":"quote","text":"引文或结论","cite":"出处（可省）"}',
  '- {"kind":"note","text":"本页的补充说明（≤60 字，不是讲稿）"}',
].join('\n');

const EXPAND_SYSTEM = [
  '你在为已经定好的页面计划填充内容，产出可直接渲染的幻灯片 JSON。',
  '只输出一个 JSON 对象：{"pages": [{"intent","kicker","title","lede","blocks","notes"}]}，不要解释。',
  '',
  BLOCK_SPEC,
  '',
  '【铁律】',
  '1) intent / kicker / title 必须与给定计划**完全一致**，顺序不许变，不许增删页。',
  '2) 数字必须来自正文，不许编造；正文没给的数字就不要写 metric。',
  '3) evidence 每条 ≤20 字、≤5 条；metric ≤4 个；relation ≤6 节点；code ≤18 行。',
  '4) notes 是**讲者讲稿**（3–6 句、口语化、有过渡语、信息量比页面大），不是页面文字的重述。',
  '5) 页面上只写给学员看的内容；面向讲者的话一律进 notes。',
  '6) 【intent 与 blocks 必须匹配】cover→evidence；toc→sequence；section→evidence（本节导读，可省）；',
  'claim→claim + evidence；contrast→compare；pillars→sequence 或 evidence；metric→metric；sequence→sequence；',
  'flow→flow；arch→arch；relation→relation；timeline→timeline；table→table；data→chart；formula→formula；',
  'example→code；quote→quote；',
  'summary→claim 或 evidence。除 note（本页补充说明）外，**不要在同一页混入别的块类型**。',
  '6) notes 是**一个字符串**（不是数组），3–6 句连成一段。',
  '7) 字符串内部不要使用英文双引号；需要引用时用中文引号「」。',
].join('\n');

function outlineUserPrompt(text, course, chapter) {
  return [
    `课程：${course}`,
    `章节：${chapter}`,
    '',
    '【章节正文】',
    text.slice(0, 60000),
  ].join('\n');
}

function expandUserPrompt(outline, batch, text) {
  return [
    '【页面计划（必须原样保持 intent/kicker/title，顺序不变）】',
    JSON.stringify(batch),
    '',
    '【本 deck 的完整计划（供你理解上下文，不要为本批之外的页输出内容）】',
    JSON.stringify(outline.pages.map((p) => ({ intent: p.intent, title: p.title, keyPoint: p.keyPoint }))),
    '',
    '【章节正文】',
    text.slice(0, 60000),
  ].join('\n');
}

// ---------- 主流程 ----------
const sourceName = basename(sourcePath, extname(sourcePath));
const chapterTitle = basename(dirname(sourcePath));
const course = '分子医学人工智能理论与实验';
const dir = join(outRoot, sourceName);
mkdirSync(dir, { recursive: true });
// --reuse：直接用上次落盘的 deck.json（调 prompt 时反复重跑不再花模型钱）
const reuse = args.includes('--reuse');

let outline;
let pages;

if (reuse) {
  const saved = JSON.parse(readFileSync(join(dir, 'deck.json'), 'utf8'));
  ({ outline, pages } = saved);
  console.log(`复用 ${join(dir, 'deck.json')}（跳过模型调用）：${pages.length} 页`);
} else {
  const text = readFileSync(sourcePath, 'utf8');
  console.log(`素材：${sourcePath}（${text.length} 字符）`);

  console.log('阶段一：出页面计划…');
  outline = await chatJson(
    [
      { role: 'system', content: OUTLINE_SYSTEM },
      { role: 'user', content: outlineUserPrompt(text, course, chapterTitle) },
    ],
    { maxTokens: 8000 },
  );
  console.log(`  ${outline.pages.length} 页：${outline.pages.map((p) => p.intent).join(' → ')}`);
  const distinct = new Set(outline.pages.map((p) => p.intent));
  console.log(`  版式多样性：${distinct.size} 种（${[...distinct].join('/')}）`);

  console.log('阶段二：分批扩写…');
  pages = [];
  const BATCH = 4;
  for (let i = 0; i < outline.pages.length; i += BATCH) {
    const batch = outline.pages.slice(i, i + BATCH);
    const result = await chatJson(
      [
        { role: 'system', content: EXPAND_SYSTEM },
        { role: 'user', content: expandUserPrompt(outline, batch, text) },
      ],
      { maxTokens: 16000 },
    );
    const got = Array.isArray(result.pages) ? result.pages : [];
    // 以计划为准逐页归一：缺内容就用骨架兜底（页数/顺序永不漂移）
    batch.forEach((plan, k) => {
      const pageResult = got[k] ?? {};
      pages.push({
        intent: plan.intent,
        kicker: plan.kicker ?? '',
        title: plan.title ?? '',
        lede: plan.lede ?? '',
        blocks:
          Array.isArray(pageResult.blocks) && pageResult.blocks.length
            ? pageResult.blocks
            : [{ kind: 'evidence', items: plan.plan ?? [] }],
        notes: Array.isArray(pageResult.notes)
          ? pageResult.notes.join('')
          : (pageResult.notes ?? plan.keyPoint ?? ''),
      });
    });
    console.log(`  批 ${i / BATCH + 1}：${batch.length} 页（返回 ${got.length} 页）`);
  }

  // 先落盘：渲染/截图失败时不必重花一次模型调用
  writeFileSync(join(dir, 'deck.json'), JSON.stringify({ outline, pages }, null, 2), 'utf8');
}

// ---------- 打包渲染层（esbuild + `?raw` 资产插件）----------
const rawPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (a) => ({
      path: resolve(dirname(a.importer), a.path.replace(/\?raw$/, '')),
      namespace: 'raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
      contents: `export default ${JSON.stringify(readFileSync(a.path, 'utf8'))}`,
      loader: 'js',
    }));
  },
};
const bundle = join(tmpdir(), `semantic-gen-${process.pid}.mjs`);
await esbuild.build({
  stdin: {
    contents: `export { buildSemanticDeckHtml } from './src/slides/semantic/stage';`,
    resolveDir: webRoot,
    loader: 'ts',
    sourcefile: 'gen-entry.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  plugins: [rawPlugin],
  logLevel: 'silent',
});
const { buildSemanticDeckHtml } = await import(pathToFileURL(bundle).href);

const blockKinds = pages.map((p) => `${p.intent}(${p.blocks.map((b) => b.kind).join('+')})`);
console.log(`渲染前自检：\n  ${blockKinds.join('\n  ')}`);

let html;
try {
  html = await buildSemanticDeckHtml({ pages, meta: { course, chapter: chapterTitle }, themeId });
} catch (err) {
  console.error('渲染失败：', err?.stack ?? err);
  process.exit(1);
}
writeFileSync(join(dir, 'deck.html'), html, 'utf8');

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(dir, 'deck.html')).href, { waitUntil: 'load' });
await page.addStyleTag({ content: '.slide{transition:none !important}' });
await page.waitForTimeout(150);
const targets = onlyPages.length ? onlyPages : pages.map((_, i) => i + 1);
let current = 1;
for (const pageNo of targets) {
  while (current < pageNo) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    current += 1;
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(dir, `p${String(pageNo).padStart(2, '0')}.png`) });
}
await browser.close();
console.log(`\n完成：${pages.length} 页 → ${dir}`);
