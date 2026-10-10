/**
 * 渲染层：语义 `Page` → 固定 1920×1080 画布上的 HTML 片段。
 *
 * 三层规则：
 *   1) **内容只做转义后输出**（`escapeHtml` + 极小的行内标记），模型/教师的内容
 *      永远进不了标签位置 —— 注入面与旧渲染器相同（设计文档 §3.5）；
 *   2) **版式由 intent 决定**，模型不选版式；块与 intent 不匹配时按块兜底，
 *      绝不渲染出畸形结构；
 *   3) 未知 intent/块 → 退化成「主张 + 要点」，宁可朴素也不空白。
 */
import type {
  ArchLevel,
  Block,
  DeckMeta,
  FlowNode,
  MetricItem,
  Page,
  RelationNode,
  SequenceItem,
  TimelinePoint,
} from './types';

export interface RenderContext {
  meta: DeckMeta;
  index: number;
  total: number;
  /** 是否显示页码（页脚右侧） */
  slideNumber: boolean;
  /** 图片解析：`file:` 引用 → 可用 URL（data URL / blob URL）；无则渲染占位 */
  resolveImage?: (fileId: string) => string | undefined;
  /** 页脚左侧文案（模板调参的 footerText）；缺省用「课程 · 章节」 */
  footerText?: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 行内标记：`**强调**` 与 `` `代码` ``（先整体转义，再替换 —— 不可注入） */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * 网格列数：≤4 用项数本身；5–6 用 3 列（两行各 3/3 或 3/2，比 4+2 整齐）；
 * ≥7 用 4 列。**除不尽时宁可少一列，也不要出现孤零零的一行**。
 */
function gridCols(count: number): number {
  if (count <= 4) return Math.max(2, count);
  if (count <= 6) return 3;
  return 4;
}

function colsClass(count: number, max = 4): string {
  return `cols-${Math.min(max, gridCols(count))}`;
}

function head(page: Page): string {
  const parts: string[] = [];
  if (page.kicker) parts.push(`<p class="kicker">${escapeHtml(page.kicker)}</p>`);
  if (page.title) parts.push(`<h2 class="ly-title">${inline(page.title)}</h2>`);
  if (page.subtitle) parts.push(`<p class="ly-lede">${inline(page.subtitle)}</p>`);
  if (page.lede) parts.push(`<p class="ly-lede">${inline(page.lede)}</p>`);
  return parts.length ? `<div class="ly-head">${parts.join('')}</div>` : '';
}

function blockOf<T extends Block['kind']>(page: Page, kind: T): Extract<Block, { kind: T }> | undefined {
  return page.blocks.find((block) => block.kind === kind) as Extract<Block, { kind: T }> | undefined;
}

/* ------------------------------- 各版式 ------------------------------- */

function renderCover(page: Page): string {
  const evidence = blockOf(page, 'evidence');
  const pills = (evidence?.items ?? []).slice(0, 5);
  return `<div class="ly ly-cover">
  <div class="ly-rule"></div>
  ${page.kicker ? `<p class="ly-cover-kicker">${escapeHtml(page.kicker)}</p>` : ''}
  <h1>${inline(page.title ?? '')}</h1>
  ${page.subtitle ? `<p class="ly-cover-sub">${inline(page.subtitle)}</p>` : ''}
  ${
    pills.length
      ? `<div class="ly-pills">${pills.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join('')}</div>`
      : ''
  }
</div>`;
}

function renderSection(page: Page): string {
  const teaser = blockOf(page, 'evidence');
  return `<div class="ly ly-section">
  ${page.number ? `<div class="ly-section-num">${escapeHtml(page.number)}</div>` : ''}
  ${page.kicker ? `<p class="kicker">${escapeHtml(page.kicker)}</p>` : ''}
  <h1>${inline(page.title ?? '')}</h1>
  ${page.lede ? `<p class="ly-lede">${inline(page.lede)}</p>` : ''}
  ${
    teaser?.items.length
      ? `<div class="ly-teaser">${teaser.items.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`
      : ''
  }
</div>`;
}

function renderToc(page: Page): string {
  const seq = blockOf(page, 'sequence');
  const items = seq?.items ?? [];
  return `${head(page)}<div class="ly-toc">${items
    .map(
      (item, i) => `<div class="ly-toc-item">
      <div class="ly-toc-num">${String(i + 1).padStart(2, '0')}</div>
      <div><h4>${inline(item.title)}</h4>${item.desc ? `<p>${inline(item.desc)}</p>` : ''}</div>
    </div>`,
    )
    .join('')}</div>`;
}

function renderClaim(page: Page): string {
  const claim = blockOf(page, 'claim');
  const evidence = blockOf(page, 'evidence');
  const items = evidence?.items ?? [];
  return `${head(page)}
  ${claim ? `<p class="ly-claim">${inline(claim.text)}</p>` : ''}
  ${
    items.length
      ? `<div class="ly-evidence ${items.length > 3 ? 'cols-2' : ''}">${items
          .map(
            (item, i) => `<div class="ly-ev"><span class="ly-ev-i">${String(i + 1).padStart(2, '0')}</span><span>${inline(item)}</span></div>`,
          )
          .join('')}</div>`
      : ''
  }`;
}

function renderPillars(page: Page): string {
  const seq = blockOf(page, 'sequence');
  const evidence = blockOf(page, 'evidence');
  if (seq?.items.length) {
    const items = seq.items;
    return `${head(page)}<div class="ly-cards ${colsClass(items.length)}">${items
      .map(
        (item) => `<div class="ly-card"><h4>${inline(item.title)}</h4>${item.desc ? `<p>${inline(item.desc)}</p>` : ''}${
          item.tag ? `<span class="ly-tag">${escapeHtml(item.tag)}</span>` : ''
        }</div>`,
      )
      .join('')}</div>`;
  }
  const items = evidence?.items ?? [];
  return `${head(page)}<div class="ly-cards ${colsClass(items.length)}">${items
    .map((item) => `<div class="ly-card"><p>${inline(item)}</p></div>`)
    .join('')}</div>`;
}

function renderContrast(page: Page): string {
  const compare = blockOf(page, 'compare');
  const column = (side: { title: string; items: string[]; tone?: string } | undefined, fallback: string) => {
    if (!side) return '';
    const tone = side.tone ?? 'neutral';
    return `<div class="ly-col ${tone}"><h4>${inline(side.title || fallback)}</h4><ul>${side.items
      .map((item) => `<li>${inline(item)}</li>`)
      .join('')}</ul></div>`;
  };
  return `${head(page)}<div class="ly-compare">
  ${column(compare?.left, '方案 A')}
  <div class="ly-mid">→</div>
  ${column(compare?.right, '方案 B')}
</div>`;
}

function renderMetrics(page: Page): string {
  const metric = blockOf(page, 'metric');
  const items = (metric?.items ?? []).slice(0, 4);
  const single = items.length === 1;
  return `${head(page)}<div class="ly-metrics ${single ? 'cols-2' : colsClass(items.length)}">${items
    .map(
      (item: MetricItem) => `<div class="ly-metric ${item.tone ?? 'neutral'}">
      <div class="ly-metric-v">${escapeHtml(item.value)}${item.unit ? escapeHtml(item.unit) : ''}</div>
      <div class="ly-metric-l">${inline(item.label)}</div>
      ${item.detail ? `<div class="ly-metric-d">${escapeHtml(item.detail)}</div>` : ''}
    </div>`,
    )
    .join('')}</div>${page.blocks.some((b) => b.kind === 'note') ? renderNote(page) : ''}`;
}

function renderNote(page: Page): string {
  const note = blockOf(page, 'note');
  return note ? `<p class="ly-note">${inline(note.text)}</p>` : '';
}

function renderSequence(page: Page): string {
  const seq = blockOf(page, 'sequence');
  const items = (seq?.items ?? []) as SequenceItem[];
  return `${head(page)}<div class="ly-steps ${colsClass(items.length)}">${items
    .map(
      (item, i) => `<div class="ly-step">
      <div class="ly-step-n">${i + 1}</div>
      <h4>${inline(item.title)}</h4>
      ${item.desc ? `<p>${inline(item.desc)}</p>` : ''}
      ${item.tag ? `<span class="ly-tag">${escapeHtml(item.tag)}</span>` : ''}
    </div>`,
    )
    .join('')}</div>`;
}

function renderFlow(page: Page): string {
  const flow = blockOf(page, 'flow');
  const nodes = (flow?.nodes ?? []) as FlowNode[];
  const body = nodes
    .map(
      (node) => `<div class="ly-flow-node${node.highlight ? ' hl' : ''}">
        <h4>${inline(node.title)}</h4>${node.desc ? `<p>${inline(node.desc)}</p>` : ''}
      </div>`,
    )
    .join('<div class="ly-flow-arrow"></div>');
  return `${head(page)}<div class="ly-flow">${body}</div>${renderNote(page)}`;
}

function renderArch(page: Page): string {
  const arch = blockOf(page, 'arch');
  const levels = (arch?.levels ?? []) as ArchLevel[];
  return `${head(page)}<div class="ly-arch">${levels
    .map(
      (level) => `<div class="ly-tier${level.highlight ? ' hl' : ''}">
      <div class="ly-tier-name">${escapeHtml(level.name)}</div>
      <div class="ly-cells ${colsClass(level.cells.length, 4)}">${level.cells
        .map((cell) => `<div class="ly-cell"><h4>${inline(cell.title)}</h4>${cell.desc ? `<p>${inline(cell.desc)}</p>` : ''}</div>`)
        .join('')}</div>
    </div>`,
    )
    .join('')}</div>`;
}

/**
 * 关系图：中心节点 + 卫星节点，坐标在**固定容器**内算死（W=1728, H=650），
 * 连线用二次贝塞尔，因此与内容量无关、永不重叠。
 */
function renderRelation(page: Page): string {
  const relation = blockOf(page, 'relation');
  const nodes = (relation?.nodes ?? []) as RelationNode[];
  if (!nodes.length) return head(page);
  const center = nodes.find((node) => node.center) ?? nodes[0];
  const satellites = nodes.filter((node) => node !== center).slice(0, 4);
  const W = 1728;
  const H = 650;
  const cenX = W / 2;
  const cenY = H / 2;

  const slots: { x: number; y: number }[] = [];
  const leftCount = Math.ceil(satellites.length / 2);
  const rightCount = satellites.length - leftCount;
  const laneY = (count: number, i: number) => {
    if (count <= 0) return cenY;
    if (count === 1) return cenY;
    return [H * 0.2, H * 0.8][Math.min(1, i)];
  };
  for (let i = 0; i < leftCount; i += 1) slots.push({ x: W * 0.155, y: laneY(leftCount, i) });
  for (let i = 0; i < rightCount; i += 1) slots.push({ x: W * 0.845, y: laneY(rightCount, i) });

  const paths = satellites
    .map((_, i) => {
      const slot = slots[i];
      const fromX = slot.x < cenX ? cenX - 230 : cenX + 230;
      const toX = slot.x < cenX ? slot.x + 210 : slot.x - 210;
      const c1x = (fromX + toX) / 2;
      return `<path d="M${fromX},${cenY} C${c1x},${cenY} ${c1x},${slot.y} ${toX},${slot.y}"/>`;
    })
    .join('');

  const satelliteNodes = satellites
    .map(
      (node, i) => `<div class="ly-rel-n" style="left:${(slots[i].x / W) * 100}%;top:${(slots[i].y / H) * 100}%">
      <h4>${inline(node.label)}</h4>${node.desc ? `<p>${inline(node.desc)}</p>` : ''}
    </div>`,
    )
    .join('');

  return `${head(page)}<div class="ly-rel">
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${paths}</svg>
  <div class="ly-rel-n ly-rel-center" style="left:50%;top:50%">
    <h4>${inline(center.label)}</h4>${center.desc ? `<p>${inline(center.desc)}</p>` : ''}
  </div>
  ${satelliteNodes}
</div>${renderNote(page)}`;
}

function renderTimeline(page: Page): string {
  const timeline = blockOf(page, 'timeline');
  const points = ((timeline?.points ?? []) as TimelinePoint[]).slice(0, 6);
  return `${head(page)}<div class="ly-tl"><div class="ly-tl-row" style="grid-template-columns:repeat(${points.length},1fr)">
  ${points
    .map(
      (point) => `<div class="ly-tl-item${point.highlight ? ' hl' : ''}">
      <div class="ly-tl-at">${escapeHtml(point.at)}</div>
      <div class="ly-tl-dot"></div>
      <div class="ly-tl-card"><h4>${inline(point.title)}</h4>${point.desc ? `<p>${inline(point.desc)}</p>` : ''}</div>
    </div>`,
    )
    .join('')}
</div></div>`;
}

function renderTable(page: Page): string {
  const table = blockOf(page, 'table');
  if (!table) return `${head(page)}`;
  const align = table.align ?? [];
  const cell = (value: string, i: number, isHead = false) => {
    const right = align[i] === 'r';
    const tag = isHead ? 'th' : 'td';
    return `<${tag}${right ? ' class="r"' : ''}>${inline(value)}</${tag}>`;
  };
  return `${head(page)}<table class="ly-table">
  <thead><tr>${table.head.map((h, i) => cell(h, i, true)).join('')}</tr></thead>
  <tbody>${table.rows
    .map((row) => `<tr>${row.map((value, i) => cell(value, i)).join('')}</tr>`)
    .join('')}</tbody>
</table>${renderNote(page)}`;
}

function renderCode(page: Page): string {
  const code = blockOf(page, 'code');
  if (!code) return `${head(page)}`;
  const KEYWORDS =
    /\b(def|return|import|from|with|for|in|if|else|class|self|as|not|and|or|None|True|False)\b/g;
  const highlight = (text: string) => text.replace(KEYWORDS, '<span class="kw">$1</span>');
  const lines = code.content.split('\n').slice(0, 22);
  const highlighted = lines
    .map((line) => {
      const escaped = escapeHtml(line);
      const cut = escaped.indexOf('#');
      // 注释之前的代码做关键字着色，注释整段包起来 —— 顺序反了会把 span 属性里的 class 也染色
      if (cut >= 0) return highlight(escaped.slice(0, cut)) + `<span class="cm">${escaped.slice(cut)}</span>`;
      return highlight(escaped);
    })
    .join('\n');
  return `${head(page)}<div class="ly-code">
  <div class="ly-code-bar"><i></i><i></i><i></i><span>${escapeHtml(code.lang)}</span></div>
  <pre>${highlighted}</pre>
</div>${code.caption ? `<p class="ly-code-cap">${inline(code.caption)}</p>` : ''}`;
}

function renderQuote(page: Page): string {
  const quote = blockOf(page, 'quote');
  return `<div class="ly ly-quote">
  <div class="ly-quote-mark">“</div>
  <blockquote>${inline(quote?.text ?? page.title ?? '')}</blockquote>
  ${quote?.cite ? `<div class="ly-quote-cite">— ${escapeHtml(quote.cite)}</div>` : ''}
</div>`;
}

/** 图片框：拿不到图片时渲染占位（绝不留空白，也绝不发外部请求） */
function imgFrame(fileId: string, caption: string | undefined, ctx: RenderContext, contain: boolean): string {
  const src = ctx.resolveImage?.(fileId);
  if (!src) {
    return `<div class="ly-img-missing">图片不可用${caption ? `：${escapeHtml(caption)}` : ''}</div>`;
  }
  return `<figure class="img-frame${contain ? ' contain' : ''}"><img src="${escapeHtml(src)}" alt="${escapeHtml(
    caption ?? '',
  )}" /></figure>`;
}

function renderImage(page: Page, ctx: RenderContext): string {
  const image = blockOf(page, 'image');
  if (!image) return head(page);
  const evidence = blockOf(page, 'evidence');
  const role = image.role ?? (evidence?.items.length ? 'hero' : 'inline');

  if (role === 'grid') {
    const items = (image.items?.length ? image.items : [{ fileId: image.fileId, caption: image.caption }]).slice(0, 4);
    const cells = items
      .map((item) => `<div class="ly-gallery-cell">${imgFrame(item.fileId, undefined, ctx, true)}${
        item.caption ? `<p class="img-cap">${escapeHtml(item.caption)}</p>` : ''
      }</div>`)
      .join('');
    return `${head(page)}<div class="ly-gallery ${colsClass(items.length)}">${cells}</div>${renderNote(page)}`;
  }

  if (role === 'full') {
    return `${head(page)}<div class="ly-media full">${imgFrame(image.fileId, image.caption, ctx, true)}</div>${renderNote(page)}`;
  }

  const frame = imgFrame(image.fileId, image.caption, ctx, false);
  if (role === 'hero' && evidence?.items.length) {
    return `${head(page)}<div class="ly-media hero">
  <div>${frame}</div>
  <div class="ly-evidence">${evidence.items
    .map((item) => `<div class="ly-ev"><span>${inline(item)}</span></div>`)
    .join('')}</div>
</div>`;
  }
  return `${head(page)}<div class="ly-media inline">${frame}</div>${renderNote(page)}`;
}

function renderSummary(page: Page): string {
  const evidence = blockOf(page, 'evidence');
  const claim = blockOf(page, 'claim');
  const items = evidence?.items ?? [];
  return `${head(page)}
  ${claim ? `<p class="ly-claim">${inline(claim.text)}</p>` : ''}
  <div class="ly-summary">${items
    .map((item, i) => `<div class="ly-sum-item"><b>${String(i + 1).padStart(2, '0')}</b><span>${inline(item)}</span></div>`)
    .join('')}</div>`;
}

const RENDERERS: Record<Page['intent'], (page: Page, ctx: RenderContext) => string> = {
  cover: renderCover,
  toc: renderToc,
  section: renderSection,
  claim: renderClaim,
  contrast: renderContrast,
  pillars: renderPillars,
  metric: renderMetrics,
  sequence: renderSequence,
  flow: renderFlow,
  arch: renderArch,
  relation: renderRelation,
  timeline: renderTimeline,
  table: renderTable,
  example: renderCode,
  quote: renderQuote,
  image: renderImage,
  summary: renderSummary,
};

function renderBody(page: Page, ctx: RenderContext): string {
  const renderer = RENDERERS[page.intent] ?? renderClaim;
  const inner = renderer(page, ctx);
  return inner.startsWith('<div class="ly ly-') ? inner : `<div class="ly">${inner}</div>`;
}

/** 单页 → `<section class="slide">` */
export function renderPage(page: Page, ctx: RenderContext): string {
  const footer =
    page.intent === 'cover'
      ? ''
      : `<div class="deck-footer">
    <span>${escapeHtml(
      ctx.footerText || `${ctx.meta.course}${ctx.meta.chapter ? ` · ${ctx.meta.chapter}` : ''}`,
    )}</span>
    ${ctx.slideNumber ? `<span class="slide-number" data-current="${ctx.index + 1}" data-total="${ctx.total}"></span>` : ''}
  </div>`;
  const notes = page.notes ? `<div class="notes">${escapeHtml(page.notes)}</div>` : '';
  const title = page.title ?? ctx.meta.chapter;
  return `<section class="slide" data-title="${escapeHtml(title)}">
  ${renderBody(page, ctx)}
  ${footer}
  ${notes}
</section>`;
}

/** 整份 deck → 全部 `<section>` */
export function renderPages(
  pages: Page[],
  meta: DeckMeta,
  options: {
    slideNumber?: boolean;
    resolveImage?: (fileId: string) => string | undefined;
    footerText?: string | null;
  } = {},
): string {
  return pages
    .map((page, index) =>
      renderPage(page, {
        meta,
        index,
        total: pages.length,
        slideNumber: options.slideNumber !== false,
        resolveImage: options.resolveImage,
        footerText: options.footerText,
      }),
    )
    .join('\n');
}
