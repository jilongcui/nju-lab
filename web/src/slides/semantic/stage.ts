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
  /** 页脚左侧文案；缺省只写章节名（课程名不重复进页脚） */
  footerText?: string | null;
  /** 页脚 logo（data URL） */
  logoDataUrl?: string | null;
  /**
   * 是否允许呼出讲稿浮层（按 `S`）—— **学生端传 false**。
   *
   * 讲稿本身已经从数据里剥掉了（见 `slides.service.ts` 的 `deckForViewer`），但快捷键还在：
   * 学生按 `S` 会弹出一个「（本页没有讲稿）」的空浮层 —— 没有泄露，可是"学生端有讲稿功能"
   * 这件事本身就不该成立（2026-10-17 用户指出并实测确认）。默认 true，只有显式传 false 才关。
   */
  allowNotes?: boolean;
  resolveImage?: (fileId: string) => string | undefined;
  /**
   * 预览态「双击就地编辑」：只有教师端编辑视图打开它。
   * 关闭时（学生端、放映、导出）连光标与 hover 提示都不会出现。
   */
  editable?: boolean;
}

/** 画布尺寸（base.css 的 `.deck` 默认值，这里显式写出来供断言与运行时共用） */
export const CANVAS = { width: 1920, height: 1080 } as const;

/**
 * 运行时：缩放适配 + 翻页 + 与父窗口的 postMessage 契约。
 * 写成 ES5 风格的字符串（内联进 srcdoc，不需要打包器处理）。
 */
function runtimeScript(total: number, allowNotes: boolean): string {
  return `(function () {
  var deck = document.getElementById('deck');
  /* 讲稿页（.notes-page）是导出的备注页，不参与放映翻页 */
  var slides = [].slice.call(deck.querySelectorAll('.slide:not(.notes-page)'));
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

  /**
   * 讲稿浮层（讲者视图）。
   *
   * 讲稿按惯例对观众隐藏（vendored base.css 里 .notes{display:none}），所以放映时默认看不到。
   * 这里把它读出来放进底部浮层，按 S 呼出/收起 —— 供讲者自己看（双屏投屏时只有讲者屏可见；
   * 单屏放映等于观众也能看到，因此是**手动开启**而非默认打开）。
   */
  var allowNotes = ${allowNotes ? 'true' : 'false'};
  var notesOverlay = allowNotes ? document.getElementById('notes-overlay') : null;
  var notesBody = notesOverlay ? notesOverlay.querySelector('.notes-overlay-body') : null;
  function notesHtml() {
    var page = slides[index];
    var el = page ? page.querySelector('.notes') : null;
    return el ? el.innerHTML : '';
  }
  /**
   * 把讲稿浮层的状态回传给宿主：{open, height}。
   *
   * 讲者视图要据此把「下一页」预告**挪到浮层正上方**（浮层一打开就占住底部整行，
   * 预告放底部会被它压住）。高度实测回传而不是让宿主猜 —— 浮层是 max-height:42vh 的
   * 自适应高度，讲稿短的页会矮一大截。
   * ⚠️ 本函数体是模板字符串：注释里绝不能出现反引号（会提前闭合），assert-semantic 会拦。
   */
  function postNotesState() {
    post({
      type: 'notes',
      open: isNotesOpen(),
      height: notesOverlay ? notesOverlay.offsetHeight : 0,
    });
  }
  function syncNotes() {
    if (!notesBody) return;
    notesBody.innerHTML = notesHtml() || '<p class="notes-empty">（本页没有讲稿）</p>';
    postNotesState();
  }
  function isNotesOpen() {
    return !!notesOverlay && notesOverlay.classList.contains('open');
  }
  function toggleNotes() {
    if (!allowNotes || !notesOverlay) return;
    if (isNotesOpen()) notesOverlay.classList.remove('open');
    else { syncNotes(); notesOverlay.classList.add('open'); }
    postNotesState();
  }

  /**
   * 预览态「双击就地编辑」（仅当宿主声明 editable）。
   *
   * 只改**纯文本**：双击带 data-edit 的容器 → contenteditable，回车/失焦提交、Esc 取消。
   * 编辑期间屏蔽翻页与快捷键（否则打字会被当成翻页或总览）。
   * 注意：提交的是 textContent，所以该字段原有的内联强调（**粗体**）会退化为纯文本 —— 这是
   * "就地改字"的取舍，要保留富文本请用右栏「源码」。
   */
  var editable = deck.classList.contains('is-editable');
  var editingEl = null;
  function stopEdit(commit) {
    if (!editingEl) return;
    var el = editingEl;
    editingEl = null;
    el.contentEditable = 'false';
    el.classList.remove('is-editing');
    var original = el.getAttribute('data-orig') || '';
    var value = (el.textContent || '').trim();
    if (commit) {
      if (value !== original.trim()) post({ type: 'edit-text', path: el.getAttribute('data-edit') || '', value: value });
      else el.innerHTML = el.getAttribute('data-orig-html') || el.innerHTML;
    } else {
      el.textContent = original;
    }
    el.removeAttribute('data-orig');
    el.removeAttribute('data-orig-html');
  }
  function beginEdit(el) {
    if (editingEl) stopEdit(true);
    editingEl = el;
    el.setAttribute('data-orig', (el.textContent || '').trim());
    el.setAttribute('data-orig-html', el.innerHTML);
    el.contentEditable = 'true';
    el.classList.add('is-editing');
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }
  if (editable) {
    deck.addEventListener('dblclick', function (event) {
      var el = event.target && event.target.closest ? event.target.closest('[data-edit]') : null;
      if (!el || el.isContentEditable) return;
      event.preventDefault();
      event.stopPropagation();
      beginEdit(el);
    });
    document.addEventListener('focusout', function (event) {
      if (editingEl && event.target === editingEl) stopEdit(true);
    });
    /* 回车提交、Esc 取消。用**捕获阶段**：下面的通用 keydown（翻页/总览/讲稿）注册得更晚，
       捕获比冒泡先到，确保编辑期间这两个键不会被当成放映快捷键。 */
    document.addEventListener('keydown', function (event) {
      if (!editingEl) return;
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        event.stopPropagation();
        stopEdit(false);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        stopEdit(true);
      }
    }, true);
  }

  function paint() {
    for (var i = 0; i < slides.length; i += 1) {
      slides[i].classList.toggle('is-active', i === index);
      slides[i].classList.toggle('is-prev', i < index);
    }
    if (bar) bar.style.width = ((index + 1) / total * 100) + '%';
    if (isNotesOpen()) syncNotes();
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
    else if (data.action === 'notes') { if (isNotesOpen() !== !!data.open) toggleNotes(); }
    else if (data.action === 'toggle-notes') toggleNotes();
    else if (data.action === 'escape') {
      /* 宿主页面的 Esc：总览开着先关总览，否则回传"退出放映"由页面决定 */
      if (isOverviewOpen()) closeOverview();
      else post({ type: 'exit-present' });
    }
  });

  document.addEventListener('keydown', function (event) {
    /* 就地编辑期间不抢任何键：打字、回车、Esc 都归编辑框 */
    if (editingEl) return;
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      /* 总览开着时 Esc 先关总览（放映态再按一次才退出放映） */
      if (isNotesOpen()) { toggleNotes(); return; }
      if (isOverviewOpen()) { closeOverview(); return; }
      post({ type: 'exit-present' });
      return;
    }
    if (event.key === 'o' || event.key === 'O') { toggleOverview(); event.preventDefault(); return; }
    if (event.key === 's' || event.key === 'S') { toggleNotes(); event.preventDefault(); return; }
    /* 总览开着时不吃翻页键：点击缩略图跳页，方向键留给"移动选择"以外的场景（避免误翻） */
    if (isOverviewOpen()) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { show(index + 1); event.preventDefault(); }
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { show(index - 1); event.preventDefault(); }
  });

  document.addEventListener('click', function (event) {
    /* 就地编辑期间不翻页（在文字上点击是定位光标） */
    if (editingEl) return;
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

  /**
   * 自动缩放兜底：内容超出安全区时**整体等比缩小**。
   *
   * 固定 1920×1080 画布下，任何内容（长代码块 + 图、多步流程图…）都可能顶掉页脚 ——
   * 实测第 2 章第 14 页（代码 + 图垂直堆叠）超出 72px。与其逐页调尺寸，不如在运行时兜住：
   * 量出页内容高度，超出就把页内容整体等比缩小到安全高度内（居中缩放，观感自然）。
   * 安全高度 = 画布高 − 上下留白（与 layouts.css 里页内容的边距对应）。
   */
  var SAFE_H = H - 2 * 72;
  function autofit() {
    for (var i = 0; i < slides.length; i += 1) {
      var ly = slides[i].querySelector('.ly');
      if (!ly) continue;
      ly.style.transform = '';
      ly.style.transformOrigin = 'center center';
      var h = ly.offsetHeight;
      if (h > SAFE_H) {
        ly.style.transform = 'scale(' + (SAFE_H / h).toFixed(4) + ')';
      }
    }
  }

  /* 图片就绪后再量高度：图没解码完时量出来偏小，兜底会失效 */
  function whenImagesReady(cb) {
    var imgs = [].slice.call(document.querySelectorAll('img'));
    var pending = imgs.filter(function (img) { return !img.complete; });
    if (!pending.length) { cb(); return; }
    var left = pending.length;
    var done = function () { left -= 1; if (left <= 0) cb(); };
    pending.forEach(function (img) {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  scale();
  paint();
  /* 就绪 = 首屏已排版 + 字体与图片都已到位 + 已做溢出兜底（两个 tick 保证浏览器已完成一次 paint） */
  function finish() {
    autofit();
    requestAnimationFrame(function () { requestAnimationFrame(postReady); });
  }
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function () { whenImagesReady(finish); }, function () { whenImagesReady(finish); });
  } else {
    whenImagesReady(finish);
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
  const allowNotes = options.allowNotes !== false;
  const body = renderPages(pages, meta, {
    slideNumber: options.slideNumber !== false,
    resolveImage: options.resolveImage,
    footerText: options.footerText,
    renderTex,
    // 版式开关由**主题**声明：老模板默认全关（观感与改版前一致），
    // 新主题可逐条打开（见 DeckTheme.layoutFlags）。
    pinKicker: theme.layoutFlags?.pinKicker === true,
    chapterOnlyFooter: theme.layoutFlags?.chapterOnlyFooter === true,
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
<div class="deck${options.editable ? ' is-editable' : ''}" id="deck">
${body}
${logo}
</div>
${options.progress === false ? '' : '<div class="progress-bar"><span></span></div>'}
${allowNotes ? '<div class="notes-overlay" id="notes-overlay"><div class="notes-overlay-body"></div></div>' : ''}
<script>${runtimeScript(pages.length, allowNotes)}</script>
</body>
</html>
`;
}
