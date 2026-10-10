/**
 * 舞台组装：把语义页 + 主题编译成**一份自包含 HTML 文档**（供 `iframe srcdoc`）。
 *
 * 与旧渲染器（reveal.js）的关系：
 *   · 契约**完全一致** —— iframe → 父窗口的 `{__deck:true,type,index,total}`、
 *     父窗口 → iframe 的 `{__deckAction:true,action}`、Esc 上报 `exit-present`、
 *     点击左右 25% 区域翻页、`ready` 就绪信号；因此 `SlideStage` 无需改动即可换渲染器。
 *   · 不再需要 reveal（119KB + 54KB CSS）：固定 1920×1080 画布 + `transform: scale`
 *     适配 + 自有翻页，运行时只有几十行（体积与自由度都更优，见设计文档 §5.1）。
 *
 * 沙箱不变：文档仍跑在 `sandbox="allow-scripts"`（不给 allow-same-origin）的 opaque origin 里，
 * 内容全部经 `render.ts` 转义，文档内只有我们自己的一个内联脚本。
 */
import baseCss from '../vendor/html-ppt/base.css?raw';
import layoutsCss from './layouts.css?raw';
import { renderPages } from './render';
import { findTheme, themeCss } from './theme';
import { escapeHtml } from './render';
import type { DeckMeta, Page } from './types';

export interface StageOptions {
  pages: Page[];
  meta: DeckMeta;
  themeId?: string;
  /** 课程自定义模板的 token 覆盖（旧 TemplateDesign 映射而来） */
  themeOverrides?: Record<string, string>;
  slideNumber?: boolean;
  progress?: boolean;
  /** 页脚左侧文案；缺省「课程 · 章节」 */
  footerText?: string | null;
  /** 页脚 logo（data URL） */
  logoDataUrl?: string | null;
  resolveImage?: (fileId: string) => string | undefined;
}

/** 画布尺寸（base.css 的 `.deck` 默认值，这里显式写出来供断言与运行时共用） */
export const CANVAS = { width: 1920, height: 1080 } as const;

/**
 * 运行时：缩放适配 + 翻页 + 与父窗口的 postMessage 契约。
 * 写成 ES5 风格的字符串（内联进 srcdoc，不需要打包器处理）。
 */
function runtimeScript(total: number): string {
  return `(function () {
  var deck = document.getElementById('deck');
  var slides = [].slice.call(deck.querySelectorAll('.slide'));
  var total = ${total};
  var index = 0;
  var readyPosted = false;

  function post(payload) {
    try { parent.postMessage(Object.assign({ __deck: true }, payload), '*'); } catch (e) {}
  }
  post({ type: 'boot' });
  window.addEventListener('error', function (event) {
    post({ type: 'deck-error', message: String((event && event.message) || 'unknown') });
  });

  /* 固定画布整体缩放：不 reflow，因此版式在任何窗口尺寸下完全一致 */
  var W = ${CANVAS.width};
  var H = ${CANVAS.height};
  function scale() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    deck.style.setProperty('--deck-scale', String(s));
    if (isOverviewOpen()) layoutThumbs();
  }
  window.addEventListener('resize', scale);

  /* 总览（缩略图墙）：克隆每页 DOM 等比缩小 —— 不需要截图能力，也不额外发请求。
     缩略图容器带上 deck 类，于是版式与令牌（--fs-boost/--ly-scale/卡片风格）全都复用，
     克隆页与原页一模一样。2026-10-10 补：此前只有父窗口 post('overview') 与提示文案，
     运行时其实没有实现，按 O 毫无反应。 */
  var overviewEl = null;
  var thumbBoxes = [];
  var thumbObservers = [];
  function layoutThumbs() {
    for (var k = 0; k < thumbBoxes.length; k += 1) {
      var box = thumbBoxes[k];
      var thumb = box.parentNode;
      var width = thumb ? thumb.clientWidth : 0;
      /* 宽度还没量出来（.overview 刚从 display:none 切成 grid）就跳过这次：
         按 1px 兜底会把缩略图缩成一条线（2026-10-10 实测踩到）。等 ResizeObserver 补算。 */
      if (!width || width <= 1) continue;
      box.style.transform = 'scale(' + (width / W) + ')';
    }
  }
  function buildOverview() {
    if (overviewEl) return;
    overviewEl = document.createElement('div');
    overviewEl.className = 'overview';
    for (var i = 0; i < slides.length; i += 1) {
      var thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.setAttribute('data-index', String(i));
      var box = document.createElement('div');
      box.className = 'thumb-canvas deck';
      box.style.width = W + 'px';
      box.style.height = H + 'px';
      box.style.transformOrigin = 'top left';
      var clone = slides[i].cloneNode(true);
      clone.className = clone.className.replace(/\\bis-(active|prev)\\b/g, '').replace(/\\s+/g, ' ').trim();
      clone.className += ' is-active';
      box.appendChild(clone);
      thumbBoxes.push(box);
      var num = document.createElement('div');
      num.className = 'n';
      num.textContent = String(i + 1);
      var cap = document.createElement('div');
      cap.className = 't';
      var head = slides[i].querySelector('.ly-title, h1, h2');
      cap.textContent = head ? head.textContent.replace(/\\s+/g, ' ').trim().slice(0, 32) : '';
      thumb.appendChild(box);
      thumb.appendChild(num);
      thumb.appendChild(cap);
      overviewEl.appendChild(thumb);
      /* 尺寸就绪后自动补算一次缩放（首帧量不到宽度时靠它兜底） */
      if (window.ResizeObserver) {
        var observer = new ResizeObserver(layoutThumbs);
        observer.observe(thumb);
        thumbObservers.push(observer);
      }
    }
    overviewEl.addEventListener('click', function (event) {
      /* 不冒泡给 document：避免再触发"点两侧翻页"把刚跳的页顶掉 */
      event.stopPropagation();
      var target = event.target;
      var thumb = target && target.closest ? target.closest('.thumb') : null;
      if (thumb) show(Number(thumb.getAttribute('data-index')) || 0);
      closeOverview();
    });
    document.body.appendChild(overviewEl);
  }
  function isOverviewOpen() {
    return !!overviewEl && overviewEl.className.split(' ').indexOf('open') >= 0;
  }
  function openOverview() {
    buildOverview();
    /* ⚠️ 顺序要紧：先 open 再量宽度 —— .overview 默认 display:none，此时子元素 clientWidth 为 0，
       缩略图会被算成 scale(0) 而整片空白（2026-10-10 实测踩到）。open 后同步再量一次兜底布局时序。
       ⚠️ 本函数体是模板字符串：注释里**绝不能出现反引号**，否则字符串提前闭合、整段脚本错乱
       （2026-10-10 实测踩到；断言 assert-semantic.mjs 会拦）。 */
    overviewEl.className = 'overview open';
    layoutThumbs();
    requestAnimationFrame(layoutThumbs);
  }
  function closeOverview() {
    if (overviewEl) overviewEl.className = 'overview';
  }
  function toggleOverview() {
    if (isOverviewOpen()) closeOverview();
    else openOverview();
  }

  var bar = document.querySelector('.progress-bar > span');
  function paint() {
    for (var i = 0; i < slides.length; i += 1) {
      slides[i].classList.toggle('is-active', i === index);
      slides[i].classList.toggle('is-prev', i < index);
    }
    if (bar) bar.style.width = ((index + 1) / total * 100) + '%';
  }

  function postReady() {
    if (readyPosted) return;
    readyPosted = true;
    post({ type: 'ready', index: index, total: total });
  }

  function show(next, silent) {
    var clamped = Math.max(0, Math.min(total - 1, next));
    var changed = clamped !== index;
    index = clamped;
    paint();
    if (changed && !silent) post({ type: 'slidechanged', index: index });
  }

  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.__deckAction !== true) return;
    if (data.action === 'next') show(index + 1);
    else if (data.action === 'prev') show(index - 1);
    else if (data.action === 'goto' && typeof data.index === 'number') show(data.index);
    else if (data.action === 'overview') toggleOverview();
    else if (data.action === 'escape') {
      /* 宿主页面的 Esc：总览开着先关总览，否则回传"退出放映"由页面决定 */
      if (isOverviewOpen()) closeOverview();
      else post({ type: 'exit-present' });
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      /* 总览开着时 Esc 先关总览（放映态再按一次才退出放映） */
      if (isOverviewOpen()) { closeOverview(); return; }
      post({ type: 'exit-present' });
      return;
    }
    if (event.key === 'o' || event.key === 'O') { toggleOverview(); event.preventDefault(); return; }
    /* 总览开着时不吃翻页键：点击缩略图跳页，方向键留给"移动选择"以外的场景（避免误翻） */
    if (isOverviewOpen()) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { show(index + 1); event.preventDefault(); }
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { show(index - 1); event.preventDefault(); }
  });

  document.addEventListener('click', function (event) {
    /* 总览开着时只认缩略图点击 —— 否则点缩略图会被这条"点两侧翻页"再翻一页（2026-10-10 实测） */
    if (isOverviewOpen()) return;
    if (event.defaultPrevented) return;
    var target = event.target;
    if (target && target.closest && target.closest('a, button, input, textarea, select, video, audio')) return;
    var selection = window.getSelection && window.getSelection();
    if (selection && !selection.isCollapsed) return;
    var ratio = event.clientX / window.innerWidth;
    if (ratio >= 0.75) show(index + 1);
    else if (ratio <= 0.25) show(index - 1);
  });

  scale();
  paint();
  /* 就绪 = 首屏已排版 + 字体已到位（两个 tick 保证浏览器已完成一次 paint） */
  function finish() {
    requestAnimationFrame(function () { requestAnimationFrame(postReady); });
  }
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(finish, finish);
  } else {
    finish();
  }
})();`;
}

/**
 * 组装完整自包含文档。
 *
 * **异步**的原因：公式（`formula` 块）按需加载 KaTeX —— 不含公式的 deck 完全不加载它。
 * KaTeX 用 `output: 'mathml'` 生成 **MathML**（现代浏览器原生渲染），因此**不需要内联任何字体**
 * —— 这正是当初"公式很难做"的症结（KaTeX 的 HTML 输出依赖 20 个 woff2 字体文件）。
 */
export async function buildSemanticDeckHtml(options: StageOptions): Promise<string> {
  const { pages, meta } = options;
  const theme = findTheme(options.themeId);
  let renderTex: ((tex: string) => string) | undefined;
  if (pages.some((page) => page.blocks.some((block) => block.kind === 'formula'))) {
    try {
      const katexModule = (await import('katex')) as unknown as {
        default?: { renderToString: (tex: string, opts: Record<string, unknown>) => string };
        renderToString?: (tex: string, opts: Record<string, unknown>) => string;
      };
      const katex = katexModule.default ?? (katexModule as { renderToString: (tex: string, opts: Record<string, unknown>) => string });
      renderTex = (tex) =>
        katex.renderToString(tex, { output: 'mathml', throwOnError: false, displayMode: true });
    } catch (error) {
      // 加载失败不能拖垮整页：降级为等宽源码
      console.warn('[semantic] KaTeX 加载失败，公式降级为源码：', (error as Error).message);
    }
  }
  const body = renderPages(pages, meta, {
    slideNumber: options.slideNumber !== false,
    resolveImage: options.resolveImage,
    footerText: options.footerText,
    renderTex,
  });
  const logo = options.logoDataUrl
    ? `<img class="deck-logo" data-pos="bottom-right" src="${escapeHtml(options.logoDataUrl)}" alt="" />`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(pages[0]?.title ?? meta.chapter)}</title>
<style>${baseCss}</style>
<style>${themeCss(theme, options.themeOverrides)}</style>
<style>${layoutsCss}</style>
</head>
<body>
<div class="deck" id="deck">
${body}
${logo}
</div>
${options.progress === false ? '' : '<div class="progress-bar"><span></span></div>'}
<script>${runtimeScript(pages.length)}</script>
</body>
</html>
`;
}
