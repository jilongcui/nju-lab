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
  }
  window.addEventListener('resize', scale);

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
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      post({ type: 'exit-present' });
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { show(index + 1); event.preventDefault(); }
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { show(index - 1); event.preventDefault(); }
  });

  document.addEventListener('click', function (event) {
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
