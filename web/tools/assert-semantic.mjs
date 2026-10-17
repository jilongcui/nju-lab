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
      `export { LEGACY_SLIDES } from './tools/fixtures/legacy-deck';`,
      `export { legacyDeckToPages, designToTokenOverrides } from './src/slides/semantic/legacy';`,
      `export { isSemanticDeck } from './src/slides/semantic/detect';`,
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
const { buildSemanticDeckHtml, CANVAS, DECK_THEMES, themeCss, PAGES, META, LEGACY_SLIDES, legacyDeckToPages, designToTokenOverrides, isSemanticDeck } =
  await import(pathToFileURL(bundle).href);

// 宿主（iframe 外层）的键盘转发也在这里断言：S 键要转给文档，否则按 S 无反应
const slideStageSrc = readFileSync(join(webRoot, 'src/slides/SlideStage.tsx'), 'utf8');
// 导出 PDF 的宿主逻辑也在这里断言
const chapterSlidesSrc = readFileSync(join(webRoot, 'src/pages/teacher/ChapterSlides.tsx'), 'utf8');
const html = await buildSemanticDeckHtml({ pages: PAGES, meta: META, themeId: 'builtin-platform-blue' });
const dom = new JSDOM(html);
const doc = dom.window.document;
// 正文页（排除导出用的讲稿页 .notes-page，放映时也是这么选的）
const slides = [...doc.querySelectorAll('.slide:not(.notes-page)')];

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
    notes: '</div><script>alert(5)</script>[<b>提示</b>]',
  },
];
const evilHtml = await buildSemanticDeckHtml({ pages: evil, meta: META, themeId: 'builtin-platform-blue' });
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
check(
  '讲稿里的 [ …… ] 备课提示也只做文本（提示里的标签进不了文档）',
  evilDoc.querySelectorAll('.slide:not(.notes-page) .notes-cue').length === 1 &&
    evilDoc.querySelector('.slide:not(.notes-page) .notes-cue').textContent === '[<b>提示</b>]' &&
    !evilHtml.includes('<b>提示</b>'),
);

// ---------------- 5. 主题解耦 ----------------
const other = DECK_THEMES.find((t) => t.id === 'builtin-nju-purple');
const html2 = await buildSemanticDeckHtml({ pages: PAGES, meta: META, themeId: other.id });
const stripStyle = (value) => value.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<title>[\s\S]*?<\/title>/, '');
check('换主题后 DOM 完全不变（只有 CSS 不同）', stripStyle(html) === stripStyle(html2));

// ---- 版式开关（layoutFlags）：默认主题必须维持改版前的观感，新版式只在新主题生效 ----
// 背景：库里已生成的章节 deck 会跟着渲染层一起变，"页眉小标固定左上角 + 页脚只写章名"
// 这两条只允许声明了 layoutFlags 的主题拿到（2026-10 用户明确要求"只让新主题生效"）。
const kickerInHead = (document_) =>
  [...document_.querySelectorAll('.slide .ly-head .kicker')].length;
const pinnedKickers = (document_) => [...document_.querySelectorAll('.slide .slide-kicker')].length;
check(
  '默认主题：kicker 仍排在标题上方（老观感不变），没有页面级 .slide-kicker',
  kickerInHead(doc) > 0 && pinnedKickers(doc) === 0,
  `in-head=${kickerInHead(doc)} pinned=${pinnedKickers(doc)}`,
);
check(
  '默认主题：页脚仍是「课程 · 章节」',
  [...doc.querySelectorAll('.deck-footer > span:first-child')].every((el) =>
    el.textContent.includes('·') || !META.course,
  ),
  (doc.querySelector('.deck-footer > span:first-child')?.textContent ?? '').slice(0, 40),
);
const njuHtml = await buildSemanticDeckHtml({ pages: PAGES, meta: META, themeId: 'builtin-nju' });
const njuDoc = new JSDOM(njuHtml).window.document;
check(
  '南大风：kicker 抽成页面级 .slide-kicker（不再排在标题上方）',
  pinnedKickers(njuDoc) > 0 && kickerInHead(njuDoc) === 0,
  `pinned=${pinnedKickers(njuDoc)} in-head=${kickerInHead(njuDoc)}`,
);
check(
  '南大风：页脚只写章节名（不含课程名）',
  [...njuDoc.querySelectorAll('.deck-footer > span:first-child')].every(
    (el) => !META.course || !el.textContent.includes(META.course),
  ),
  (njuDoc.querySelector('.deck-footer > span:first-child')?.textContent ?? '').slice(0, 40),
);
check(
  '南大风：装饰层只在该主题的 CSS 里（页面色带/钟楼不会漏进别的主题）',
  njuHtml.includes('--nju-head-band') && !html.includes('--nju-head-band'),
);

const academic = DECK_THEMES.find((t) => t.id === 'builtin-academic-white');
const academicCss = themeCss(academic);
const fontIdx = academicCss.indexOf('--font-sans');
const vendorIdx = academicCss.indexOf('--accent:');
check('系统字体栈先注入，vendor 主题字体指向被覆盖', fontIdx > -1 && fontIdx < vendorIdx && !/fonts\.googleapis/.test(academicCss));
check('主题 CSS 不引用任何外部 CDN', !DECK_THEMES.some((t) => /https?:\/\//.test(themeCss(t))));

// ---------------- 6. 颜色纪律 ----------------
const layoutsCss = readFileSync(join(webRoot, 'src/slides/semantic/layouts.css'), 'utf8');
check('版式 CSS 无硬编码颜色（全走 token 变量）', !/#[0-9a-fA-F]{3,8}\b/.test(layoutsCss) && !/\brgba?\(/.test(layoutsCss));
check('版式 CSS 注释配平（注释提前闭合会让后续规则被静默丢弃）', (() => {
  let depth = 0;
  for (const match of layoutsCss.matchAll(/\/\*|\*\//g)) {
    depth += match[0] === '/*' ? 1 : -1;
    if (depth < 0) return false;
  }
  return depth === 0;
})());
check(
  '可调令牌定义在 .deck 上（字号/间距/卡片风格可被模板调参覆盖）',
  /\.deck\s*\{[^}]*--ly-scale:\s*1;/.test(layoutsCss) &&
    /\.deck\s*\{[^}]*--ly-card-bg:/.test(layoutsCss),
);
// 2026-10-10 实测补：字号写死 px 会绕过倍率（原先 55 处 + vendor 15 处），
// 在 1920 画布上再缩到容器就只剩十来像素 —— 用户直接反馈「文字太小」。
check('字号整体倍率 --fs-boost 定义在 .deck 上（画布级）', /\.deck\s*\{[^}]*--fs-boost:\s*[0-9.]+;/.test(layoutsCss));
const typeCss = [
  ['semantic/layouts.css', layoutsCss],
  ['vendor/html-ppt/base.css', readFileSync(join(webRoot, 'src/slides/vendor/html-ppt/base.css'), 'utf8')],
];
const bareFontPx = typeCss.flatMap(([name, css]) =>
  [...css.matchAll(/font-size:\s*([0-9.]+)px\b/g)].map((m) => `${name}:${m[1]}px`),
);
check('所有 px 字号都乘 --fs-boost（没有写死 px 的字号）', bareFontPx.length === 0, bareFontPx.slice(0, 6).join(' '));
check(
  '字号倍率在合理区间（1.2–1.5：上屏可读，且离线 13 页四档实测不越界）',
  (() => {
    const m = layoutsCss.match(/--fs-boost:\s*([0-9.]+);/);
    const value = m ? Number(m[1]) : 0;
    return value >= 1.2 && value <= 1.5;
  })(),
);
// 总览（缩略图墙）：2026-10-10 之前只有父窗口 post('overview') 与提示文案，运行时没实现，按 O 无反应
check(
  '运行时实现总览：overview 动作 / O 键 / 克隆缩略图都在',
  html.includes("action === 'overview'") &&
    html.includes('function buildOverview') &&
    html.includes('function toggleOverview') &&
    html.includes('layoutThumbs'),
);
check(
  '总览缩略图复用舞台令牌（容器带 deck 类 → 版式与字号一致）',
  html.includes('thumb-canvas deck'),
);
check(
  '总览缩略图固定 16:9 并按左上角对齐（base.css 的 .deck 是 center center）',
  /\.overview \.thumb\s*\{[^}]*aspect-ratio:\s*16 \/ 9/.test(layoutsCss) &&
    /\.overview \.thumb-canvas\s*\{[^}]*transform-origin:\s*unset|\.overview \.thumb-canvas\s*\{[^}]*top:\s*0/.test(
      layoutsCss,
    ),
);
check(
  '总览开着时 Esc 先关总览（再按一次才退出放映）',
  html.includes('if (isOverviewOpen()) { closeOverview(); return; }') && html.includes('closeOverview'),
);
check(
  '总览开着时"点两侧翻页"不生效（否则点缩略图会被再翻一页）',
  html.includes("if (isOverviewOpen()) return;") && html.includes('event.stopPropagation();'),
);
check(
  '讲稿浮层：宿主把 S 键转成 toggle-notes 动作（否则按 S 无反应 —— 实测踩过）',
  html.includes('toggle-notes') && slideStageSrc.includes("post('toggle-notes')"),
);
check(
  '宿主页面的 Esc 交给文档判（escape 动作）',
  html.includes("data.action === 'escape'"),
);
// 运行时是**模板字符串**：注释里出现反引号会让字符串提前闭合、整段脚本错乱（2026-10-10 实测踩到，
// 表现为总览打开但缩略图缩成一条线）。这条断言直接查源码里那段模板串。
const stageSrc = readFileSync(join(webRoot, 'src/slides/semantic/stage.ts'), 'utf8');
const runtimeStart = stageSrc.indexOf('return `(function () {') + 'return `'.length;
const runtimeEnd = stageSrc.indexOf('})();`;');
const runtimeBody = stageSrc.slice(runtimeStart, runtimeEnd);
check(
  '运行时模板串内没有裸反引号（否则脚本被提前截断）',
  runtimeBody.length > 2000 && !runtimeBody.includes('`'),
  `模板串 ${runtimeBody.length} 字符`,
);
check(
  '运行时脚本首尾完整（就绪回调在末尾）',
  html.includes('(function () {') && html.includes('document.fonts.ready') && html.includes('requestAnimationFrame(layoutThumbs)'),
);

// ---------------- 6.4 溢出兜底与图并排（2026-10-12）----------------
// 渲染层源码：图并排等结构断言要用（定义在此，供 6.4/6.5 共用）
const renderSrc = readFileSync(join(webRoot, 'src/slides/semantic/render.ts'), 'utf8');
// 学员反馈：有图或有代码时容易顶掉页脚（实测第 2 章 code+图页超出 72px）。
check(
  '运行时实现溢出兜底：内容超出安全高度时整页等比缩小',
  html.includes('function autofit') && html.includes('SAFE_H') && html.includes('ly.offsetHeight'),
);
check(
  '截图/测量要等图片就绪（否则量出来的高度偏小，兜底会失效）',
  html.includes('function whenImagesReady') && html.includes('whenImagesReady(finish)'),
);
check(
  '图与主内容并排（代码页 + 图不再垂直堆叠）',
  renderSrc.includes('ly-split-main') && renderSrc.includes('ly-split-media'),
);
check(
  '并排布局的 CSS 到位（两栏 + 图高让位给内容）',
  /\.ly-split\s*\{[^}]*grid-template-columns/.test(layoutsCss) &&
    /\.ly-split-media\s*\{[^}]*--ly-img-box-h:\s*420px/.test(layoutsCss),
);

// ---------------- 6.5 插图版式（2026-10-12 重做）----------------
// 背景：此前给图片框强加 aspect-ratio:16/9，比例不符的图（近方图/宽扁图）被缩小留白，
// 看起来"图小、四周空"；且 .img-frame 没有卡片外观，图直接裸贴。
check(
  '图片框不再强制固定比例（比例由图片自身决定）',
  !/\.ly-media[^{]*\.img-frame\s*\{[^}]*aspect-ratio/.test(layoutsCss) &&
    !/\.ly-media\.full\s*\.img-frame\s*\{[^}]*aspect-ratio/.test(layoutsCss),
);
check(
  '图片框是卡片（边框 + 圆角 + 底色 + 阴影）',
  /\.img-frame\s*\{[^}]*border:\s*1px solid var\(--border\)/.test(layoutsCss) &&
    /\.img-frame\s*\{[^}]*border-radius:/.test(layoutsCss) &&
    /\.img-frame\s*\{[^}]*background:\s*var\(--surface\)/.test(layoutsCss),
);
check('图片框宽度贴合图比例（fit-content，避免容器留白边）', /\.img-frame\s*\{[^}]*width:\s*fit-content/.test(layoutsCss));
check('图宽受限时才按比例缩（object-fit: contain，不拉伸）', /\.img-frame > img\s*\{[^}]*object-fit:\s*contain/.test(layoutsCss));
check(
  '图 + 文字构成两栏（图 | 要点/主张），避免小图孤零零居中',
  renderSrc.includes('ly-media-figure') && renderSrc.includes('ly-media-side'),
);
check(
  'image 页的 claim 被主渲染器消费（不会重复渲染一遍）',
  /image: \['image', 'evidence', 'claim', 'note'\]/.test(renderSrc),
);

// ---------------- 7. 旧模型适配器（平台既有 deck 的迁移路径）----------------
const legacyPages = legacyDeckToPages(LEGACY_SLIDES);
const intentAt = (layout) => legacyPages[LEGACY_SLIDES.findIndex((s) => s.layout === layout)].intent;
check('适配器：页数不变（不丢页）', legacyPages.length === LEGACY_SLIDES.length);
check(
  '适配器：16 种旧版式全部有映射',
  [
    ['cover', 'cover'],
    ['agenda', 'toc'],
    ['section', 'section'],
    ['bullets', 'claim'],
    ['steps', 'sequence'],
    ['stat', 'metric'],
    ['compare', 'contrast'],
    ['two-col', 'pillars'],
    ['code', 'example'],
    ['quote', 'quote'],
    ['image', 'image'],
    ['image-full', 'image'],
    ['image-left', 'image'],
    ['image-grid', 'image'],
    ['end', 'summary'],
  ].every(([layout, intent]) => intentAt(layout) === intent),
);
check('适配器：agenda 的条目数 = bullets 数', legacyPages[1].blocks[0].items.length === LEGACY_SLIDES[1].bullets.length);
check('适配器：stat → metric 保留数字/标签/说明', (() => {
  const block = legacyPages[5].blocks[0];
  return block.kind === 'metric' && block.items.length === 3 && block.items[2].value === '0.8';
})());
check('适配器：compare 保留左右列标题', (() => {
  const block = legacyPages[6].blocks[0];
  return block.kind === 'compare' && block.left.title.includes('更新') && block.right.title.includes('遗忘');
})());
check('适配器：two-col 的 Markdown 降级为纯文本（不留 ** 与 #）', (() => {
  const block = legacyPages[7].blocks[0];
  return block.kind === 'evidence' && block.items.every((t) => !/[*#`]/.test(t));
})());
check('适配器：image-grid → 多图网格块（≤4 张）', (() => {
  const block = legacyPages[13].blocks[0];
  return block.kind === 'image' && block.role === 'grid' && block.items.length === 3;
})());
check('适配器：image-left → 图文并排（图 + 要点都在）', (() => {
  const blocks = legacyPages[12].blocks;
  return blocks.some((b) => b.kind === 'image' && b.role === 'hero') && blocks.some((b) => b.kind === 'evidence');
})());
check('适配器：讲稿原样带过来', legacyPages[0].notes === LEGACY_SLIDES[0].notes);

const legacyHtml = await buildSemanticDeckHtml({ pages: legacyPages, meta: META, themeId: 'builtin-platform-blue' });
const legacyDoc = new JSDOM(legacyHtml).window.document;
check(
  '适配器：图片拿不到时渲染占位（不产空 src、不发外部请求）',
  // 6 处图片引用（单图 / 大图 / 并排各 1 + 网格 3）全部退化为占位
  legacyDoc.querySelectorAll('img').length === 0 && legacyDoc.querySelectorAll('.ly-img-missing').length === 6,
  `img=${legacyDoc.querySelectorAll('img').length} missing=${legacyDoc.querySelectorAll('.ly-img-missing').length}`,
);

const tokens = designToTokenOverrides({
  primary: '#6a3d9a',
  background: '#fbfaff',
  text: '#221a2e',
  fontFamily: 'Songti SC, serif',
  radius: 6,
});
check(
  '适配器：课程自定义模板调参 → token 覆盖（颜色/字体/圆角都不丢）',
  tokens['--accent'] === '#6a3d9a' && tokens['--bg'] === '#fbfaff' && tokens['--text-1'] === '#221a2e' &&
    tokens['--font-sans'] === 'Songti SC, serif' && tokens['--radius'] === '6px',
);
check('适配器：token 覆盖传进主题 CSS 后生效', themeCss(DECK_THEMES[0], tokens).includes('--accent: #6a3d9a;'));

// ---------------- 8. 兜底：intent 与块不匹配时绝不丢内容 ----------------
// 生成侧偶尔会给出「intent 与块不匹配」的组合（实测：contrast 页多带一张 table、
// pillars 页用 relation 表达）。渲染层必须照常渲染，不许静默丢弃。
const mixed = [
  {
    intent: 'contrast',
    title: '主渲染 + 兜底',
    blocks: [
      { kind: 'compare', left: { title: 'A', tone: 'accent', items: ['a1'] }, right: { title: 'B', tone: 'accent', items: ['b1'] } },
      { kind: 'table', head: ['列'], rows: [['值']] },
      { kind: 'note', text: '这是一句补充说明' },
    ],
  },
  {
    intent: 'pillars',
    title: '意图与块不匹配',
    blocks: [{ kind: 'relation', nodes: [{ label: '中心', center: true }, { label: '卫星' }] }],
  },
];
const mixedHtml = await buildSemanticDeckHtml({ pages: mixed, meta: META, themeId: 'builtin-platform-blue' });
const mixedDoc = new JSDOM(mixedHtml).window.document;
check('兜底：contrast 页多带的 table 照常渲染（不丢内容）', mixedDoc.querySelectorAll('.ly-table').length === 1);
check('兜底：多带的 note 照常渲染', mixedDoc.querySelectorAll('.ly-note').length === 1);
check(
  '兜底：pillars 意图配 relation 块时仍画关系图',
  mixedDoc.querySelectorAll('.ly-rel-center').length === 1 && mixedDoc.querySelectorAll('.ly-rel svg path').length === 1,
);

// ---------------- 9. v2 语义 deck 直接渲染（服务端默认产出）----------------
// 服务端（generator 的语义模式）产出的是 {intent, blocks} 结构；前端按结构自辨识直接渲染，
// 不再经过 v1 适配器 —— 这是 2026-10-10 起的默认路径。
const v2Pages = [
  { intent: 'cover', kicker: '某课程', title: '语义 deck', subtitle: '直接渲染', blocks: [{ kind: 'evidence', items: ['v2'] }] },
  { intent: 'relation', title: '关系', blocks: [{ kind: 'relation', nodes: [{ label: '中心', center: true }, { label: 'A' }, { label: 'B' }] }] },
  { intent: 'flow', title: '管线', blocks: [{ kind: 'flow', nodes: [{ title: 'A' }, { title: 'B', highlight: true }, { title: 'C' }] }] },
  {
    intent: 'timeline',
    title: '时间线',
    blocks: [{ kind: 'timeline', points: [{ at: 'Q1', title: '一' }, { at: 'Q2', title: '二', highlight: true }, { at: 'Q3', title: '三' }] }],
  },
  {
    intent: 'arch',
    title: '分层',
    blocks: [{ kind: 'arch', levels: [{ name: 'L1', cells: [{ title: 'a' }, { title: 'b' }] }, { name: 'L2', cells: [{ title: 'c' }] }] }],
  },
  {
    intent: 'summary',
    kicker: '小结',
    title: '三句话',
    blocks: [{ kind: 'evidence', items: ['一', '二', '三'] }],
    notes: '这一页收束全篇：先回顾三个要点，再点出它们之间的关系，最后过渡到下一节要做的事。[此处稍停，等他们记完再翻页]',
  },
];
check('v2 deck 被识别为语义 deck（按结构，不靠版本号）', isSemanticDeck(v2Pages) === true);
check('v1 deck 不会被误判为语义 deck', isSemanticDeck(LEGACY_SLIDES) === false);
const v2Html = await buildSemanticDeckHtml({ pages: v2Pages, meta: META, themeId: 'builtin-platform-blue' });
const v2Doc = new JSDOM(v2Html).window.document;

// ---------------- 6.2 预览就地编辑（2026-10-13）----------------
check(
  '纯文本容器带 data-edit 标记（标题/lede/主张/要点/注释）',
  html.includes('data-edit="title"') && html.includes('data-edit="blocks.') &&
    html.includes('data-edit="lede"'),
);
check(
  '可编辑开关只影响编辑视图（.deck.is-editable 由宿主声明，默认不带）',
  html.includes('is-editable') === false || !/class="deck is-editable"/.test(html),
);
const editableHtml = await buildSemanticDeckHtml({ pages: PAGES, meta: META, themeId: 'builtin-platform-blue', editable: true });
check(
  '声明 editable 时 .deck 带上 .is-editable',
  /class="deck is-editable"/.test(editableHtml),
);
check(
  '运行时实现就地编辑：双击进入 + 回车/Esc 提交或取消 + 编辑期间屏蔽翻页',
  html.includes("addEventListener('dblclick'") &&
    html.includes('isContentEditable') &&
    html.includes("event.key === 'Enter'") &&
    html.includes('editingEl') &&
    html.includes('if (editingEl) return;'),
);
check(
  '就地编辑零视觉侵入：只允许 cursor / outline（禁 border-radius、background、transparent 描边）',
  (() => {
    const start = layoutsCss.indexOf('.deck.is-editable');
    if (start < 0) return false;
    const block = layoutsCss.slice(start);
    return !/border-radius/.test(block) && !/background/.test(block) && !/transparent/.test(block);
  })(),
);
check(
  '就地编辑期间的主键盘监听会主动让路（避免打字被当成翻页/总览）',
  (html.match(/if \(editingEl\) return;/g) || []).length >= 2,
);

// ---------------- 6.3 讲稿页（导出备注页，2026-10-13）----------------
check(
  '导出「附讲稿」锚定 id="deck" 替换（用 class="deck 会改到 <style> 里的同名字样而静默失效）',
  chapterSlidesSrc.includes('/<div class="deck[^"]*" id="deck">/') &&
    chapterSlidesSrc.includes('with-notes-pages'),
);
check(
  '导出前剥掉编辑态痕迹（is-editable 不该进导出文档）',
  chapterSlidesSrc.includes("replace(' is-editable', '')"),
);

check(
  '每页都生成了一张讲稿页（导出的备注页）',
  v2Doc.querySelectorAll('.notes-page').length === v2Pages.length,
);
check(
  '讲稿页默认隐藏且不参与放映翻页（运行时按 .slide:not(.notes-page) 选页）',
  html.includes('.notes-page') && html.includes(".slide:not(.notes-page)") && html.includes('.deck.with-notes-pages'),
);
check(
  '讲稿内容进了讲稿页（不是只有空占位）',
  v2Doc.querySelectorAll('.notes-page .notes-page-body p').length > 0 &&
    [...v2Doc.querySelectorAll('.notes-page')].some((section) =>
      section.textContent.includes('这一页收束全篇'),
    ),
);
check(
  '没有讲稿的页给出「本页没有讲稿」占位（而不是空白页）',
  v2Doc.querySelectorAll('.notes-page .notes-empty').length === v2Pages.length - 1,
);
// 讲稿分两层（prompt v12，2026-10-17）：可照读的口播 + `[ …… ]` 内联的**备课提示**。
// 提示渲染成 `.notes-cue`（斜体压淡），讲者一眼知道哪句出声、哪句只是提示；
// 讲稿浮层（按 S 呼出）读的就是 `.notes` 的 innerHTML，所以这两条同时管住浮层与 PDF 备注页。
check(
  '讲稿里的 [ …… ] 备课提示渲染成 .notes-cue（浮层里一眼分得清）',
  v2Doc.querySelectorAll('.slide:not(.notes-page) .notes-cue').length === 1 &&
    v2Doc.querySelector('.slide:not(.notes-page) .notes-cue').textContent ===
      '[此处稍停，等他们记完再翻页]',
);
check(
  '讲稿页（导出备注页）同样弱化提示，口播正文原样保留',
  v2Doc.querySelectorAll('.notes-page .notes-cue').length === 1 &&
    (v2Doc.querySelector('.notes-page .notes-cue')?.closest('p')?.textContent ?? '').startsWith(
      '这一页收束全篇：',
    ),
);

check(
  'v2 deck 直接渲染：页数一致',
  v2Doc.querySelectorAll('.slide:not(.notes-page)').length === v2Pages.length,
);
check(
  'v2 deck 直接渲染：图示版式全部落地（关系图/管线/时间线/分层）',
  v2Doc.querySelectorAll('.ly-rel-center').length === 1 &&
    v2Doc.querySelectorAll('.ly-flow-node').length === 3 &&
    v2Doc.querySelectorAll('.ly-tl-item').length === 3 &&
    v2Doc.querySelectorAll('.ly-tier').length === 2,
);

// ---------------- 10. 数据图表 / 公式 / 页级背景（P4）----------------
const media = [
  {
    intent: 'data',
    kicker: '采样',
    title: '系数越大，分布越尖',
    blocks: [
      {
        kind: 'chart',
        chart: 'bar',
        labels: ['0.5', '1.0', '2.0'],
        series: [{ name: 'top-1 占比', values: [0.745, 0.54, 0.36] }],
        unit: '',
        highlight: 2,
      },
      { kind: 'note', text: '补充说明只应出现一次' },
    ],
  },
  {
    intent: 'data',
    title: '环形图',
    blocks: [{ kind: 'chart', chart: 'donut', labels: ['检索', '摘要', '窗口'], series: [{ values: [0.8, 0.7, 0.3] }] }],
  },
  {
    intent: 'formula',
    kicker: '机制',
    title: '一行写完',
    blocks: [
      { kind: 'formula', tex: '\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d}}+M\\right)V', caption: 'M 是掩码' },
    ],
  },
  {
    intent: 'section',
    number: '01',
    title: '带背景图的页',
    blocks: [{ kind: 'evidence', items: ['背景图铺满', '压暗遮罩保证可读'] }],
    background: { fileId: '11111111-1111-1111-1111-111111111111', dim: 0.6 },
  },
  {
    // v13：表格 + 图同页 —— 图排在**表格下方**（教师要求"表 + 图时图在列表下面"）
    intent: 'table',
    title: '常见计算模型的线性部分与激活函数',
    blocks: [
      {
        kind: 'table',
        head: ['模型', '线性部分', '激活'],
        rows: [
          ['线性回归', '是', '无'],
          ['逻辑回归', '是', 'Sigmoid'],
        ],
      },
      { kind: 'image', fileId: '22222222-2222-2222-2222-222222222222', caption: '激活函数一' },
      { kind: 'image', fileId: '22222222-2222-2222-2222-222222222222', caption: '激活函数二' },
    ],
  },
  {
    // v13 回归：代码页 + 单图仍**左右并排**（垂直堆叠会顶掉页脚，2026-10-12 实测）
    intent: 'example',
    title: '代码 + 单图仍并排',
    blocks: [
      { kind: 'code', lang: 'python', content: 'print(1)' },
      { kind: 'image', fileId: '22222222-2222-2222-2222-222222222222', caption: '单图' },
    ],
  },
  {
    // v13：封面只有标题 + 一句话（一句话写在 lede，不是 subtitle —— 生成侧就是这么写的）
    intent: 'cover',
    kicker: '第 2 章',
    title: '机器学习基本理论和实践',
    lede: '机器学习不把规则写死，而是让数据自己说话。',
    blocks: [],
  },
];
const mediaHtml = await buildSemanticDeckHtml({
  pages: media,
  meta: META,
  themeId: 'builtin-platform-blue',
  resolveImage: (fileId) =>
    fileId === '11111111-1111-1111-1111-111111111111' || fileId === '22222222-2222-2222-2222-222222222222'
      ? 'data:image/png;base64,AAAA'
      : undefined,
});
const mediaDoc = new JSDOM(mediaHtml).window.document;

const barPage = mediaDoc.querySelectorAll('.slide:not(.notes-page)')[0];
check('图表：柱状图 SVG 渲染（柱数 = 数据点数）', barPage.querySelectorAll('.ly-chart-bar').length === 3);
check('图表：高亮数据点被标记', barPage.querySelectorAll('.ly-chart-bar.hl').length === 1);
check(
  '图表：轴刻度取「好看的数字」（0/0.2/0.4…，不是 0.201）',
  [...barPage.querySelectorAll('.ly-chart-axis')].some((node) => node.textContent.trim() === '0.8'),
);
check('图表：数值标签显示真实数据', [...barPage.querySelectorAll('.ly-chart-value')].some((n) => n.textContent.includes('0.745')));
check('图表页的补充说明只渲染一次（兜底不重复）', barPage.querySelectorAll('.ly-note').length === 1);
check('图表：环形图带图例与占比', (() => {
  const donut = mediaDoc.querySelectorAll('.slide:not(.notes-page)')[1];
  return donut.querySelectorAll('.ly-chart-arc').length === 3 && donut.querySelectorAll('.ly-donut-item').length === 3;
})());

const formulaPage = mediaDoc.querySelectorAll('.slide:not(.notes-page)')[2];
check('公式：KaTeX 产出 MathML（不依赖内联字体）', formulaPage.querySelectorAll('.ly-formula math').length === 1);
// KaTeX 的 MathML 输出把 LaTeX 源码放在 <annotation>（供复制/无障碍，不参与渲染）
check(
  '公式：LaTeX 源码只在 MathML annotation 里（不参与渲染）',
  formulaPage.querySelectorAll('.ly-formula annotation').length >= 1 &&
    formulaPage.querySelector('.ly-formula annotation')?.textContent.includes('Attention') === true,
);

const bgPage = mediaDoc.querySelectorAll('.slide:not(.notes-page)')[3];
check('页级背景：section 带 has-bg 与背景图', bgPage.classList.contains('has-bg') && /background-image/.test(bgPage.getAttribute('style') ?? ''));
check('页级背景：压暗遮罩按 dim 生成', !!bgPage.querySelector('.ly-bg-scrim'));

// ---- v13：表 + 图同页 → 图排在表格**下方**（不再左右并排）；代码页 + 单图仍并排 ----
const tableFigPage = mediaDoc.querySelectorAll('.slide:not(.notes-page)')[4];
check(
  '表格页带图：图排在表格下方（.ly-figs-below，是叠排不是两栏）',
  tableFigPage.querySelectorAll('.ly-figs-below .img-frame').length === 2 &&
    tableFigPage.querySelectorAll('.ly-split').length === 0,
  `figs=${tableFigPage.querySelectorAll('.ly-figs-below .img-frame').length}`,
);
check(
  '表格页带图：图片在表格之后（DOM 顺序 = 视觉顺序）',
  (() => {
    const table = tableFigPage.querySelector('.ly-table');
    const figs = tableFigPage.querySelector('.ly-figs-below');
    if (!table || !figs) return false;
    return (table.compareDocumentPosition(figs) & 4) !== 0; // 4 = DOCUMENT_POSITION_FOLLOWING
  })(),
);
const codeFigPage = mediaDoc.querySelectorAll('.slide:not(.notes-page)')[5];
check(
  '代码页 + 单图仍是左右两栏（垂直堆叠会顶掉页脚，v13 不动这条）',
  codeFigPage.querySelectorAll('.ly-split').length === 1 &&
    codeFigPage.querySelectorAll('.ly-figs-below').length === 0,
);
const coverPage = mediaDoc.querySelectorAll('.slide:not(.notes-page)')[6];
check(
  '封面：一句话读 lede（v2 生成侧写在 lede，此前只认 subtitle → 一直没上屏）',
  coverPage.querySelector('.ly-cover-sub')?.textContent === '机器学习不把规则写死，而是让数据自己说话。',
);
check(
  '封面：没有要点胶囊（blocks 为空就是干净封面）',
  coverPage.querySelectorAll('.ly-pills .pill').length === 0,
);

// ---------------- 11. 模板调参映射 + 打印样式（P4）----------------
const tuned = designToTokenOverrides({
  fontScale: 'large',
  density: 'loose',
  cardStyle: 'outline',
  primary: '#1677ff',
});
check(
  '调参映射：字号 / 疏密 / 卡片风格都落到版式令牌',
  tuned['--ly-scale'] === '1.08' &&
    tuned['--ly-gap'] === '1.22' &&
    tuned['--ly-card-bg'] === 'transparent' &&
    String(tuned['--ly-card-border']).includes('1.5px'),
);
const tunedCss = themeCss(DECK_THEMES[0], tuned);
check('调参令牌进入文档 CSS', tunedCss.includes('--ly-scale: 1.08;') && tunedCss.includes('--ly-gap: 1.22;'));
check(
  '版式 CSS 一律读令牌（字号/间距/卡片都能被调参覆盖）',
  /font-size: calc\(54px \* var\(--ly-scale\) \* var\(--fs-boost, 1\)\)/.test(layoutsCss) &&
    /gap: calc\(18px \* var\(--ly-gap\)\)/.test(layoutsCss) &&
    /background: var\(--ly-card-bg\)/.test(layoutsCss),
);
check('打印样式：页面尺寸钉为 1920×1080', /@page\s*\{[^}]*size:\s*1920px 1080px/.test(layoutsCss));
check(
  '打印样式：逐页分页由 vendored base.css 提供（一页一画布）',
  /page-break-after:always/.test(html) && /@media print/.test(html),
);

// ---------------- 汇总 ----------------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(([label]) => console.log(`  · ${label}`));
  process.exit(1);
}
