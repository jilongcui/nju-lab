import type { SlideDeckConfig, SlideJson } from '../types';
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
.reveal pre { width: 100%; }
.reveal pre code { max-height: 60vh; }
`;

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

  switch (slide.layout) {
    case 'cover':
      return `<h1>${renderInlineSafe(slide.title ?? '')}</h1>${subtitle}
        ${slide.bullets?.length ? renderBullets(slide.bullets) : ''}`;
    case 'section':
      return `<h2>${renderInlineSafe(slide.title ?? '')}</h2>${subtitle}
        ${slide.bullets?.length ? renderBullets(slide.bullets) : ''}`;
    case 'end':
      return `<h2>${renderInlineSafe(slide.title ?? '')}</h2>
        ${slide.bullets?.length ? renderBullets(slide.bullets) : ''}`;
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
    case 'image': {
      if (!slide.image) return title;
      const src = resolveFileUrl(slide.image.url, input.imageDataUrls);
      if (!src) {
        // 取不到平台文件（例如已被删除）：显示占位说明，绝不外链
        return `${title}<p class="deck-note">（图片不可用：${escapeHtml(slide.image.caption ?? '未找到文件')}）</p>`;
      }
      return `${title}<img class="deck-image" src="${escapeAttribute(src)}" alt="${escapeAttribute(
        slide.image.caption ?? '',
      )}" />
      ${slide.image.caption ? `<p class="deck-caption">${escapeHtml(slide.image.caption)}</p>` : ''}`;
    }
    default:
      return title;
  }
}

function renderBullets(bullets: string[]): string {
  return `<ul>${bullets.map((item) => `<li>${renderInlineSafe(item)}</li>`).join('')}</ul>`;
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
  if (slide.attrs?.className) {
    attrs.push(`class="${escapeAttribute(slide.attrs.className)}"`);
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
