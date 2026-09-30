import type { SlideDeckConfig, SlideImage, SlideJson } from '../types';
import {
  escapeAttribute,
  escapeHtml,
  renderInlineSafe,
  renderMarkdownSafe,
} from './markdown';
import { loadRevealAssets, loadThemeCss } from './revealAssets';

/**
 * 把 deck（SlideJson[]）渲染成**一份自包含的 HTML 文档**，交给 `<iframe srcdoc>`。
 *
 * 三条硬约束（设计文档 §4/§11）：
 *   1) 文档跑在 `sandbox="allow-scripts"`（**不给 allow-same-origin**）的 iframe 里 ——
 *      reveal 的 reset.css 不会污染 antd，且文档处于 opaque origin，读不到平台 token；
 *   2) 所有用户内容都走 markdown.ts 的**白名单清理**（禁原始 HTML / on* / javascript:）；
 *   3) 父 ↔ 子只通过 `postMessage` 通信（按键转发与页码回传），不共享任何 DOM。
 *
 * 注意：文档本身含内联 `<script>`（reveal 源码 + 桥接脚本），这是设计的一部分；
 * 断言"内容里没有注入的脚本"时要区分二者（测试用 `alert(1)` 这类标记判断）。
 */

const DEFAULT_CONFIG: Required<SlideDeckConfig> = {
  transition: 'slide',
  slideNumber: 'c/t',
  progress: true,
  hash: false,
  controls: true,
  center: true,
  loop: false,
};

/** 基础版式修正（与主题/模板 CSS 叠加；不含任何用户可控值） */
const BASE_OVERRIDES = `
.reveal .deck-two-col { display: flex; gap: 1.4em; text-align: left; }
.reveal .deck-two-col > div { flex: 1 1 0; min-width: 0; }
.reveal .deck-footer { pointer-events: none; }
.reveal section img.deck-image { max-height: 55vh; width: auto; }
.reveal .deck-caption { font-size: 0.5em; opacity: 0.7; margin-top: 0.4em; }

/* 全幅大图页：图是主角，尽量撑满但不裁切（contain 保信息完整，教学图裁不得） */
.reveal section img.deck-image-full { max-height: 72vh; max-width: 100%; width: auto; }

/* 图文并排页（image-left / image-right）：图约 45%，文约 55%，垂直居中 */
.reveal .deck-split { display: flex; gap: 1.2em; align-items: center; text-align: left; }
.reveal .deck-split.deck-split-right { flex-direction: row-reverse; }
.reveal .deck-split-media { flex: 0 1 45%; min-width: 0; text-align: center; }
.reveal .deck-split-media img.deck-split-image { max-height: 58vh; max-width: 100%; width: auto; }
.reveal .deck-split-body { flex: 1 1 55%; min-width: 0; }

/* 多图网格页（image-grid）：2 张两列、3 张三列、4 张 2×2 */
.reveal .deck-grid { display: grid; gap: 0.7em; align-items: center; justify-items: center; }
.reveal .deck-grid.deck-grid-2 { grid-template-columns: repeat(2, 1fr); }
.reveal .deck-grid.deck-grid-3 { grid-template-columns: repeat(3, 1fr); }
.reveal .deck-grid.deck-grid-4 { grid-template-columns: repeat(2, 1fr); }
.reveal .deck-grid-cell { min-width: 0; }
.reveal .deck-grid-cell img.deck-grid-image { max-width: 100%; width: auto; }
.reveal .deck-grid.deck-grid-2 img.deck-grid-image { max-height: 48vh; }
.reveal .deck-grid.deck-grid-3 img.deck-grid-image,
.reveal .deck-grid.deck-grid-4 img.deck-grid-image { max-height: 28vh; }
.reveal .deck-grid-cell .deck-caption { margin-top: 0.2em; }
.reveal pre { width: 100%; }
.reveal pre code { max-height: 60vh; }

/* 内容量自适应：过重页自动缩字号（防底部裁切的硬保证；生成侧另有密度约束） */
.reveal .slides section.deck-fit-2 { font-size: 0.85em; }
.reveal .slides section.deck-fit-3 { font-size: 0.72em; }

/* 眉题（封面/分节/目录页上方的小字） */
.reveal .deck-kicker { font-size: 0.42em; letter-spacing: 0.14em; color: var(--deck-accent, #888); font-weight: 600; margin: 0 0 0.9em; }

/* 封面 */
.reveal .deck-cover-rule { width: 2.6em; height: 0.14em; background: var(--deck-accent, #888); margin: 0.9em auto 0; border-radius: 2px; }

/* 目录页（编号大事记风格） */
.reveal .deck-agenda { counter-reset: deck-agenda; list-style: none; margin-left: 0 !important; }
.reveal .deck-agenda li { counter-increment: deck-agenda; position: relative; padding-left: 2.2em; text-align: left; }
.reveal .deck-agenda li::before { content: counter(deck-agenda, decimal-leading-zero); position: absolute; left: 0; top: 0.08em; color: var(--deck-accent, #888); font-weight: 700; font-size: 0.9em; }

/* 步骤页（序号圆点 + 连接线） */
.reveal .deck-steps { counter-reset: deck-steps; list-style: none; margin-left: 0 !important; }
.reveal .deck-steps li { counter-increment: deck-steps; position: relative; padding-left: 2.4em; text-align: left; }
.reveal .deck-steps li::before { content: counter(deck-steps); position: absolute; left: 0; top: 0.05em; width: 1.5em; height: 1.5em; border-radius: 50%; background: var(--deck-primary, #666); color: var(--deck-background, #fff); font-size: 0.62em; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.reveal .deck-steps li:not(:last-child)::after { content: ''; position: absolute; left: 0.73em; top: 1.7em; bottom: -0.5em; width: 2px; background: color-mix(in srgb, var(--deck-primary, #666) 30%, transparent); }

/* 大数字页 */
.reveal .deck-stats { display: flex; gap: 1em; justify-content: center; align-items: stretch; text-align: center; }
.reveal .deck-stat { flex: 1 1 0; min-width: 0; padding: 0.8em 0.4em; }
.reveal .deck-stat-value { font-size: 2.4em; font-weight: 800; color: var(--deck-primary, inherit); line-height: 1.05; }
.reveal .deck-stat-label { font-size: 0.5em; margin-top: 0.5em; opacity: 0.85; }
.reveal .deck-stat-detail { font-size: 0.42em; margin-top: 0.35em; opacity: 0.6; }

/* 对比页（双栏带列标题） */
.reveal .deck-compare { display: flex; gap: 1.2em; text-align: left; }
.reveal .deck-compare-col { flex: 1 1 0; min-width: 0; }
.reveal .deck-compare-head { font-size: 0.62em; font-weight: 700; color: var(--deck-accent, inherit); border-bottom: 2px solid var(--deck-accent, #888); padding-bottom: 0.3em; margin-bottom: 0.7em; }
.reveal .deck-compare-col ul { margin-left: 1.1em; }

/* 要点 marker 用强调色 */
.reveal .deck-bullets li::marker { color: var(--deck-accent, inherit); }
`;

/**
 * 内容量估算 → 自适应缩档（`deck-fit-2/3`）。
 * 阈值按 reveal 1024×700 画布标定：标题约两行高，正文可用约 9–10 行；
 * 超重的页宁可整体缩小也不能让底部被裁（2026-09-29 实测过"要点被切一半"）。
 */
function slideWeight(slide: SlideJson): number {
  let weight = 0;
  if (slide.title) weight += slide.title.length * 2;
  if (slide.subtitle) weight += slide.subtitle.length;
  for (const bullet of slide.bullets ?? []) weight += bullet.length + 14;
  for (const stat of slide.stats ?? []) {
    weight += stat.label.length + stat.value.length * 2 + (stat.detail?.length ?? 0) * 0.5 + 24;
  }
  if (slide.compare) {
    weight += 40;
    for (const item of [...slide.compare.left, ...slide.compare.right]) {
      weight += item.length + 10;
    }
  }
  if (slide.left) weight += slide.left.length * 0.6;
  if (slide.right) weight += slide.right.length * 0.6;
  if (slide.code) weight += slide.code.content.split('\n').length * 24;
  if (slide.quote) weight += slide.quote.text.length * 1.1;
  if (slide.image) weight += 200;
  // 多图网格按张数加权（4 张时比单图页更重，防网格把页撑爆）
  if (slide.images?.length) weight += 60 + slide.images.length * 110;
  return weight;
}

function fitClassOf(weight: number): string {
  if (weight > 760) return 'deck-fit-3';
  if (weight > 480) return 'deck-fit-2';
  return '';
}

export interface DeckRenderInput {
  slides: SlideJson[];
  template: { baseTheme: string; css: string };
  config: SlideDeckConfig;
  footerText?: string | null;
  /** 页脚 logo（已由调用方取好内容转成 data URL） */
  logoDataUrl?: string | null;
  /** `file:<fileId>` → data URL：调用方预取，取不到就跳过（不外链、不报错） */
  imageDataUrls?: Record<string, string>;
}

function resolveFileUrl(
  rawUrl: string,
  imageDataUrls?: Record<string, string>,
): string | null {
  if (!rawUrl.startsWith('file:')) return null;
  const fileId = rawUrl.slice(5);
  return imageDataUrls?.[rawUrl] ?? imageDataUrls?.[fileId] ?? null;
}

function renderFooter(input: DeckRenderInput): string {
  const hasText = !!input.footerText;
  const hasLogo = !!input.logoDataUrl;
  if (!hasText && !hasLogo) return '';
  const left = hasText ? `<span>${escapeHtml(input.footerText)}</span>` : '<span></span>';
  const right = hasLogo
    ? `<img src="${escapeAttribute(input.logoDataUrl as string)}" alt="" />`
    : '<span></span>';
  return `<div class="deck-footer">${left}${right}</div>`;
}

function renderLayoutBody(slide: SlideJson, input: DeckRenderInput): string {
  const title = slide.title
    ? `<h2 class="deck-title">${renderInlineSafe(slide.title)}</h2>`
    : '';
  const subtitle = slide.subtitle
    ? `<h3 class="deck-accent">${renderInlineSafe(slide.subtitle)}</h3>`
    : '';
  // 眉题只出现在"仪式型"页面（封面/分节/目录/结尾）；内容页不放，避免挤占正文高度
  const kicker =
    slide.kicker && ['cover', 'section', 'agenda', 'end'].includes(slide.layout)
      ? `<p class="deck-kicker">${escapeHtml(slide.kicker)}</p>`
      : '';

  switch (slide.layout) {
    case 'cover':
      return `${kicker}<h1>${renderInlineSafe(slide.title ?? '')}</h1>
        <div class="deck-cover-rule"></div>${subtitle}
        ${slide.bullets?.length ? renderBullets(slide.bullets) : ''}`;
    case 'section':
      return `${kicker}<h2>${renderInlineSafe(slide.title ?? '')}</h2>${subtitle}
        ${slide.bullets?.length ? renderBullets(slide.bullets) : ''}`;
    case 'end':
      return `${kicker}<h2>${renderInlineSafe(slide.title ?? '')}</h2>
        ${slide.bullets?.length ? renderBullets(slide.bullets) : ''}`;
    case 'agenda':
      return `${kicker}${title}${renderOrdered(slide.bullets, 'deck-agenda')}`;
    case 'steps':
      return `${title}${renderOrdered(slide.bullets, 'deck-steps')}`;
    case 'stat': {
      const stats = (slide.stats ?? [])
        .map(
          (stat) => `<div class="deck-stat">
            <div class="deck-stat-value">${escapeHtml(stat.value)}</div>
            <div class="deck-stat-label">${renderInlineSafe(stat.label)}</div>
            ${stat.detail ? `<div class="deck-stat-detail">${renderInlineSafe(stat.detail)}</div>` : ''}
          </div>`,
        )
        .join('');
      return `${title}<div class="deck-stats">${stats}</div>`;
    }
    case 'compare': {
      const compare = slide.compare;
      if (!compare) return title;
      const column = (head: string | undefined, items: string[]) =>
        `<div class="deck-compare-col">
          ${head ? `<div class="deck-compare-head">${renderInlineSafe(head)}</div>` : ''}
          ${renderBullets(items)}
        </div>`;
      return `${title}<div class="deck-compare">
        ${column(compare.leftTitle, compare.left)}${column(compare.rightTitle, compare.right)}
      </div>`;
    }
    case 'bullets':
      return `${title}${slide.bullets?.length ? renderBullets(slide.bullets) : ''}`;
    case 'two-col':
      return `${title}
        <div class="deck-two-col">
          <div>${renderMarkdownSafe(slide.left)}</div>
          <div>${renderMarkdownSafe(slide.right)}</div>
        </div>`;
    case 'code':
      return `${title}<pre><code class="language-${escapeAttribute(
        slide.code?.lang || 'text',
      )}">${escapeHtml(slide.code?.content ?? '')}</code></pre>`;
    case 'quote':
      return `${title}<blockquote>${renderMarkdownSafe(slide.quote?.text)}</blockquote>
        ${slide.quote?.cite ? `<p class="deck-note">— ${escapeHtml(slide.quote.cite)}</p>` : ''}`;
    case 'image':
    case 'image-full': {
      if (!slide.image) return title;
      const imgClass = slide.layout === 'image-full' ? 'deck-image-full' : 'deck-image';
      return `${title}${renderImageFigure(slide.image, input, imgClass)}`;
    }
    case 'image-left':
    case 'image-right': {
      if (!slide.image) return title;
      const media = `<div class="deck-split-media">${renderImageFigure(
        slide.image,
        input,
        'deck-split-image',
      )}</div>`;
      const body = `<div class="deck-split-body">${
        slide.bullets?.length ? renderBullets(slide.bullets) : ''
      }</div>`;
      const cls = slide.layout === 'image-right' ? 'deck-split deck-split-right' : 'deck-split';
      return `${title}<div class="${cls}">${media}${body}</div>`;
    }
    case 'image-grid': {
      const images = slide.images ?? [];
      if (!images.length) return title;
      const cells = images
        .map(
          (img) =>
            `<div class="deck-grid-cell">${renderImageFigure(img, input, 'deck-grid-image')}</div>`,
        )
        .join('');
      return `${title}<div class="deck-grid deck-grid-${images.length}">${cells}</div>`;
    }
    default:
      return title;
  }
}

function renderBullets(bullets: string[]): string {
  return `<ul class="deck-bullets">${bullets
    .map((item) => `<li>${renderInlineSafe(item)}</li>`)
    .join('')}</ul>`;
}

/**
 * 渲染一张平台图片：统一走 imageDataUrls 预取结果；
 * 取不到（例如文件已删除）时显示占位说明，绝不外链（iframe 是 opaque origin，外链也带不了鉴权）。
 */
function renderImageFigure(
  image: SlideImage,
  input: DeckRenderInput,
  imgClass: string,
): string {
  const src = resolveFileUrl(image.url, input.imageDataUrls);
  if (!src) {
    return `<p class="deck-note">（图片不可用：${escapeHtml(image.caption ?? '未找到文件')}）</p>`;
  }
  return `<img class="${imgClass}" src="${escapeAttribute(src)}" alt="${escapeAttribute(
    image.caption ?? '',
  )}" />
  ${image.caption ? `<p class="deck-caption">${escapeHtml(image.caption)}</p>` : ''}`;
}

/** 有序列表（agenda 目录 / steps 步骤）：CSS 负责序号样式，HTML 只要 ol + class */
function renderOrdered(items: string[] | undefined, className: string): string {
  if (!items?.length) return '';
  return `<ol class="${className}">${items
    .map((item) => `<li>${renderInlineSafe(item)}</li>`)
    .join('')}</ol>`;
}

function renderSection(slide: SlideJson, input: DeckRenderInput): string {
  const attrs: string[] = [];

  const background = slide.attrs?.background;
  if (background) {
    if (background.startsWith('file:')) {
      const dataUrl = resolveFileUrl(background, input.imageDataUrls);
      if (dataUrl) attrs.push(`data-background-image="${escapeAttribute(dataUrl)}"`);
    } else {
      attrs.push(`data-background-color="${escapeAttribute(background)}"`);
    }
  }
  if (slide.attrs?.transition) {
    attrs.push(`data-transition="${escapeAttribute(slide.attrs.transition)}"`);
  }
  // 内容量自适应缩档（deck-fit-2/3）+ 教师的自定义 class 并存
  const classNames = [slide.attrs?.className, fitClassOf(slideWeight(slide))]
    .filter(Boolean)
    .join(' ');
  if (classNames) {
    attrs.push(`class="${escapeAttribute(classNames)}"`);
  }

  const notes = slide.notes
    ? `<aside class="notes">${escapeHtml(slide.notes)}</aside>`
    : '';

  return `<section ${attrs.join(' ')}>${renderLayoutBody(slide, input)}${renderFooter(
    input,
  )}${notes}</section>`;
}

/** 父窗口 → iframe 的按键/跳转桥；iframe → 父窗口回传当前页 */
function bridgeScript(config: Required<SlideDeckConfig>): string {
  const options = JSON.stringify({
    transition: config.transition,
    slideNumber: config.slideNumber,
    progress: config.progress,
    hash: config.hash,
    controls: config.controls,
    center: config.center,
    loop: config.loop,
    width: 1024,
    height: 700,
    margin: 0.06,
  });
  return `(function () {
  if (typeof Reveal === 'undefined') {
    document.body.innerHTML = '<p style="font:16px sans-serif;padding:24px">幻灯片组件加载失败，请刷新重试。</p>';
    return;
  }
  Reveal.initialize(${options});
  function post(payload) {
    try { parent.postMessage(Object.assign({ __deck: true }, payload), '*'); } catch (e) {}
  }
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.__deckAction !== true) return;
    if (data.action === 'next') Reveal.next();
    else if (data.action === 'prev') Reveal.prev();
    else if (data.action === 'goto' && typeof data.index === 'number') Reveal.slide(data.index);
    else if (data.action === 'overview') Reveal.toggleOverview();
  });

  // Esc 只有「退出放映」一个语义：阻止 reveal 把它当总览开关（那正是"按 Esc 退不出去、
  // 反而变总览"的原因），并把意图回传父窗口 —— 因为焦点在 iframe 内时父窗口收不到 keydown。
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    event.preventDefault();
    event.stopPropagation();
    post({ type: 'exit-present' });
  }, true);

  // 点击左右区域翻页（像 PPT 的操作习惯）。
  // 避开的三种情况：交互元素上、正在选中文本、以及 reveal 自己的控件区（.controls）。
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented) return;
    var target = event.target;
    if (target && target.closest && target.closest('a, button, input, textarea, select, video, audio, .controls')) return;
    var selection = window.getSelection && window.getSelection();
    if (selection && !selection.isCollapsed) return;
    var ratio = event.clientX / window.innerWidth;
    if (ratio >= 0.75) Reveal.next();
    else if (ratio <= 0.25) Reveal.prev();
  });
  Reveal.on('ready', function (ev) { post({ type: 'ready', index: ev.indexh || 0, total: document.querySelectorAll('.slides > section').length }); });
  Reveal.on('slidechanged', function (ev) { post({ type: 'slidechanged', index: ev.indexh || 0 }); });
})();`;
}

/** 组装完整文档（供 `iframe srcdoc` 使用） */
export async function buildDeckHtml(input: DeckRenderInput): Promise<string> {
  const [assets, themeCss] = await Promise.all([
    loadRevealAssets(),
    loadThemeCss(input.template.baseTheme),
  ]);

  const config: Required<SlideDeckConfig> = { ...DEFAULT_CONFIG, ...input.config };
  const sections = input.slides.map((slide) => renderSection(slide, input)).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.slides[0]?.title ?? '幻灯片')}</title>
<style>${assets.css}</style>
<style>${themeCss}</style>
<style>${input.template.css}</style>
<style>${BASE_OVERRIDES}</style>
</head>
<body>
<div class="reveal">
<div class="slides">
${sections}
</div>
</div>
<script>${assets.script}</script>
<script>${bridgeScript(config)}</script>
</body>
</html>
`;
}
