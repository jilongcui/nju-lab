#!/usr/bin/env node
/**
 * 语义渲染层断言（esbuild + jsdom，毫秒级，不依赖浏览器与后端）。
 *
 * 用法：`node web/tools/assert-semantic.mjs`
 * 覆盖：
 *   · 固定画布：文档带 1920×1080 的 .deck（缩放适配由内联运行时负责）
 *   · 语义映射：cover/toc/relation/metric/table/sequence/flow/summary/code 的 DOM 结构
 *   · 类名隔离：关系图中心节点**不能**带 base.css 的 `.center`（那是 `display:flex`，会把文字挤成两列）
 *   · 转义与注入：标题/正文/讲稿里的 <script>、onerror、javascript: 一律进不了文档；
 *     整份文档的 <script> 只有 1 个（我们自己的内联运行时）
 *   · 主题解耦：换主题 DOM 不变（只有 CSS 变）；vendor 主题的字体指向被系统字体栈覆盖
 *   · 颜色纪律：layouts.css 里不允许出现硬编码颜色（必须走 token 变量）
 *
 * 改渲染/版式/主题后必跑；截图观感评审用 `node web/tools/preview-semantic.mjs`。
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import esbuild from 'esbuild';

const webRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

// ---- 打包（`?raw` 资产插件，与 vite 语义一致）----
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

const bundle = join(tmpdir(), `semantic-assert-${process.pid}.mjs`);
await esbuild.build({
  stdin: {
    contents: [
      `export { buildSemanticDeckHtml, CANVAS } from './src/slides/semantic/stage';`,
      `export { DECK_THEMES, themeCss, findTheme } from './src/slides/semantic/theme';`,
      `export { PAGES, META } from './tools/fixtures/chapter4-deck';`,
    ].join('\n'),
    resolveDir: webRoot,
    loader: 'ts',
    sourcefile: 'semantic-assert-entry.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  plugins: [rawPlugin],
  logLevel: 'silent',
});
const { buildSemanticDeckHtml, CANVAS, DECK_THEMES, themeCss, PAGES, META } = await import(pathToFileURL(bundle).href);

const html = buildSemanticDeckHtml({ pages: PAGES, meta: META, themeId: 'builtin-platform-blue' });
const dom = new JSDOM(html);
const doc = dom.window.document;
const slides = [...doc.querySelectorAll('.slide')];

// ---------------- 1. 承载与结构 ----------------
check('页数与样张一致', slides.length === PAGES.length, `${slides.length}/${PAGES.length}`);
check(
  '固定画布尺寸为 1920×1080',
  CANVAS.width === 1920 && CANVAS.height === 1080 && /\.deck\{[^}]*1920px/.test(html) && /height:var\(--deck-h,1080px\)|1080px/.test(html),
);
check('每页有标题（data-title 非空）', slides.every((s) => (s.getAttribute('data-title') ?? '').trim().length > 0));
const scripts = [...doc.querySelectorAll('script')];
check('文档内只有 1 个内联脚本（自有运行时）', scripts.length === 1 && !scripts[0].getAttribute('src'), `scripts=${scripts.length}`);
check('运行时上报 ready 且带 total', /type:\s*'ready'/.test(scripts[0].textContent) && /total:\s*total/.test(scripts[0].textContent));
check('父窗口动作契约（next/prev/goto）齐备', ['next', 'prev', 'goto'].every((a) => scripts[0].textContent.includes(`'${a}'`)));

// ---------------- 2. 页面骨架（页脚/页码）----------------
const cover = slides[0];
check('封面不显示页脚', cover.querySelectorAll('.deck-footer').length === 0);
const nonCovers = slides.slice(1);
check(
  '其余页都有页脚 + 页码（current/total 正确）',
  nonCovers.every((s, i) => {
    const num = s.querySelector('.slide-number');
    return !!s.querySelector('.deck-footer') && num?.getAttribute('data-current') === String(i + 2) && num?.getAttribute('data-total') === String(PAGES.length);
  }),
);

// ---------------- 3. 语义映射 ----------------
const pageOf = (intent) => slides[PAGES.findIndex((p) => p.intent === intent)];
check('cover → .ly-cover（大标题）', !!pageOf('cover').querySelector('.ly-cover h1'));
check('toc → 目录卡数量 = 条目数', pageOf('toc').querySelectorAll('.ly-toc-item').length === 4);

const relPage = pageOf('relation');
const relNodes = relPage.querySelectorAll('.ly-rel-n');
const center = relPage.querySelector('.ly-rel-center');
check('relation → 中心节点 + 卫星节点', !!center && relNodes.length === 4, `nodes=${relNodes.length}`);
check(
  'relation 中心节点不带 base.css 的 .center（否则被 display:flex 挤成两列）',
  !!center && !center.classList.contains('center'),
);
check('relation → 连线数 = 卫星数', relPage.querySelectorAll('.ly-rel svg path').length === relNodes.length - 1);
check('relation → 卫星节点按绝对坐标定位', [...relNodes].every((n) => /left:.*%;top:.*%/.test(n.getAttribute('style') ?? '')));

const metricPage = pageOf('metric');
check('metric → 数字卡数量 = items 数', metricPage.querySelectorAll('.ly-metric').length === 4);
check('metric → 数值走 tabular-nums 便于对齐', /tabular-nums/.test(html));

const tablePage = pageOf('table');
check('table → 表头 5 列 / 数据 3 行', tablePage.querySelectorAll('thead th').length === 5 && tablePage.querySelectorAll('tbody tr').length === 3);
check('table → 数值列右对齐', tablePage.querySelectorAll('th.r').length === 3);

const seqPage = pageOf('sequence');
check('sequence（6 步）→ 3 列网格（不许 4+2 破行）', seqPage.querySelector('.ly-steps')?.classList.contains('cols-3'));
check('sequence → 步骤编号 1..N', [...seqPage.querySelectorAll('.ly-step-n')].map((n) => n.textContent.trim()).join(',') === '1,2,3,4,5,6');

const flowPage = pageOf('flow');
check('flow → 节点 5 个 / 箭头 4 个', flowPage.querySelectorAll('.ly-flow-node').length === 5 && flowPage.querySelectorAll('.ly-flow-arrow').length === 4);
check('flow → 恰有 1 个高亮节点', flowPage.querySelectorAll('.ly-flow-node.hl').length === 1);

check('summary → 条目数正确', pageOf('summary').querySelectorAll('.ly-sum-item').length === 3);

// ---------------- 4. 转义与注入（安全边界）----------------
const evil = [
  {
    intent: 'claim',
    title: '<img src=x onerror=alert(1)>',
    blocks: [
      { kind: 'claim', text: '</h2><script>alert("xss")</script>' },
      { kind: 'code', lang: '<b>js</b>', content: '</pre><script>alert(2)</script>' },
      { kind: 'table', head: ['<script>alert(3)</script>'], rows: [['javascript:alert(4)']] },
    ],
    notes: '</div><script>alert(5)</script>',
  },
];
const evilHtml = buildSemanticDeckHtml({ pages: evil, meta: META, themeId: 'builtin-platform-blue' });
const evilDoc = new JSDOM(evilHtml).window.document;
const evilScripts = [...evilDoc.querySelectorAll('script')];
check('注入内容里的 <script> 全部失效（只剩运行时）', evilScripts.length === 1, `scripts=${evilScripts.length}`);
const allElements = [...evilDoc.querySelectorAll('*')];
check('注入的事件属性（on*）一个都没落下', !allElements.some((el) => [...el.attributes].some((a) => /^on/i.test(a.name))));
check('注入的标签以文本形式呈现（转义生效）', evilHtml.includes('&lt;img src=x onerror='));
check(
  'javascript: 协议进不了任何 URL 属性',
  !allElements.some((el) =>
    ['href', 'src', 'xlink:href', 'action', 'formaction'].some((name) => /^\s*javascript:/i.test(el.getAttribute(name) ?? '')),
  ),
);
check('讲稿里的注入同样被转义（notes 只做文本）', !/alert\(5\)/.test(evilHtml) || !/<\/div><script>/.test(evilHtml));

// ---------------- 5. 主题解耦 ----------------
const other = DECK_THEMES.find((t) => t.id === 'builtin-nju-purple');
const html2 = buildSemanticDeckHtml({ pages: PAGES, meta: META, themeId: other.id });
const stripStyle = (value) => value.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<title>[\s\S]*?<\/title>/, '');
check('换主题后 DOM 完全不变（只有 CSS 不同）', stripStyle(html) === stripStyle(html2));

const academic = DECK_THEMES.find((t) => t.id === 'builtin-academic-white');
const academicCss = themeCss(academic);
const fontIdx = academicCss.indexOf('--font-sans');
const vendorIdx = academicCss.indexOf('--accent:');
check('系统字体栈先注入，vendor 主题字体指向被覆盖', fontIdx > -1 && fontIdx < vendorIdx && !/fonts\.googleapis/.test(academicCss));
check('主题 CSS 不引用任何外部 CDN', !DECK_THEMES.some((t) => /https?:\/\//.test(themeCss(t))));

// ---------------- 6. 颜色纪律 ----------------
const layoutsCss = readFileSync(join(webRoot, 'src/slides/semantic/layouts.css'), 'utf8');
check('版式 CSS 无硬编码颜色（全走 token 变量）', !/#[0-9a-fA-F]{3,8}\b/.test(layoutsCss) && !/\brgba?\(/.test(layoutsCss));

// ---------------- 汇总 ----------------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(([label]) => console.log(`  · ${label}`));
  process.exit(1);
}
