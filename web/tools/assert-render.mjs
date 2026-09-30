/**
 * 幻灯片渲染层断言（esbuild + jsdom，毫秒级，不依赖浏览器与后端，不烧额度）
 *
 * 用法：`node web/tools/assert-render.mjs`
 * 覆盖（HANDOFF §10.4 的固化 + 2026-09-29 版式系统升级后的新断言 + 2026-09-30 图片版式）：
 *   · 注入清理：内容里的 <script> / onerror / javascript: 一律进不了最终文档；
 *     整份文档的 <script> 只剩内联的 2 个（reveal 本体 + 桥接脚本）
 *   · 新版式渲染：agenda / steps / stat / compare / kicker 的 DOM 结构
 *   · 图片版式：image / image-full / image-left / image-right / image-grid 的 DOM 与占位回退
 *   · 自适应缩档：超重页必带 deck-fit-3、正常页不带 deck-fit
 *   · 代码块转义、notes、页数
 * 改渲染层（renderDeck.ts / markdown.ts / template.schema.ts 的 designToCss）后必跑。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import esbuild from 'esbuild';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

// 1) 打包渲染层（renderDeck.ts → 单文件 ESM），在 Node 里跑。
// reveal 资产走 vite virtual 模块（vite.config.ts 的 revealRawPlugin），esbuild 解析不到 ——
// 用插件打桩成占位文本（断言只关心内容与结构，不跑 reveal 本体）
const stubVirtual = {
  name: 'stub-virtual',
  setup(build) {
    build.onResolve({ filter: /^virtual:/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default "/* virtual asset stub */";',
    }));
  },
};

const dir = mkdtempSync(join(tmpdir(), 'deck-render-'));
const bundle = join(dir, 'renderDeck.mjs');
await esbuild.build({
  entryPoints: [new URL('../src/slides/renderDeck.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  plugins: [stubVirtual],
  outfile: bundle,
  logLevel: 'silent',
});

// 2) jsdom 提供 DOMParser（markdown.ts 的白名单清理靠它）
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;

const { buildDeckHtml } = await import(pathToFileURL(bundle).href);

// virtual 模块（reveal 资产）在 esbuild 下解析不到 —— 用占位文本顶替
// （断言只关心内容与结构，不跑 reveal 本体）
const TEMPLATE = {
  baseTheme: 'simple',
  css: ':root { --deck-primary: #1677ff; --deck-accent: #0958d9; --deck-radius: 8px; --deck-gap: 0.55em; }',
};

// 图片版式：file 引用统一走 imageDataUrls 预取（这里给一个假 data URL 模拟「已取到」）；
// MISSING_REF 故意不给，验证「取不到 → 占位说明、绝不外链」的回退路径
const IMG_REF = 'file:12345678-1234-1234-1234-1234567890ab';
const MISSING_REF = 'file:00000000-1111-2222-3333-444444444444';
const IMG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

async function render(slides) {
  try {
    return await buildDeckHtml({
      slides,
      template: TEMPLATE,
      config: {},
      imageDataUrls: { [IMG_REF]: IMG_DATA_URL },
    });
  } catch (error) {
    // virtual 模块缺失时退化为占位：直接替换掉加载逻辑不可行，故整体跳过
    return `__ERROR__${(error && error.message) || error}`;
  }
}

const XSS_TITLE = '<script>alert(1)</script>标题';
const slides = [
  { id: 's1', layout: 'cover', kicker: '课程名', title: '章节标题', subtitle: '副标题' },
  { id: 's2', layout: 'agenda', kicker: '课程名', title: '本章脉络', bullets: ['第一节', '第二节'] },
  {
    id: 's3',
    layout: 'bullets',
    title: XSS_TITLE,
    bullets: ['正常要点', '<img src=x onerror=alert(1)>', '[点我](javascript:alert(1))'],
    notes: '讲稿备注',
  },
  { id: 's4', layout: 'steps', title: '操作步骤', bullets: ['第一步', '第二步', '第三步'] },
  {
    id: 's5',
    layout: 'stat',
    title: '关键数字',
    stats: [{ value: '75%', label: '掌握率', detail: '课后自测' }],
  },
  {
    id: 's6',
    layout: 'compare',
    title: '对比',
    compare: { leftTitle: '旧方法', rightTitle: '新方法', left: ['慢'], right: ['快'] },
  },
  {
    id: 's7',
    layout: 'code',
    title: '代码',
    code: { lang: 'js', content: 'const a = "<script>alert(1)</script>";' },
  },
  {
    id: 's8',
    layout: 'bullets',
    title: '超重页',
    bullets: Array.from({ length: 8 }, (_, i) => `第${i + 1}条${'很长的要点'.repeat(20)}`),
  },
  { id: 's9', layout: 'bullets', kicker: '不该出现的眉题', title: '轻量页', bullets: ['短'] },
  // —— 图片版式（新增页一律放末尾，别动上面既有页的位次，下方有按位断言） ——
  { id: 's10', layout: 'image', title: '单图', image: { url: IMG_REF, caption: '示意图' } },
  { id: 's11', layout: 'image-full', image: { url: IMG_REF } },
  {
    id: 's12',
    layout: 'image-left',
    title: '左图',
    bullets: ['要点一'],
    image: { url: IMG_REF },
  },
  {
    id: 's13',
    layout: 'image-right',
    bullets: ['要点A'],
    image: { url: IMG_REF },
  },
  {
    id: 's14',
    layout: 'image-grid',
    title: '多图',
    images: [
      { url: IMG_REF, caption: '图1' },
      { url: IMG_REF },
      { url: IMG_REF },
      { url: IMG_REF },
    ],
  },
  { id: 's15', layout: 'image', image: { url: MISSING_REF, caption: '已删除的图' } },
  // 仪式型页面的弱化要点（教师手工加的"本节导览"）：应渲染成 deck-teaser，不是正文 deck-bullets
  { id: 's16', layout: 'section', kicker: '第 1 节', title: '分节标题', bullets: ['导览一', '导览二'] },
];

const html = await render(slides);
check('文档构建成功', !html.startsWith('__ERROR__'), html.startsWith('__ERROR__') ? html.slice(0, 200) : '');

if (!html.startsWith('__ERROR__')) {
  // —— 注入清理 ——
  const scriptTags = (html.match(/<script>/g) ?? []).length;
  check('文档内 <script> 仅剩内联 2 个', scriptTags === 2, `实际 ${scriptTags}`);
  // 可执行形态必须不存在；代码块里的转义文本 &lt;script&gt;alert(1) 是安全的（下面单独断言）
  check('内容里的可执行 <script>alert(1) 被清除', !html.includes('<script>alert(1)'));
  check('onerror 被清除', !html.includes('onerror'));
  check('javascript: 被清除', !html.includes('javascript:'));

  // —— 新版式 ——
  const sections = html.split('<section').slice(1);
  check('封面：kicker 眉题', html.includes('deck-kicker'));
  check('封面：装饰线', html.includes('deck-cover-rule'));
  check('目录页 ol.deck-agenda', html.includes('class="deck-agenda"'));
  check('步骤页 ol.deck-steps', html.includes('class="deck-steps"'));
  check('大数字页 deck-stats / deck-stat-value', html.includes('deck-stats') && html.includes('deck-stat-value'));
  check('对比页 deck-compare / 列标题', html.includes('deck-compare') && html.includes('deck-compare-head'));
  check('要点列表带 deck-bullets class', html.includes('class="deck-bullets"'));
  check(
    '分节页要点弱化为 deck-teaser（非正文 deck-bullets）',
    (sections[15]?.includes('class="deck-teaser"') ?? false) && !sections[15]?.includes('deck-bullets'),
  );
  check('分节页 kicker「第 N 节」上屏', sections[15]?.includes('deck-kicker') ?? false);

  // —— 图片版式 ——
  check('单图页 img.deck-image + 图注', html.includes('img class="deck-image"') && html.includes('示意图'));
  check('全幅页 img.deck-image-full', html.includes('img class="deck-image-full"'));
  check('左图右文页 deck-split（正向）', sections[11]?.includes('class="deck-split"') ?? false);
  check('左图右文页 图与文两栏齐备', sections[11]?.includes('deck-split-media') && sections[11]?.includes('deck-split-body') ? true : false);
  check('右图左文页 deck-split-right', sections[12]?.includes('deck-split-right') ?? false);
  const gridCells = (html.match(/class="deck-grid-cell"/g) ?? []).length;
  check('多图网格 deck-grid-4 + 4 格', html.includes('deck-grid deck-grid-4') && gridCells === 4, `格数 ${gridCells}`);
  check('多图网格页超重缩档 deck-fit-2', sections[13]?.includes('deck-fit-2') ?? false);
  check('取不到的图片显示占位（不外链）', html.includes('（图片不可用：已删除的图）'));

  // —— 自适应缩档 ——
  check('页数正确', sections.length === slides.length, `${sections.length}/${slides.length}`);
  check('超重页带 deck-fit-3', sections[7]?.includes('deck-fit-3') ?? false);
  check('轻量页不带 deck-fit', !sections[8]?.includes('deck-fit-'));
  check('内容页的 kicker 不上屏（眉题只在仪式型页面）', !sections[8]?.includes('deck-kicker'));

  // —— 既有不变量 ——
  check('代码块内容被转义', html.includes('&lt;script&gt;'));
  check('讲者备注 aside.notes', html.includes('<aside class="notes">讲稿备注</aside>'));
  check('桥接脚本存在', html.includes('__deckAction'));
}

rmSync(dir, { recursive: true, force: true });
const failed = results.filter(([, ok]) => !ok);
console.log('\n结论：', failed.length ? `${failed.length} 项失败 ✗` : '全部通过 ✓');
process.exit(failed.length ? 1 : 0);
