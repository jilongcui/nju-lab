import {
  SlideJson,
  extractSlidesFromModelJson,
  newSlideId,
  normalizeSlides,
  validateSlides,
} from './deck.schema';
import { chatJson, parseJsonLoose } from './llm.client';
import {
  SLIDES_EXPAND_BATCH,
  SLIDES_LIMITS,
  SLIDES_MAX_TOKENS,
  SLIDES_SOURCE_MAX_CHARS,
  SlidesGeneratorMode,
} from './slides.config';

/**
 * 章节课件生成器：两阶段（先大纲、再逐页扩写），含 mock 与 llm 两条实现。
 *
 * 为什么要两阶段：一次让模型吐 20 页完整 JSON 极易被 max_tokens 截断，且中途没有任何人工介入点；
 * 拆成「大纲 → 按批扩写」之后，单次请求小、失败可局部降级（某批失败就用大纲骨架兜底）。
 *
 * 双轨（照 `EVALUATION_RUNNER=mock|docker` 的既有思路）：
 *   · `MockDeckGenerator` —— 确定性、零成本、不需要 key；开发/测试/演示都用它
 *   · `LlmDeckGenerator`  —— 走 OpenAI 兼容端点（见 llm.client.ts）
 */

export interface DeckSource {
  courseTitle: string;
  chapterTitle: string;
  chapterContent: string;
}

export interface GenerateOutcome {
  deckTitle: string;
  slides: SlideJson[];
  model: string | null;
  tokens: { promptTokens: number; completionTokens: number } | null;
  /** 局部降级等非致命问题，随结果一起返回给教师看 */
  warnings: string[];
}

export interface DeckGenerator {
  readonly mode: SlidesGeneratorMode;
  generate(source: DeckSource): Promise<GenerateOutcome>;
}

// ---------------------------------------------------------------- 文本工具

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n（正文过长，已截断）`;
}

/** 抹掉常见 Markdown 标记，幻灯片正文要的是"干净的话"，不是源代码 */
function stripInlineMarkdown(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;])|(?<=[.])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface SourceSection {
  title: string;
  bullets: string[];
  code: { lang: string; content: string } | null;
}

function splitSections(content: string): SourceSection[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const sections: SourceSection[] = [];
  let current: SourceSection = { title: '', bullets: [], code: null };
  let inFence = false;
  let fenceLang = 'text';
  let fenceBuffer: string[] = [];

  const push = () => {
    const hasBody = current.bullets.length || current.code;
    if (current.title || hasBody) sections.push(current);
    current = { title: '', bullets: [], code: null };
  };

  for (const line of lines) {
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLang = fence[1] || 'text';
        fenceBuffer = [];
      } else {
        inFence = false;
        if (!current.code && fenceBuffer.length) {
          current.code = { lang: fenceLang, content: fenceBuffer.join('\n') };
        }
      }
      continue;
    }
    if (inFence) {
      fenceBuffer.push(line);
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      push();
      current.title = stripInlineMarkdown(heading[2]);
      continue;
    }
    if (/^#\s+/.test(line)) continue; // 一级标题是章名，不重复当小节

    const listItem = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listItem) {
      const text = stripInlineMarkdown(listItem[1]);
      if (text) current.bullets.push(text);
      continue;
    }

    const plain = stripInlineMarkdown(line);
    if (plain.length >= 8) {
      for (const sentence of sentences(plain)) {
        if (sentence.length >= 8 && sentence.length <= 120) {
          current.bullets.push(sentence);
        }
      }
    }
  }
  push();

  return sections.filter((s) => s.title || s.bullets.length || s.code);
}

/** 页数超限时保住首尾（封面与结尾必须留），中间按顺序截断 */
function trimToLimit(slides: SlideJson[], maxSlides: number): SlideJson[] {
  if (slides.length <= maxSlides) return slides;
  const head = slides.slice(0, maxSlides - 1);
  const tail = slides[slides.length - 1];
  return [...head, tail];
}

function toBullets(items: string[], maxBullets: number, maxChars: number): string[] {
  return items
    .map((item) => stripInlineMarkdown(item))
    .filter(Boolean)
    .map((item) => (item.length > maxChars ? `${item.slice(0, maxChars)}…` : item))
    .slice(0, maxBullets);
}

// ---------------------------------------------------------------- mock

/**
 * 确定性 mock：直接按章节正文的二级标题分节，产出「封面 → 目录 → 各节 → 结尾」。
 * 不调用任何外部服务，用于开发、测试与演示（也是 mock 模式下的端到端验证路径）。
 */
export class MockDeckGenerator implements DeckGenerator {
  readonly mode = 'mock' as const;

  async generate(source: DeckSource): Promise<GenerateOutcome> {
    const { maxSlides, maxBullets, maxChars } = SLIDES_LIMITS;
    const sections = splitSections(source.chapterContent);
    const slides: SlideJson[] = [
      {
        id: newSlideId(),
        layout: 'cover',
        title: source.chapterTitle,
        subtitle: source.courseTitle,
        notes: '开场：说明本章在课程中的位置与学习目标。',
      },
    ];

    const outline = sections.map((s) => s.title).filter(Boolean);
    if (outline.length) {
      slides.push({
        id: newSlideId(),
        layout: 'bullets',
        title: '本章脉络',
        bullets: toBullets(outline, maxBullets, maxChars),
        notes: '先总览，再逐节展开。',
      });
    }

    for (const section of sections) {
      if (section.code) {
        slides.push({
          id: newSlideId(),
          layout: 'code',
          title: section.title || '示例代码',
          code: section.code,
          notes: '演示代码时逐行解释关键调用。',
        });
      }
      // 只有代码、没有要点的小节不再单独出一页（否则会出现「标题重复成要点」的空页）
      const bullets = toBullets(section.bullets, maxBullets, maxChars);
      if (bullets.length) {
        slides.push({
          id: newSlideId(),
          layout: 'bullets',
          title: section.title || '内容要点',
          bullets,
          notes: section.title ? `讲解「${section.title}」，结合实验任务说明。` : undefined,
        });
      }
    }

    slides.push({
      id: newSlideId(),
      layout: 'end',
      title: '小结与练习',
      bullets: toBullets(
        outline.length ? outline : ['回顾本章要点', '进入配套实验'],
        maxBullets,
        maxChars,
      ),
      notes: '提示学生进入配套实验并自测。',
    });

    return {
      deckTitle: source.chapterTitle,
      slides: normalizeSlides(trimToLimit(slides, maxSlides), SLIDES_LIMITS),
      model: 'mock',
      tokens: null,
      warnings: [],
    };
  }
}

// ---------------------------------------------------------------- llm

interface OutlineSlide {
  layout: string;
  title?: string;
  bullets?: string[];
}

interface OutlineResult {
  deckTitle: string;
  slides: OutlineSlide[];
}

const LAYOUT_HINT = [
  'cover（封面，仅首页）',
  'section（分节标题）',
  'bullets（要点页，最常用）',
  'two-col（两栏对比）',
  'code（代码页）',
  'quote（引文页）',
  'image（图片页）',
  'end（结束页，仅末页）',
].join('、');

export class LlmDeckGenerator implements DeckGenerator {
  readonly mode = 'llm' as const;

  async generate(source: DeckSource): Promise<GenerateOutcome> {
    const content = truncate(source.chapterContent || '（本章暂无正文）', SLIDES_SOURCE_MAX_CHARS);
    const warnings: string[] = [];

    const outlineResponse = await chatJson(
      [
        { role: 'system', content: this.outlineSystemPrompt() },
        { role: 'user', content: this.outlineUserPrompt(source, content) },
      ],
      { maxTokens: Math.min(SLIDES_MAX_TOKENS, 2000), temperature: 0.3 },
    );
    const outline = this.parseOutline(outlineResponse.content);
    const model = outlineResponse.model;
    let promptTokens = outlineResponse.usage?.promptTokens ?? 0;
    let completionTokens = outlineResponse.usage?.completionTokens ?? 0;

    const expanded: SlideJson[] = [];
    for (let start = 0; start < outline.slides.length; start += SLIDES_EXPAND_BATCH) {
      const batch = outline.slides.slice(start, start + SLIDES_EXPAND_BATCH);
      try {
        const expandResponse = await chatJson(
          [
            { role: 'system', content: this.expandSystemPrompt() },
            {
              role: 'user',
              content: this.expandUserPrompt(source, content, batch),
            },
          ],
          { maxTokens: SLIDES_MAX_TOKENS, temperature: 0.4 },
        );
        promptTokens += expandResponse.usage?.promptTokens ?? 0;
        completionTokens += expandResponse.usage?.completionTokens ?? 0;
        const parsed = extractSlidesFromModelJson(parseJsonLoose(expandResponse.content));
        const slides = validateSlides(parsed, SLIDES_LIMITS);
        expanded.push(...slides);
      } catch (error) {
        // 局部降级：这一批用大纲骨架兜底，不整份失败（成本已经花了，能救回的救回）
        warnings.push(
          `第 ${start + 1}–${start + batch.length} 页扩写失败，已用大纲兜底：${(error as Error).message}`,
        );
        batch.forEach((item, offset) => {
          try {
            expanded.push(
              validateSlides(
                [
                  {
                    layout: item.layout,
                    title: item.title,
                    bullets: item.bullets,
                  },
                ],
                { ...SLIDES_LIMITS, maxSlides: 1 },
              )[0],
            );
          } catch {
            warnings.push(`第 ${start + offset + 1} 页大纲本身不合法，已跳过`);
          }
        });
      }
    }

    const slides = normalizeSlides(trimToLimit(expanded, SLIDES_LIMITS.maxSlides), SLIDES_LIMITS);
    return {
      deckTitle: outline.deckTitle || source.chapterTitle,
      slides,
      model,
      tokens: { promptTokens, completionTokens },
      warnings,
    };
  }

  private outlineSystemPrompt(): string {
    return [
      '你是教学课件设计助手，为大学课程章节设计在线演示（reveal.js）大纲。',
      '只输出一个 JSON 对象，不要任何解释文字。JSON 结构：',
      '{"deckTitle": string, "slides": [{"layout": string, "title": string, "bullets": string[]}]}',
      `layout 只能取：${LAYOUT_HINT}。`,
      '规则：',
      `1) 第 1 页 layout=cover（标题用章节名）；第 2 页 layout=section 作本章脉络；最后一页 layout=end。`,
      `2) 中间页以 bullets 为主，每页 3–6 条要点；涉及对比用 two-col，示例代码用 code，关键结论用 quote。`,
      '2b) 不要生成 image 页（没有可用的图片素材，需要插图由教师自己加）。',
      `3) 总页数不超过 ${SLIDES_LIMITS.maxSlides} 页（含首尾）。`,
      '4) 全部用中文；标题不超过 20 字；bullets 每条不超过 40 字，不要出现 Markdown 标记。',
    ].join('\n');
  }

  private outlineUserPrompt(source: DeckSource, content: string): string {
    return [
      `课程：${source.courseTitle}`,
      `章节：${source.chapterTitle}`,
      '',
      '章节正文（Markdown）：',
      '"""',
      content,
      '"""',
      '',
      '请按上述规则输出 JSON 大纲。',
    ].join('\n');
  }

  private expandSystemPrompt(): string {
    return [
      '你是教学课件设计助手。给定若干页大纲，请把它们补全为可直接放映的幻灯片内容。',
      '只输出一个 JSON 对象，不要任何解释文字。JSON 结构：',
      '{"slides": [{"layout": string, "title": string, "bullets": string[], "left": string, "right": string,',
      '  "code": {"lang": string, "content": string}, "quote": {"text": string, "cite": string}, "notes": string}]}',
      '规则：',
      '1) 必须保持每页的 layout 与 title 不变，顺序也不能变。',
      '2) bullets 页给 3–6 条要点，每条不超过 40 字，用陈述句；two-col 页用 left/right 两段纯文本。',
      '3) code 页给出完整可读的代码（content 里不要带 ``` 围栏）。',
      '4) 每页都要有 notes：写给教师的讲稿提示，1–3 句，不超过 100 字。',
      '5) 全部用中文；输出里不要出现 Markdown 标记（#、*、`）。',
    ].join('\n');
  }

  private expandUserPrompt(
    source: DeckSource,
    content: string,
    batch: OutlineSlide[],
  ): string {
    return [
      `课程：${source.courseTitle}`,
      `章节：${source.chapterTitle}`,
      '',
      '本章正文（供扩写取材）：',
      '"""',
      content,
      '"""',
      '',
      '需要补全的页大纲（JSON）：',
      JSON.stringify({ slides: batch }, null, 2),
      '',
      '请输出补全后的 JSON。',
    ].join('\n');
  }

  private parseOutline(content: string): OutlineResult {
    const parsed = parseJsonLoose(content) as Partial<OutlineResult>;
    const rawSlides = extractSlidesFromModelJson(parsed);
    if (!Array.isArray(rawSlides) || !rawSlides.length) {
      throw new Error('模型没有给出有效的幻灯片大纲');
    }
    const slides = rawSlides.slice(0, SLIDES_LIMITS.maxSlides).map((raw) => {
      const item = (raw ?? {}) as OutlineSlide;
      return {
        layout: typeof item.layout === 'string' ? item.layout : 'bullets',
        title: typeof item.title === 'string' ? item.title : undefined,
        bullets: Array.isArray(item.bullets)
          ? item.bullets.filter((b): b is string => typeof b === 'string')
          : undefined,
      };
    });
    return {
      deckTitle:
        typeof parsed.deckTitle === 'string' && parsed.deckTitle.trim()
          ? parsed.deckTitle.trim()
          : '',
      slides,
    };
  }
}

export function createDeckGenerator(mode: SlidesGeneratorMode): DeckGenerator {
  return mode === 'llm' ? new LlmDeckGenerator() : new MockDeckGenerator();
}
