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
  /** LaTeX → HTML/MathML（由 stage 按需注入 KaTeX；缺省降级为等宽源码） */
  renderTex?: (tex: string) => string;
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

/* ------------------------------- 数据图（自绘 SVG） ------------------------------- */

const CHART_COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--accent-3)'];

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(1);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** 取「好看」的刻度步长（1/2/2.5/5/10 × 10^k），避免出现 0.201 这种轴标签 */
function niceStep(range: number, ticks: number): number {
  if (!(range > 0)) return 1;
  const rough = range / ticks;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

function truncateLabel(label: string, max = 12): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * 数据图：**自己画 SVG**，不引图表库 ——
 * 零依赖（不进包）、颜色全走主题 token、与固定画布天然契合，且模型只提供数据（不碰图形）。
 */
function renderChart(block: Record<string, unknown> & { kind: 'chart' }): string {
  const kind = String(block.chart ?? 'bar');
  const labels = Array.isArray(block.labels) ? block.labels.map((l) => String(l)) : [];
  const series = (Array.isArray(block.series) ? block.series : [])
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({ name: typeof s.name === 'string' ? s.name : '', values: (Array.isArray(s.values) ? s.values : []).map(Number) }))
    .filter((s) => s.values.length);
  if (!labels.length || !series.length) return '';
  const flat = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (!flat.length) return '';
  const unit = typeof block.unit === 'string' ? block.unit : '';
  const highlight = Number.isInteger(block.highlight) ? Number(block.highlight) : -1;

  const legend =
    series.length > 1 || series[0].name
      ? `<div class="ly-chart-legend">${series
          .map(
            (s, i) =>
              `<span><i style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></i>${escapeHtml(s.name || `系列 ${i + 1}`)}</span>`,
          )
          .join('')}</div>`
      : '';

  if (kind === 'donut') {
    const values = series[0].values;
    const total = values.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0) || 1;
    const R = 150;
    const C = 2 * Math.PI * R;
    let offset = 0;
    const arcs = values
      .map((value, i) => {
        const ratio = (Number.isFinite(value) ? value : 0) / total;
        const dash = `${(ratio * C).toFixed(2)} ${(C - ratio * C).toFixed(2)}`;
        const arc = `<circle class="ly-chart-arc" cx="210" cy="210" r="${R}" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset * C).toFixed(2)}" style="stroke:${CHART_COLORS[i % CHART_COLORS.length]}"/>`;
        offset += ratio;
        return arc;
      })
      .join('');
    const legendItems = labels
      .map(
        (label, i) =>
          `<div class="ly-donut-item"><i style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></i><span class="ly-donut-label">${escapeHtml(
            label,
          )}</span><b>${formatNumber(series[0].values[i] ?? 0)}${escapeHtml(unit)}</b><span class="ly-donut-pct">${Math.round(
            ((series[0].values[i] ?? 0) / total) * 100,
          )}%</span></div>`,
      )
      .join('');
    return `<div class="ly-donut">
  <svg viewBox="0 0 420 420" class="ly-chart-svg">
    <circle class="ly-chart-ring" cx="210" cy="210" r="${R}"/>
    ${arcs}
  </svg>
  <div class="ly-donut-legend">${legendItems}</div>
</div>`;
  }

  const W = 1000;
  const H = 430;
  const padL = 78;
  const padR = 26;
  const padT = 30;
  const padB = 64;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxValue = Math.max(...flat);
  const minValue = Math.min(...flat);
  const ticks = 4;
  // 轴范围取「好看的刻度」倍数：柱子顶到网格线上，标签也整齐
  const step = niceStep(Math.max(maxValue - Math.min(minValue, 0), Math.abs(maxValue) * 0.1, 1e-9), ticks);
  const top = Math.ceil(maxValue / step) * step || step;
  const bottom = minValue < 0 ? Math.floor(minValue / step) * step : 0;
  const yOf = (value: number) => padT + plotH * (1 - (value - bottom) / (top - bottom));
  let grid = '';
  const scale = (top - bottom) / step;
  for (let i = 0; i <= scale; i += 1) {
    const value = bottom + step * i;
    const y = yOf(value);
    grid += `<line class="ly-chart-grid" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ly-chart-axis" x="${padL - 14}" y="${(y + 6).toFixed(1)}" text-anchor="end">${formatNumber(value)}${escapeHtml(
      i === scale ? unit : '',
    )}</text>`;
  }
  const baseline = yOf(bottom);
  grid += `<line class="ly-chart-axis-line" x1="${padL}" x2="${W - padR}" y1="${baseline.toFixed(1)}" y2="${baseline.toFixed(1)}"/>`;

  const slot = plotW / labels.length;
  const labelNodes = labels
    .map((label, i) => {
      const x = padL + slot * (i + 0.5);
      const cls = i === highlight ? 'ly-chart-xlabel hl' : 'ly-chart-xlabel';
      return `<text class="${cls}" x="${x.toFixed(1)}" y="${H - 22}" text-anchor="middle">${escapeHtml(truncateLabel(label))}</text>`;
    })
    .join('');

  let body = '';
  if (kind === 'line') {
    const paths = series
      .map((s, si) => {
        const points = s.values.map((value, i) => [padL + slot * (i + 0.5), yOf(value)] as const);
        const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        const area = `${d} L${points[points.length - 1][0].toFixed(1)},${baseline.toFixed(1)} L${points[0][0].toFixed(1)},${baseline.toFixed(
          1,
        )} Z`;
        const color = CHART_COLORS[si % CHART_COLORS.length];
        return `<path class="ly-chart-area" d="${area}" style="fill:${color}"/>` + `<path class="ly-chart-line" d="${d}" style="stroke:${color}"/>` +
          points
            .map(
              ([x, y], i) =>
                `<circle class="ly-chart-dot${i === highlight ? ' hl' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${
                  i === highlight ? 11 : 8
                }" style="stroke:${color}"/>`,
            )
            .join('');
      })
      .join('');
    body = paths;
  } else {
    // 柱子别撑满：窄一点更像图表，也更配固定画布
    const groupW = Math.min(slot * 0.6, 200 * Math.max(1, series.length));
    const barW = groupW / series.length;
    body = labels
      .map((_, i) => {
        const groupX = padL + slot * (i + 0.5) - groupW / 2;
        return series
          .map((s, si) => {
            const value = Number.isFinite(s.values[i]) ? s.values[i] : 0;
            const y = yOf(Math.max(value, bottom));
            const height = Math.max(baseline - y, 2);
            const x = groupX + barW * si;
            const color = CHART_COLORS[si % CHART_COLORS.length];
            const hl = i === highlight;
            const valueLabel =
              series.length === 1
                ? `<text class="ly-chart-value${hl ? ' hl' : ''}" x="${(x + barW / 2).toFixed(1)}" y="${(y - 12).toFixed(
                    1,
                  )}" text-anchor="middle">${formatNumber(value)}${escapeHtml(unit)}</text>`
                : '';
            return `<rect class="ly-chart-bar${hl ? ' hl' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(
              barW * 0.86
            ).toFixed(1)}" height="${height.toFixed(1)}" rx="6" style="fill:${color}"/>${valueLabel}`;
          })
          .join('');
      })
      .join('');
  }

  return `<div class="ly-chart">${legend}<svg viewBox="0 0 ${W} ${H}" class="ly-chart-svg">${grid}${body}${labelNodes}</svg></div>`;
}

function renderFormula(page: Page, ctx: RenderContext): string {
  const block = blockOf(page, 'formula');
  if (!block) return head(page);
  const body = ctx.renderTex
    ? ctx.renderTex(block.tex)
    : `<code class="ly-formula-fallback">${escapeHtml(block.tex)}</code>`;
  return `${head(page)}<div class="ly-formula">${body}</div>${
    block.caption ? `<p class="ly-code-cap">${inline(block.caption)}</p>` : ''
  }`;
}

function renderData(page: Page): string {
  const chart = blockOf(page, 'chart');
  if (!chart) return `${head(page)}`;
  return `${head(page)}${renderChart(chart)}${renderNote(page)}`;
}


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
  const note = blockOf(page, 'note');
  const lede = page.lede || note?.text || '';
  return `<div class="ly ly-section">
  ${page.number ? `<div class="ly-section-num">${escapeHtml(page.number)}</div>` : ''}
  ${page.kicker ? `<p class="kicker">${escapeHtml(page.kicker)}</p>` : ''}
  <h1>${inline(page.title ?? '')}</h1>
  ${lede ? `<p class="ly-lede">${inline(lede)}</p>` : ''}
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

/**
 * 每种 intent **主渲染**用掉的块类型。其余块由兜底统一补渲染 ——
 * 渲染层绝不静默丢内容（生成侧偶尔会给出 intent 与块不匹配的组合，
 * 例如 `contrast` 页多带一张 `table`：那张表必须照常出现）。
 */
const CONSUMED: Record<Page['intent'], Block['kind'][]> = {
  cover: ['evidence', 'note'],
  toc: ['sequence'],
  section: ['evidence', 'note'],
  claim: ['claim', 'evidence'],
  contrast: ['compare'],
  pillars: ['sequence', 'evidence'],
  // ⚠️ 主渲染器内部已经渲染 note 的 intent，必须把 'note' 也列为已消费 ——
  // 否则兜底会再渲染一次（实测：图表/流程/表格页的补充说明曾出现两遍）
  metric: ['metric', 'note'],
  sequence: ['sequence'],
  flow: ['flow', 'note'],
  arch: ['arch'],
  relation: ['relation', 'note'],
  timeline: ['timeline'],
  table: ['table', 'note'],
  data: ['chart', 'note'],
  example: ['code'],
  quote: ['quote'],
  image: ['image', 'evidence', 'note'],
  summary: ['evidence', 'claim'],
};

/** 单个块 → 借用对应 intent 的渲染器（不渲染页头） */
const BLOCK_INTENT: Record<Block['kind'], Page['intent']> = {
  claim: 'claim',
  evidence: 'claim',
  metric: 'metric',
  sequence: 'sequence',
  flow: 'flow',
  arch: 'arch',
  relation: 'relation',
  timeline: 'timeline',
  compare: 'contrast',
  table: 'table',
  code: 'example',
  quote: 'quote',
  chart: 'data',
  formula: 'claim',
  image: 'image',
  note: 'claim',
};

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
  data: renderData,
  example: renderCode,
  quote: renderQuote,
  image: renderImage,
  summary: renderSummary,
};

function renderBody(page: Page, ctx: RenderContext): string {
  const renderer = RENDERERS[page.intent] ?? renderClaim;
  const inner = renderer(page, ctx);
  const consumed = CONSUMED[page.intent] ?? [];
  const leftovers = page.blocks.filter((block) => !consumed.includes(block.kind));
  const extra = leftovers.length
    ? `<div class="ly-extra">${leftovers
        .map((block) => {
          if (block.kind === 'note') return `<p class="ly-note">${inline(block.text)}</p>`;
          if (block.kind === 'formula') return renderFormula({ intent: 'claim', blocks: [block] }, ctx);
          const blockRenderer = RENDERERS[BLOCK_INTENT[block.kind]];
          return blockRenderer ? blockRenderer({ intent: BLOCK_INTENT[block.kind], blocks: [block] }, ctx) : '';
        })
        .join('')}</div>`
    : '';
  const body = inner + extra;
  return body.startsWith('<div class="ly ly-') ? body : `<div class="ly">${body}</div>`;
}

/** 单页 → `<section class="slide">` */
export function renderPage(page: Page, ctx: RenderContext): string {
  const background = page.background ? ctx.resolveImage?.(page.background.fileId) : undefined;
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
  const bgStyle = background
    ? ` style="background-image:url('${escapeHtml(background)}');background-size:cover;background-position:center"`
    : '';
  const scrim = background
    ? `<div class="ly-bg-scrim" style="${
        page.background?.blur ? 'backdrop-filter:blur(6px);' : ''
      }background:rgba(6,8,14,${(page.background?.dim ?? 0.52).toFixed(2)})"></div>`
    : '';
  return `<section class="slide${background ? ' has-bg' : ''}" data-title="${escapeHtml(title)}"${bgStyle}>
  ${scrim}
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
    renderTex?: (tex: string) => string;
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
        renderTex: options.renderTex,
      }),
    )
    .join('\n');
}
