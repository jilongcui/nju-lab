import {
  DeckValidationError,
  SLIDE_LAYOUTS,
  SlideJson,
  SlideLayout,
  SlideLimits,
  newSlideId,
  validateSlides,
} from './deck.schema';

/**
 * deck 的 **Markdown 投影**（见设计文档 §7）。
 *
 * 定位：JSON 是唯一真源，Markdown 是它的**可读投影**，给教师日常写作/从章节正文搬运内容用。
 *   · `toMarkdown`    —— 确定性输出（每页都带 `<!-- .slide: layout=… -->`），所以"切视图"不会漂移
 *   · `parseMarkdown` —— 只解析受支持的子集，失败给**行号**，不静默丢弃
 *   · `mergeMarkdown` —— **关键**：MD 视图表达不了的高级字段（`attrs.background/transition/className`）
 *                        按页位次合并回，避免"用 MD 视图保存一次就悄悄丢掉 JSON 里的高级设置"
 *
 * 支持的子集（刻意保持小）：
 *   `<!-- .slide: layout=bullets -->` 设页属性；`# 标题` / `## 副标题`；`- 要点`；
 *   `<!-- .col -->` 分两栏；围栏代码块；`> 引用`（末行 `> — 出处` 作 cite）；`![caption](url)`；
 *   `<!-- .notes: 讲者备注 -->`（换行写成字面 `\n`）；分页既认指令行也认独立一行的 `---`。
 */

const SLIDE_DIRECTIVE = /^\s*<!--\s*\.slide\s*:?\s*(.*?)\s*-->\s*$/;
const NOTES_DIRECTIVE = /^\s*<!--\s*\.notes\s*:\s*([\s\S]*?)\s*-->\s*$/;
const COL_DIRECTIVE = /^\s*<!--\s*\.col\s*-->\s*$/;
const PAGE_BREAK = /^\s*---\s*$/;
const FENCE = /^\s*```(\w*)\s*$/;

/** 允许承载 `- 要点` 的布局：这些页的正文就是要点列表；其余布局的正文有专属语义 */
const BULLET_LAYOUTS: SlideLayout[] = ['cover', 'section', 'bullets', 'end'];

function encodeNotes(notes: string): string {
  return notes.replace(/\r?\n/g, '\\n');
}

function decodeNotes(notes: string): string {
  return notes.replace(/\\n/g, '\n');
}

function parseLayoutAttributes(
  line: string,
): { layout?: SlideLayout; notes?: string } {
  const directive = SLIDE_DIRECTIVE.exec(line);
  if (!directive || !directive[1]) return {};
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z][\w-]*)\s*=\s*("([^"]*)"|'([^']*)'|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(directive[1]))) {
    attrs[match[1]] = match[3] ?? match[4] ?? match[2];
  }
  const result: { layout?: SlideLayout; notes?: string } = {};
  if (attrs.layout) result.layout = attrs.layout as SlideLayout;
  if (attrs.notes) result.notes = decodeNotes(attrs.notes);
  return result;
}

function collapseBlankLines(text: string): string {
  return text
    .split('\n')
    .reduce<string[]>((acc, line) => {
      if (line.trim() === '' && acc.length && acc[acc.length - 1] === '') return acc;
      acc.push(line.trim() === '' ? '' : line.replace(/\s+$/, ''));
      return acc;
    }, [])
    .join('\n')
    .trim();
}

/** JSON → Markdown（确定性；往返不漂移） */
export function toMarkdown(slides: SlideJson[]): string {
  const pages = slides.map((slide) => {
    const lines: string[] = [`<!-- .slide: layout=${slide.layout} -->`];
    if (slide.title) lines.push(`# ${slide.title}`);
    if (slide.subtitle) lines.push(`## ${slide.subtitle}`);

    // bullets 在"要点型"布局（cover/section/bullets/end）都输出，保证这些页的要点也能往返
    if (BULLET_LAYOUTS.includes(slide.layout)) {
      for (const bullet of slide.bullets ?? []) lines.push(`- ${bullet}`);
    }

    switch (slide.layout) {
      case 'two-col':
        lines.push('', slide.left ?? '', '', '<!-- .col -->', '', slide.right ?? '');
        break;
      case 'code':
        lines.push(
          '',
          '```' + (slide.code?.lang || 'text'),
          slide.code?.content ?? '',
          '```',
        );
        break;
      case 'quote': {
        const quoteLines = (slide.quote?.text ?? '')
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'));
        if (slide.quote?.cite) quoteLines.push(`> — ${slide.quote.cite}`);
        lines.push('', ...quoteLines);
        break;
      }
      case 'image':
        lines.push(
          '',
          slide.image ? `![${slide.image.caption ?? ''}](${slide.image.url})` : '',
        );
        break;
      default:
        // cover / section / end：只有标题与副标题
        break;
    }

    if (slide.notes) lines.push('', `<!-- .notes: ${encodeNotes(slide.notes)} -->`);
    return lines.join('\n');
  });

  return collapseBlankLines(pages.join('\n\n---\n\n')) + '\n';
}

interface PageBlock {
  startLine: number;
  lines: string[];
}

function splitPages(markdown: string): PageBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const pages: PageBlock[] = [];
  let current: PageBlock = { startLine: 1, lines: [] };

  const flush = () => {
    if (current.lines.some((l) => l.trim() !== '')) pages.push(current);
    current = { startLine: 0, lines: [] };
  };

  lines.forEach((line, index) => {
    if (SLIDE_DIRECTIVE.test(line)) {
      flush();
      current.startLine = index + 1;
      current.lines.push(line);
      return;
    }
    if (PAGE_BREAK.test(line)) {
      // 独立一行的 `---` 也当分页（人的习惯）；代价是正文里的水平线会被误判，
      // 因此 toMarkdown 始终输出指令行，往返不受影响
      flush();
      return;
    }
    if (!current.lines.length) current.startLine = index + 1;
    current.lines.push(line);
  });
  flush();

  return pages;
}

function detectLayout(lines: string[], fallback: SlideLayout): SlideLayout {
  const body = lines.filter((l) => !SLIDE_DIRECTIVE.test(l));
  if (body.some((l) => COL_DIRECTIVE.test(l))) return 'two-col';
  if (body.some((l) => FENCE.test(l))) return 'code';
  if (body.some((l) => /^\s*>/.test(l))) return 'quote';
  if (body.some((l) => /^\s*!\[/.test(l))) return 'image';
  if (body.some((l) => /^\s*[-*]\s+/.test(l))) return 'bullets';
  return fallback;
}

function parsePage(page: PageBlock, index: number, limits: SlideLimits): SlideJson {
  const errorAt = (lineNo: number, message: string) =>
    new DeckValidationError(`第 ${lineNo} 行（第 ${index + 1} 页）：${message}`);

  let declaredLayout: SlideLayout | undefined;
  let notes: string | undefined;
  const body: string[] = [];

  for (const [offset, line] of page.lines.entries()) {
    const lineNo = page.startLine + offset;
    const notesMatch = NOTES_DIRECTIVE.exec(line);
    if (notesMatch) {
      notes = decodeNotes(notesMatch[1]);
      continue;
    }
    if (SLIDE_DIRECTIVE.test(line) && body.length === 0 && !declaredLayout) {
      const parsed = parseLayoutAttributes(line);
      declaredLayout = parsed.layout;
      if (parsed.notes) notes = parsed.notes;
      continue;
    }
    body.push(line);
    if (notesMatch === null && /^\s*<!--\s*\.notes/.test(line)) {
      throw errorAt(lineNo, '备注指令必须写成 `<!-- .notes: … -->`');
    }
  }

  if (declaredLayout && !SLIDE_LAYOUTS.includes(declaredLayout)) {
    throw errorAt(page.startLine, `未知的 layout=${declaredLayout}`);
  }

  const trimmed = body.filter((l) => l.trim() !== '');
  const layout =
    declaredLayout ?? detectLayout(body, index === 0 ? 'cover' : 'section');

  const slide: SlideJson = { id: newSlideId(), layout };

  const titleLine = trimmed.find((l) => /^#\s+/.test(l));
  if (titleLine) slide.title = titleLine.replace(/^#\s+/, '').trim();
  const subtitleLine = trimmed.find((l) => /^##\s+/.test(l));
  if (subtitleLine) slide.subtitle = subtitleLine.replace(/^##\s+/, '').trim();

  const content = trimmed.filter((l) => !/^#{1,2}\s+/.test(l));

  // 要点列表：只在"要点型"布局里解析（two-col/code/quote/image 的正文是别的语义）
  if (BULLET_LAYOUTS.includes(layout)) {
    const bullets = content
      .filter((l) => /^\s*[-*]\s+/.test(l))
      .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean);
    if (bullets.length > limits.maxBullets) {
      throw errorAt(
        page.startLine,
        `要点数 ${bullets.length} 超过上限 ${limits.maxBullets}`,
      );
    }
    if (bullets.length) {
      slide.bullets = bullets.map((b) => b.slice(0, limits.maxChars));
    } else if (layout === 'bullets') {
      throw errorAt(page.startLine, 'bullets 页没有任何要点');
    }
  }

  switch (layout) {
    case 'two-col': {
      const left: string[] = [];
      const right: string[] = [];
      let target = left;
      for (const line of content) {
        if (COL_DIRECTIVE.test(line)) {
          target = right;
          continue;
        }
        target.push(line);
      }
      slide.left = left.join('\n').trim() || undefined;
      slide.right = right.join('\n').trim() || undefined;
      if (!slide.left && !slide.right) {
        throw errorAt(page.startLine, 'two-col 页两栏都是空的');
      }
      break;
    }
    case 'code': {
      const fenceStart = content.findIndex((l) => FENCE.test(l));
      if (fenceStart < 0) throw errorAt(page.startLine, 'code 页缺少 ``` 代码块');
      const lang = FENCE.exec(content[fenceStart])![1] || 'text';
      const rest = content.slice(fenceStart + 1);
      const fenceEnd = rest.findIndex((l) => /^\s*```\s*$/.test(l));
      if (fenceEnd < 0) throw errorAt(page.startLine, 'code 页的 ``` 代码块没有闭合');
      const codeLines = rest.slice(0, fenceEnd);
      if (!codeLines.length) throw errorAt(page.startLine, 'code 页代码块为空');
      slide.code = { lang, content: codeLines.join('\n') };
      break;
    }
    case 'quote': {
      const quoteLines = content.filter((l) => /^\s*>/.test(l));
      if (!quoteLines.length) throw errorAt(page.startLine, 'quote 页缺少 > 引用块');
      const texts = quoteLines.map((l) => l.replace(/^\s*>\s?/, ''));
      const citeLine = texts.findLast((l) => /^[—-]\s+/.test(l));
      const quoteText = (citeLine ? texts.filter((l) => l !== citeLine) : texts)
        .join('\n')
        .trim();
      if (!quoteText) throw errorAt(page.startLine, 'quote 页引用内容为空');
      slide.quote = citeLine
        ? { text: quoteText, cite: citeLine.replace(/^[—-]\s+/, '').trim() }
        : { text: quoteText };
      break;
    }
    case 'image': {
      const imageLine = content.find((l) => /^\s*!\[/.test(l));
      const match = imageLine && /!\[([^\]]*)\]\(([^)\s]+)/.exec(imageLine);
      if (!match) throw errorAt(page.startLine, 'image 页缺少 ![](url) 图片');
      slide.image = { url: match[2], caption: match[1] || undefined };
      break;
    }
    default:
      // cover / section / end 只要有标题即可
      break;
  }

  if (notes) slide.notes = notes.slice(0, limits.maxNotes);

  const hasContent =
    !!slide.title ||
    !!slide.subtitle ||
    !!slide.bullets?.length ||
    !!slide.left ||
    !!slide.right ||
    !!slide.code ||
    !!slide.quote ||
    !!slide.image;
  if (!hasContent) throw errorAt(page.startLine, '这一页没有任何内容');

  return slide;
}

/** Markdown → slides（严格：出问题带行号抛错） */
export function parseMarkdown(
  markdown: string,
  limits: SlideLimits,
): { slides: SlideJson[]; warnings: string[] } {
  const pages = splitPages(markdown);
  if (!pages.length) throw new DeckValidationError('Markdown 视图里没有任何幻灯片');
  if (pages.length > limits.maxSlides) {
    throw new DeckValidationError(`页数 ${pages.length} 超过上限 ${limits.maxSlides}`);
  }
  const slides = pages.map((page, index) => parsePage(page, index, limits));
  return { slides: validateSlides(slides, limits), warnings: [] };
}

/**
 * 用 Markdown 更新既有 deck：**按页位次合并**，把 MD 表达不了的高级字段保留下来。
 * 页数一致时逐页保留 `attrs` / `id` / 已有 notes；页数变化时仍按位次尽力保留，但给出 warning（不静默丢）。
 */
export function mergeMarkdown(
  existing: SlideJson[],
  markdown: string,
  limits: SlideLimits,
): { slides: SlideJson[]; warnings: string[] } {
  const parsed = parseMarkdown(markdown, limits);
  const { slides } = parsed;
  const warnings = [...parsed.warnings];

  if (existing.length !== slides.length) {
    warnings.push(
      `页数由 ${existing.length} 变为 ${slides.length}：新增页没有页级高级设置，被删除页的页级设置（背景/过渡/class）已丢弃`,
    );
  }

  slides.forEach((slide, index) => {
    const previous = existing[index];
    if (!previous) return;
    // id 保持稳定：前端缩略图列表与页级状态都依赖它
    if (previous.id) slide.id = previous.id;
    // MD 视图表达不了的字段：仅在 MD 没写时保留旧值
    if (previous.attrs && !slide.attrs) slide.attrs = previous.attrs;
    if (previous.notes && !slide.notes) slide.notes = previous.notes;
  });

  return { slides, warnings };
}
