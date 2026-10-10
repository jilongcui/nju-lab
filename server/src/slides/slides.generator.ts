import {
  SlideJson,
  SlideStat,
  extractSlidesFromModelJson,
  newSlideId,
  normalizeSlides,
  validateSlide,
  validateSlides,
  DeckSlide,
} from './deck.schema';
import {
  isRecord,
  parseLooseJson,
  SEMANTIC_EXPAND_SYSTEM,
  SEMANTIC_OUTLINE_SYSTEM,
  validateSemanticPages,
  type SemanticPage,
} from './semantic.schema';
import { chatJson, parseJsonLoose } from './llm.client';
import {
  SLIDES_BULLET_MAX_CHARS,
  SLIDES_EXPAND_BATCH,
  SLIDES_EXPAND_MODEL,
  SLIDES_LIMITS,
  SLIDES_MAX_TOKENS,
  SLIDES_OUTLINE_MODEL,
  SLIDES_SECTION_TEASER_MAX,
  SLIDES_SEMANTIC,
  SLIDES_SOURCE_MAX_CHARS,
  SLIDES_TITLE_MAX_CHARS,
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
  /** 章节正文里出现的平台图片（`![cap](file:<id>)`），LLM 配图的唯一合法来源 */
  availableImages?: { fileId: string; caption?: string }[];
}

/** 从章节正文提取可用的平台图片引用（去重，首次出现为准）；没有则返回空数组 = 不配图 */
export function extractChapterImages(
  content: string,
): { fileId: string; caption?: string }[] {
  const seen = new Set<string>();
  const images: { fileId: string; caption?: string }[] = [];
  const re = /!\[([^\]]*)\]\((file:[0-9a-fA-F-]{36})\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    if (seen.has(match[2])) continue;
    seen.add(match[2]);
    images.push({ fileId: match[2], caption: match[1] || undefined });
  }
  return images;
}

export interface GenerateOutcome {
  deckTitle: string;
  slides: DeckSlide[];
  model: string | null;
  tokens: { promptTokens: number; completionTokens: number } | null;
  /** 局部降级等非致命问题，随结果一起返回给教师看 */
  warnings: string[];
}

export interface DeckGenerator {
  readonly mode: SlidesGeneratorMode;
  generate(source: DeckSource): Promise<GenerateOutcome>;
  /** 单批扩写（整份生成按批调用；「单页重生成」传 1 页）：页码从 startIndex 起算（0 基） */
  expandBatch(source: DeckSource, batch: OutlineSlide[], startIndex?: number): Promise<ExpandBatchResult>;
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

// ---------------------------------------------------------------- LLM 产出的程序化质检

/** 只有这些页型参与「跨页重复」判定：cover/section/end 的重复是结构性的（脉络列分节标题是设计） */
const DEDUPABLE_LAYOUTS = new Set(['bullets', 'two-col', 'quote']);

/** 大纲骨架兜不住、需降级为 bullets 的版式：结构化字段（compare/stat）与图片引用在大纲阶段都没有数据 */
const SKELETON_DEGRADE_LAYOUTS = new Set([
  'compare',
  'stat',
  'image',
  'image-full',
  'image-left',
  'image-right',
  'image-grid',
]);

function normalizeForDup(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 中文友好的相似度：字符 bigram 的 Jaccard（整词切分对中文不可靠） */
function bigrams(text: string): Set<string> {
  const t = normalizeForDup(text);
  const grams = new Set<string>();
  if (t.length === 1) grams.add(t);
  for (let i = 0; i < t.length - 1; i++) grams.add(t.slice(i, i + 2));
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * LLM 产出的后置质检（prompt 是"建议"，这里是"闸"）：
 *   1) 标题 / 要点长度硬截断（对齐 prompt 的密度约定；教师手工编辑不走这里，不受此限）
 *   2) 页内重复要点去重
 *   3) 跨页重复合并：标题高相似的内容页合并到先出现的那页（实测 LLM 会同标题连出两页）
 *   4) 分节页眉题强制顺序编号「第 N 节」（结构信息，不靠模型自觉）
 * 所有动作都记 warning 给教师看，不静默改。
 */
export function postProcessSlides(slides: SlideJson[], warnings: string[]): SlideJson[] {
  let truncatedTitles = 0;
  let truncatedBullets = 0;
  let droppedDupBullets = 0;

  for (const slide of slides) {
    if (slide.title && slide.title.length > SLIDES_TITLE_MAX_CHARS) {
      slide.title = slide.title.slice(0, SLIDES_TITLE_MAX_CHARS);
      truncatedTitles++;
    }
    if (slide.bullets?.length) {
      const seen = new Set<string>();
      const kept: string[] = [];
      for (const raw of slide.bullets) {
        let bullet = raw;
        if (bullet.length > SLIDES_BULLET_MAX_CHARS) {
          bullet = `${bullet.slice(0, SLIDES_BULLET_MAX_CHARS)}…`;
          truncatedBullets++;
        }
        const key = normalizeForDup(bullet);
        if (!key || seen.has(key)) {
          droppedDupBullets++;
          continue;
        }
        seen.add(key);
        kept.push(bullet);
      }
      // 要点全被去重掉时至少留一条兜底：空要点页会在最终校验里被判"没有内容"而整份失败
      slide.bullets = kept.length ? kept : [slide.bullets[0]];
    }
  }

  const removed = new Set<number>();
  const titleKeys = slides.map((slide) => bigrams(slide.title ?? ''));
  for (let i = 0; i < slides.length; i++) {
    if (removed.has(i) || !DEDUPABLE_LAYOUTS.has(slides[i].layout) || !slides[i].title) continue;
    for (let j = i + 1; j < slides.length; j++) {
      if (removed.has(j) || !DEDUPABLE_LAYOUTS.has(slides[j].layout) || !slides[j].title) continue;
      if (jaccard(titleKeys[i], titleKeys[j]) < 0.7) continue;
      const existing = new Set((slides[i].bullets ?? []).map(normalizeForDup));
      const incoming = (slides[j].bullets ?? []).filter((b) => !existing.has(normalizeForDup(b)));
      const merged = [...(slides[i].bullets ?? []), ...incoming].slice(0, SLIDES_LIMITS.maxBullets);
      slides[i].bullets = merged.length ? merged : slides[i].bullets;
      removed.add(j);
      warnings.push(`第 ${j + 1} 页与第 ${i + 1} 页标题近乎重复（「${slides[j].title}」），已合并`);
    }
  }

  if (truncatedTitles) warnings.push(`${truncatedTitles} 个标题超过 ${SLIDES_TITLE_MAX_CHARS} 字，已截断`);
  if (truncatedBullets)
    warnings.push(`${truncatedBullets} 条要点超过 ${SLIDES_BULLET_MAX_CHARS} 字，已截断`);
  if (droppedDupBullets) warnings.push(`删除 ${droppedDupBullets} 条重复要点`);

  const kept = slides.filter((_, index) => !removed.has(index));

  // 分节页眉题按顺序强制编号：「第 N 节」是结构信息（大纲规则本就如此要求），
  // 交给模型编号实测会断档（骨架页丢 kicker、模型自编号重复），合并去重后统一重排
  let sectionNo = 0;
  let renumbered = 0;
  for (const slide of kept) {
    if (slide.layout !== 'section') continue;
    sectionNo += 1;
    const wanted = `第 ${sectionNo} 节`;
    if (slide.kicker !== wanted) {
      slide.kicker = wanted;
      renumbered += 1;
    }
  }
  if (renumbered) warnings.push(`${renumbered} 个分节页的眉题已按顺序统一为「第 N 节」`);

  return kept;
}

// ---------------------------------------------------------------- mock

/**
 * 确定性 mock：直接按章节正文的二级标题分节，产出「封面 → 目录 → 各节 → 结尾」。
 * 不调用任何外部服务，用于开发、测试与演示（也是 mock 模式下的端到端验证路径）。
 * 覆盖全部版式（agenda/steps/stat/compare…）：它是版式回归的**零成本**路径 —— 改渲染层后用它出图即可。
 */

// ---------------------------------------------------------------- mock 的语义版

/**
 * mock 生成器的语义产出：**覆盖全部 intent**（新版式回归的零成本路径，
 * 与 `docs/SLIDES.md` 里"mock 同步产出全部版式"的既有约定同思路）。
 */
function mockSemanticPages(source: DeckSource): SemanticPage[] {
  const course = source.courseTitle || '课程名称';
  const chapter = source.chapterTitle || '本章标题';
  return [
    {
      intent: 'cover',
      kicker: course,
      title: chapter,
      subtitle: 'mock 生成器产出的语义 deck：零 token、覆盖全部版式，用于开发与回归。',
      blocks: [{ kind: 'evidence', items: ['语义模型', '零 token', '覆盖全部版式'] }],
      notes: '这是 mock 生成器的封面页口播。',
    },
    {
      intent: 'toc',
      kicker: '本章脉络',
      title: '四个部分',
      blocks: [
        {
          kind: 'sequence',
          items: [{ title: '背景与问题' }, { title: '方法与实现' }, { title: '数据与结果' }, { title: '小结与延伸' }],
        },
      ],
    },
    {
      intent: 'section',
      number: '01',
      kicker: '第一部分',
      title: '背景与问题',
      lede: '这一节的 mock 说明：分节页用大编号 + 一句话交代本节要讲清什么。',
      blocks: [{ kind: 'evidence', items: ['为什么要做', '现在卡在哪', '本章要解决什么'] }],
    },
    {
      intent: 'claim',
      kicker: '核心论断',
      title: '一页只讲一件事',
      blocks: [
        { kind: 'claim', text: '把「讲什么」和「怎么排版」分开，两件事都会做得更好。' },
        {
          kind: 'evidence',
          items: ['内容只表达意图与要点', '版式由渲染层按意图映射', '换主题、换版式都不需要重新生成'],
        },
      ],
      notes: 'mock 讲稿：这一页强调内容与版式解耦。',
    },
    {
      intent: 'contrast',
      kicker: '对照',
      title: '两种做法的差别',
      blocks: [
        {
          kind: 'compare',
          left: { title: '按版式填字', items: ['先选版式再想内容', '长内容只能缩字号', '版式一换就要重做'], tone: 'accent' },
          right: { title: '按意图表达', items: ['先想清楚这一页要做什么', '内容块决定表现形式', '换主题换版式零成本'], tone: 'up' },
        },
      ],
    },
    {
      intent: 'metric',
      kicker: '关键数字',
      title: '三个数字说明问题',
      lede: 'mock 数据仅用于演示版式，不代表任何真实实验结果。',
      blocks: [
        {
          kind: 'metric',
          items: [
            { value: '0.8', label: '检索命中率', detail: 'mock：recall@3' },
            { value: '0.7', label: '摘要命中率', detail: 'mock' },
            { value: '0.3', label: '滑动窗口命中率', detail: 'mock', tone: 'down' },
          ],
        },
      ],
    },
    {
      intent: 'sequence',
      kicker: '操作步骤',
      title: '四步走完',
      blocks: [
        {
          kind: 'sequence',
          items: [
            { title: '准备素材', desc: '把章节正文整理成输入', tag: '输入' },
            { title: '出页面计划', desc: '先定意图与要点', tag: '大纲' },
            { title: '填充内容块', desc: '按批扩写', tag: '扩写' },
            { title: '换主题与版式', desc: '零 token 调整观感', tag: '发布' },
          ],
        },
      ],
    },
    {
      intent: 'flow',
      kicker: '管线',
      title: '内容在环节间流动',
      blocks: [
        {
          kind: 'flow',
          nodes: [
            { title: '章节正文', desc: 'Markdown 素材' },
            { title: '页面计划', desc: '意图 + 要点' },
            { title: '内容块', desc: '结构化数据', highlight: true },
            { title: '渲染层', desc: '意图 → 版式' },
            { title: '在线放映', desc: '固定画布' },
          ],
        },
      ],
    },
    {
      intent: 'relation',
      kicker: '关系',
      title: '一个中心，三个相关概念',
      blocks: [
        {
          kind: 'relation',
          nodes: [
            { label: '语义页模型', desc: '每页表达一个教学动作', center: true },
            { label: '内容块', desc: '结构化数据，不含图形' },
            { label: '版式组件', desc: '把块画成图与卡' },
            { label: '主题令牌', desc: '决定颜色与字体' },
          ],
        },
      ],
    },
    {
      intent: 'timeline',
      kicker: '演化',
      title: '三个阶段的路线',
      blocks: [
        {
          kind: 'timeline',
          points: [
            { at: '第一阶段', title: '跑通渲染', desc: '固定画布 + 版式系统' },
            { at: '第二阶段', title: '接入平台', desc: '旧 deck 适配 + 默认切换', highlight: true },
            { at: '第三阶段', title: '生成侧改造', desc: '直接产出语义页' },
          ],
        },
      ],
    },
    {
      intent: 'arch',
      kicker: '分层',
      title: '三层结构',
      blocks: [
        {
          kind: 'arch',
          levels: [
            { name: '内容层', cells: [{ title: '意图 intent', desc: '这页要做什么' }, { title: '内容块 blocks', desc: '结构化数据' }] },
            {
              name: '版式层',
              highlight: true,
              cells: [{ title: '版式组件', desc: '关系图 / 管线 / 时间线' }, { title: '网格与卡片', desc: '固定画布标定' }],
            },
            { name: '主题层', cells: [{ title: '设计令牌', desc: '颜色 / 字体 / 圆角' }, { title: '内置主题', desc: '一键换装' }] },
          ],
        },
      ],
    },
    {
      intent: 'table',
      kicker: '数据表',
      title: '对齐的数值用表格',
      blocks: [
        {
          kind: 'table',
          head: ['配置', '指标 A', '指标 B', '结论'],
          align: ['l', 'r', 'r', 'l'],
          rows: [
            ['mock-基准', '0.2761', '2.2074', '基准'],
            ['mock-变体一', '0.4329', '1.7238', '更集中'],
            ['mock-变体二', '0.2103', '3.1066', '更分散'],
          ],
        },
        { kind: 'note', text: '表中数字为 mock 占位，仅用于验证表格版式的对齐与密度。' },
      ],
    },
    {
      intent: 'example',
      kicker: '代码示例',
      title: '代码块也会换主题',
      blocks: [
        {
          kind: 'code',
          lang: 'python',
          content: `def render(page):\n    # 版式由 intent 决定，模型不写 HTML\n    return LAYOUTS[page["intent"]](page)\n`,
          caption: 'mock 代码块：等宽字体与行距都由主题令牌控制。',
        },
      ],
    },
    {
      intent: 'quote',
      kicker: '点睛',
      title: '',
      blocks: [{ kind: 'quote', text: '把不需要的东西拿掉，剩下的才是设计。', cite: 'mock 引用' }],
    },
    {
      intent: 'summary',
      kicker: '小结',
      title: '三句话收尾',
      blocks: [
        {
          kind: 'evidence',
          items: ['内容只表达意图与要点', '版式与主题由渲染层决定', '换主题、换版式都不花 token'],
        },
      ],
      notes: 'mock 讲稿：把三句话和前面每一页对应起来。',
    },
  ];
}

export class MockDeckGenerator implements DeckGenerator {
  readonly mode = 'mock' as const;

  async generate(source: DeckSource): Promise<GenerateOutcome> {
    const { maxSlides, maxBullets, maxChars } = SLIDES_LIMITS;
    const sections = splitSections(source.chapterContent);
    const slides: SlideJson[] = [
      {
        id: newSlideId(),
        layout: 'cover',
        kicker: source.courseTitle,
        title: source.chapterTitle,
        subtitle: '章节在线演示',
        notes: '开场：说明本章在课程中的位置与学习目标。',
      },
    ];

    const outline = sections.map((s) => s.title).filter(Boolean);
    if (outline.length) {
      slides.push({
        id: newSlideId(),
        layout: 'agenda',
        kicker: source.courseTitle,
        title: '本章脉络',
        bullets: toBullets(outline, maxBullets, maxChars),
        notes: '先总览，再逐节展开。',
      });
    }

    // 关键数字页：只收正文里真实出现的数字（mock 不编造数据）
    const numberStats: SlideStat[] = [];
    for (const section of sections) {
      for (const bullet of section.bullets) {
        const match = /(\d[\d.,]*\s*%)/.exec(bullet) ?? /(\d[\d.,]*)/.exec(bullet);
        if (match && numberStats.length < 3) {
          numberStats.push({
            value: match[1].replace(/\s/g, ''),
            label: bullet.slice(0, 24),
          });
        }
      }
    }
    if (numberStats.length) {
      slides.push({
        id: newSlideId(),
        layout: 'stat',
        title: '关键数字',
        stats: numberStats,
        notes: '用数字建立直观感受，再展开细节。',
      });
    }

    let sectionNo = 0;
    for (const section of sections) {
      sectionNo += 1;
      const bullets = toBullets(section.bullets, maxBullets, maxChars);
      const isCompare = /对比|区别|差异|vs/i.test(section.title) && bullets.length >= 2;
      const isSteps = /步骤|流程|过程|如何|怎么/.test(section.title) && bullets.length >= 2;

      if (section.title && sections.length > 1) {
        slides.push({
          id: newSlideId(),
          layout: 'section',
          kicker: `第 ${sectionNo} 节`,
          title: section.title,
          notes: `过渡到「${section.title}」。`,
        });
      }
      if (isCompare) {
        const half = Math.ceil(bullets.length / 2);
        slides.push({
          id: newSlideId(),
          layout: 'compare',
          title: section.title,
          compare: {
            leftTitle: '要点 A',
            rightTitle: '要点 B',
            left: bullets.slice(0, half),
            right: bullets.slice(half),
          },
          notes: '左右对照讲解，突出差异点。',
        });
      } else if (isSteps) {
        slides.push({
          id: newSlideId(),
          layout: 'steps',
          title: section.title,
          bullets,
          notes: '按顺序演示，强调步骤之间的先后依赖。',
        });
      } else if (bullets.length) {
        slides.push({
          id: newSlideId(),
          layout: 'bullets',
          title: section.title || '内容要点',
          bullets,
          notes: section.title ? `讲解「${section.title}」，结合实验任务说明。` : undefined,
        });
      }
      if (section.code) {
        slides.push({
          id: newSlideId(),
          layout: 'code',
          title: section.title || '示例代码',
          code: section.code,
          notes: '演示代码时逐行解释关键调用。',
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

  /** mock 没有 LLM：把传入页原样校验回显（单页重生成在 mock 下等于"内容不变"，保持确定性） */
  async expandBatch(
    _source: DeckSource,
    batch: OutlineSlide[],
    startIndex = 0,
  ): Promise<ExpandBatchResult> {
    const slides: SlideJson[] = [];
    const warnings: string[] = [];
    batch.forEach((item, offset) => {
      try {
        slides.push(validateSlides([{ ...item }], { ...SLIDES_LIMITS, maxSlides: 1 })[0]);
      } catch {
        warnings.push(`第 ${startIndex + offset + 1} 页 mock 回显校验失败，已跳过`);
      }
    });
    return { slides, warnings, promptTokens: 0, completionTokens: 0 };
  }
}

// ---------------------------------------------------------------- llm

/**
 * 大纲形态的单页（扩写管线的输入）：既来自整份生成的大纲阶段，
 * 也可以从现有 deck 抽出来做「单页重生成」—— 两种来源走同一套扩写/校验/兜底。
 */
export interface OutlineSlide {
  /** 旧模型的版式名；语义模式下固定传 'semantic' */
  layout: string;
  /** 语义模式：本页的教学意图（intent） */
  intent?: string;
  kicker?: string;
  title?: string;
  lede?: string;
  /** 本页要让学员记住什么（大纲阶段的"锚"，扩写时回传给模型防漂移；不上屏） */
  keyPoint?: string;
  bullets?: string[];
  /** 语义模式：本页计划要用的块类型 */
  plan?: string[];
}

interface OutlineResult {
  deckTitle: string;
  slides: OutlineSlide[];
}

/** 单批扩写的结果（整份生成按批累加，单页重生成直接用） */
export interface ExpandBatchResult {
  slides: DeckSlide[];
  warnings: string[];
  promptTokens: number;
  completionTokens: number;
}

const LAYOUT_HINT = [
  'cover（封面，仅首页）',
  'section（分节标题页）',
  'agenda（目录/脉络页，编号条目，通常第 2 页）',
  'bullets（要点页，最常用）',
  'steps（有序步骤/流程页）',
  'stat（大数字页，1–4 个关键数字）',
  'compare（左右对比页，两栏带列标题的清单）',
  'two-col（两栏自由文本，compare 不适用时才用）',
  'code（代码页）',
  'quote（引文页）',
  'image（图片页，单图居中）',
  'image-full（全幅大图页，一张图撑满整页）',
  'image-left（左图右文页，图配要点）',
  'image-right（右图左文页，图配要点）',
  'image-grid（多图网格页，2–4 张同类图片并列）',
  'end（结束页，仅末页）',
].join('、');

export class LlmDeckGenerator implements DeckGenerator {
  readonly mode = 'llm' as const;

  async generate(source: DeckSource): Promise<GenerateOutcome> {
    // 语义模式（默认）：mock 也产出 v2，保证开发/回归路径与生产一致
    if (SLIDES_SEMANTIC) {
      return {
        deckTitle: source.chapterTitle || 'mock deck',
        slides: mockSemanticPages(source),
        model: null,
        tokens: null,
        warnings: [],
      };
    }
    const content = truncate(source.chapterContent || '（本章暂无正文）', SLIDES_SOURCE_MAX_CHARS);
    const warnings: string[] = [];
    const availableImages = source.availableImages ?? [];

    // 大纲失败 = 整份失败，所以重试一次（截断/偶发非 JSON 在推理模型上难免）；
    // 预算直接给满：20 页大纲 + 推理开销，2000 token 的旧预算实测会被截断（2026-09-29）
    let outlineResponse: Awaited<ReturnType<typeof chatJson>> | null = null;
    let lastOutlineError: Error | null = null;
    for (let attempt = 0; attempt < 2 && !outlineResponse; attempt++) {
      try {
        const response = await chatJson(
          [
            { role: 'system', content: this.outlineSystemPrompt(availableImages.length) },
            { role: 'user', content: this.outlineUserPrompt(source, content) },
          ],
          {
            maxTokens: SLIDES_MAX_TOKENS,
            temperature: 0.3,
            model: SLIDES_OUTLINE_MODEL || undefined,
          },
        );
        // 先解析再算成功：解析失败同样进重试
        this.parseOutline(response.content);
        outlineResponse = response;
      } catch (error) {
        lastOutlineError = error as Error;
        if (attempt === 0) warnings.push(`大纲首次生成失败（${lastOutlineError.message}），已重试`);
      }
    }
    if (!outlineResponse) throw lastOutlineError ?? new Error('大纲生成失败');

    const outline = this.parseOutline(outlineResponse.content);
    const model = outlineResponse.model;
    let promptTokens = outlineResponse.usage?.promptTokens ?? 0;
    let completionTokens = outlineResponse.usage?.completionTokens ?? 0;

    const expanded: SlideJson[] = [];
    for (let start = 0; start < outline.slides.length; start += SLIDES_EXPAND_BATCH) {
      const batch = outline.slides.slice(start, start + SLIDES_EXPAND_BATCH);
      const result = await this.expandBatch(source, batch, start);
      warnings.push(...result.warnings);
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;
      expanded.push(...(result.slides as SlideJson[]));
    }

    const cleaned = postProcessSlides(expanded, warnings);
    const slides = normalizeSlides(trimToLimit(cleaned, SLIDES_LIMITS.maxSlides), SLIDES_LIMITS);
    return {
      deckTitle: outline.deckTitle || source.chapterTitle,
      slides,
      model,
      tokens: { promptTokens, completionTokens },
      warnings,
    };
  }

  /**
   * 单批扩写 —— 整份生成（按 4 页/批）与「单页重生成」（1 页/批）共用的管线：
   * 一次重试、逐页校验、降级挽救（空占位/缺结构化字段 → 要点页）、大纲骨架兜底。
   * `startIndex` 是这批页在整份 deck 里的起始页码（只用于 warning 里的「第 N 页」）。
   */
  async expandBatch(
    source: DeckSource,
    batch: OutlineSlide[],
    startIndex = 0,
  ): Promise<ExpandBatchResult> {
    const content = truncate(source.chapterContent || '（本章暂无正文）', SLIDES_SOURCE_MAX_CHARS);
    const warnings: string[] = [];
    const availableImages = source.availableImages ?? [];
    /** 防幻觉闸：模型只能引用清单内的 fileId，清单为空 = 不允许任何图片页 */
    const allowedImageRefs = new Set(availableImages.map((img) => img.fileId));
    let promptTokens = 0;
    let completionTokens = 0;

    // 扩写失败/截断都允许重试一次（实测约 1/20 的批会碰到），取两次里页数多的那份
    let batchSlides: SlideJson[] = [];
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2 && batchSlides.length < batch.length; attempt++) {
      try {
        const expandResponse = await chatJson(
          [
            { role: 'system', content: this.expandSystemPrompt(availableImages.length) },
            {
              role: 'user',
              content: this.expandUserPrompt(source, content, batch),
            },
          ],
          {
            maxTokens: SLIDES_MAX_TOKENS,
            temperature: 0.4,
            model: SLIDES_EXPAND_MODEL || undefined,
          },
        );
        promptTokens += expandResponse.usage?.promptTokens ?? 0;
        completionTokens += expandResponse.usage?.completionTokens ?? 0;
        const parsed = extractSlidesFromModelJson(parseJsonLoose(expandResponse.content));
        const parsedArr = Array.isArray(parsed) ? parsed : [];
        // 逐页校验：单页不合法只丢那一页（用大纲兜底），不拖垮整批
        const slides: SlideJson[] = [];
        for (let i = 0; i < Math.min(parsedArr.length, batch.length); i++) {
          try {
            const slide = validateSlide(parsedArr[i], startIndex + i, SLIDES_LIMITS);
            this.assertImagesFromSource(slide, allowedImageRefs);
            slides.push(this.capSectionTeaser(slide, startIndex + i + 1, warnings));
          } catch (pageError) {
            // 先尝试降级挽救：模型常见失误是只漏了 compare/stat/image 结构化字段（或给了空
            // 占位），但 bullets/notes 其实写好了 —— 直接丢整页太亏，降级为要点页保住成稿
            const degraded = this.degradeExpandedToBullets(parsedArr[i], startIndex + i);
            if (degraded) {
              warnings.push(
                `第 ${startIndex + i + 1} 页扩写产物不合法（${(pageError as Error).message}），已降级为要点页`,
              );
              slides.push(this.capSectionTeaser(degraded, startIndex + i + 1, warnings));
              continue;
            }
            warnings.push(
              `第 ${startIndex + i + 1} 页扩写产物不合法（${(pageError as Error).message}），已用大纲兜底`,
            );
            const skeleton = this.outlineSkeleton(batch[i]);
            if (skeleton) slides.push(this.capSectionTeaser(skeleton, startIndex + i + 1, warnings));
            else warnings.push(`第 ${startIndex + i + 1} 页大纲本身不合法，已跳过`);
          }
        }
        if (slides.length > batchSlides.length) batchSlides = slides;
      } catch (error) {
        lastError = error as Error;
      }
    }
    // 缺页补齐：重试后仍不够时，缺的页用大纲骨架兜底（不整批丢）
    if (batchSlides.length < batch.length) {
      if (batchSlides.length > 0) {
        warnings.push(
          `第 ${startIndex + 1}–${startIndex + batch.length} 页只扩写出 ${batchSlides.length} 页，其余用大纲兜底`,
        );
      } else {
        warnings.push(
          `第 ${startIndex + 1}–${startIndex + batch.length} 页扩写失败（重试仍未成功），已用大纲兜底：${lastError?.message ?? '未知错误'}`,
        );
      }
      for (let offset = batchSlides.length; offset < batch.length; offset++) {
        const skeleton = this.outlineSkeleton(batch[offset]);
        if (skeleton) batchSlides.push(this.capSectionTeaser(skeleton, startIndex + offset + 1, warnings));
        else warnings.push(`第 ${startIndex + offset + 1} 页大纲本身不合法，已跳过`);
      }
    }
    // 只取与大纲对齐的前 N 页（模型多吐的页不要，防止页序漂移）
    return {
      slides: batchSlides.slice(0, batch.length),
      warnings,
      promptTokens,
      completionTokens,
    };
  }

  /**
   * 分节页导览条数硬闸（SLIDES_SECTION_TEASER_MAX，默认 3）：prompt v8 约定 2–3 条，
   * 但条数不靠模型自觉 —— 单页重生成只有一页上下文，扩写模型容易多写（实测写出 4 条）。
   */
  private capSectionTeaser(slide: SlideJson, pageNo: number, warnings: string[]): SlideJson {
    if (slide.layout === 'section' && (slide.bullets?.length ?? 0) > SLIDES_SECTION_TEASER_MAX) {
      slide.bullets = slide.bullets!.slice(0, SLIDES_SECTION_TEASER_MAX);
      warnings.push(`第 ${pageNo} 页分节导览超过 ${SLIDES_SECTION_TEASER_MAX} 条，已保留前 ${SLIDES_SECTION_TEASER_MAX} 条`);
    }
    return slide;
  }

  /**
   * 防幻觉闸：图片版式的 url 必须来自正文提取的可用清单（教师手工插图不经过生成器，不受此限）。
   * 不合法就抛错 —— 走既有「丢该页、大纲骨架兜底」路径，比留一张编造的图好。
   */
  private assertImagesFromSource(slide: SlideJson, allowed: Set<string>): void {
    const urls = [
      slide.image?.url,
      ...(slide.images ?? []).map((img) => img.url),
    ].filter((url): url is string => !!url);
    for (const url of urls) {
      if (!allowed.has(url)) {
        throw new Error(`图片引用不在正文可用清单内（${url}）`);
      }
    }
  }

  private outlineSystemPrompt(imageCount: number): string {
    return [
      '你是教学课件设计助手，为大学课程章节设计在线演示（reveal.js）大纲。',
      '只输出一个 JSON 对象，不要任何解释文字。JSON 结构：',
      '{"deckTitle": string, "slides": [{"layout": string, "kicker": string, "title": string, "keyPoint": string, "bullets": string[]}]}',
      `layout 只能取：${LAYOUT_HINT}。`,
      '',
      '【页面结构】',
      '1) 第 1 页必须 layout=cover（title 用章节名，kicker 用课程名）；第 2 页 layout=agenda 作「本章脉络」（bullets 列出各分节标题）；最后一页必须 layout=end 作小结——首尾页都不可省略。',
      '2) 先通读正文，把必须讲清的知识点梳理成 2–4 个分节；每个分节用一页 layout=section 作分隔（kicker 用「第 N 节」），其下跟 1–3 页内容页；短章（分节只有 1–2 个）可省略分节页，把页数让给内容页。',
      '3) 内容页按内容选型：一般要点用 bullets；有先后顺序的过程/操作步骤用 steps；正文里有 1–4 个有说服力的关键数字时用 stat；成对对比的概念用 compare；示例代码用 code；画龙点睛的结论用 quote。版式要多样，不要清一色 bullets。',
      imageCount > 0
        ? `4) 正文里有 ${imageCount} 张可用插图（清单在用户消息里）。某页内容正好在讲解某张图时，为该页选 image / image-full / image-left / image-right / image-grid 版式：单图配要点用 image-left/image-right，一张图讲透一件事用 image 或 image-full，2–4 张同类图并列用 image-grid。一份 deck 图片页总数不超过 3 页，不为配图硬凑页；与图无关的页仍按规则 3 选型。`
        : '4) 不要生成 image 页（没有可用的图片素材，需要插图由教师自己加）。',
      `5) 总页数不超过 ${SLIDES_LIMITS.maxSlides} 页（含首尾）。`,
      '',
      '【信息密度——必须严格遵守】',
      '6) 内容页 bullets 每页 3–5 条，每条不超过 20 字；用关键词或短语的「电报体」，禁止照抄正文整句。cover 封面不必给 bullets；section 分节页给 2–3 条本节导览要点（纯关键词、每条不超过 12 字，点名本节要讲的主题词）。',
      '7) 每页只讲一件事：keyPoint 用一句话写清「本页要让学员记住什么」（不超过 40 字；它只给后续扩写看，不上屏）。',
      '',
      '【覆盖与去重】',
      '8) 分节与页面合起来必须覆盖正文的核心知识点，不遗漏；每个知识点只讲一次。',
      '9) 页标题与要点在整份大纲里不得重复；前后页不得换个说法讲同一件事。',
      '',
      '10) 全部用中文；标题不超过 18 字；kicker 不超过 12 字；文字里不要出现 Markdown 标记（#、*、`）。',
    ].join('\n');
  }

  private outlineUserPrompt(source: DeckSource, content: string): string {
    const lines = [
      `课程：${source.courseTitle}`,
      `章节：${source.chapterTitle}`,
      '',
      '章节正文（Markdown）：',
      '"""',
      content,
      '"""',
    ];
    const images = source.availableImages ?? [];
    if (images.length) {
      lines.push(
        '',
        '可用插图清单（fileId 与正文里的图注；图片版式只能从这里选）：',
        ...images.map(
          (img, index) => `${index + 1}. ${img.fileId}${img.caption ? `（${img.caption}）` : ''}`,
        ),
      );
    }
    lines.push('', '请按上述规则输出 JSON 大纲。');
    return lines.join('\n');
  }

  private expandSystemPrompt(imageCount: number): string {
    return [
      '你是教学课件设计助手。给定若干页大纲，请把它们补全为可直接放映的幻灯片内容。',
      '只输出一个 JSON 对象，不要任何解释文字。JSON 结构：',
      '{"slides": [{"layout": string, "kicker": string, "title": string, "bullets": string[],',
      '  "stats": [{"value": string, "label": string, "detail": string}],',
      '  "compare": {"leftTitle": string, "rightTitle": string, "left": string[], "right": string[]},',
      '  "left": string, "right": string, "code": {"lang": string, "content": string},',
      imageCount > 0
        ? '  "image": {"url": string, "caption": string}, "images": [{"url": string, "caption": string}],'
        : '',
      '  "quote": {"text": string, "cite": string}, "notes": string}]}',
      '规则：',
      '1) 必须保持每页的 layout、kicker 与 title 不变，顺序也不能变；每页只讲清大纲里它自己的 keyPoint，不要贪多。只输出本页 layout 需要的字段：与本页版式无关的结构化字段（compare/stats/image/images/quote/code/left/right）一律不要写，禁止用 null、空数组或空对象占位。',
      '2) bullets 页给 3–5 条要点，每条不超过 20 字：关键词/短语式的电报体，禁止照抄正文整句；可用「关键词：半句短补充」的形态。',
      '3) steps 页给 3–6 步，按先后顺序，每步不超过 20 字。',
      '4) stat 页给 1–4 个大数字：value 必须是**正文里真实出现的数字**（不超过 8 字，禁止编造），label 不超过 12 字，detail 可选。',
      '5) compare 页左右两栏各 2–5 条、每条不超过 20 字，列标题不超过 8 字，两栏要有可比性；',
      '   compare 的 JSON 形如 {"leftTitle": "旧方法", "rightTitle": "新方法", "left": ["慢", "易错"], "right": ["快", "可靠"]}，left/right 必须是字符串数组、不得为空。',
      '6) two-col 页用 left/right 两段对照文字（每段不超过 120 字，可用短句换行）；code 页给完整可读的代码（content 里不要带 ``` 围栏，不超过 20 行）；quote 页放一句关键结论（不超过 60 字）。',
      '7) cover 与 section 是仪式型页面：cover 不写 bullets（封面=标题+副标题）；section 分节页给 2–3 条「本节导览」要点——**纯关键词或短语的电报体，每条不超过 12 字**，不要「关键词：补充说明」的冒号结构，就是一行一个主题词（如「监督学习」「无监督学习」「半监督学习」）；要点必须真正点名本节要讲的东西，不照抄 keyPoint 的空话；这类页的承接与过渡仍全部写进 notes。agenda 页的编号条目照大纲保留（它就是目录本身），end 页给 2–4 条小结要点。',
      '8) 每页都要有 notes —— 写给教师的**讲稿**：口语化、3–6 句、可以照读；开头一句承接上文，结尾一句自然过渡到下一页；讲稿信息量要比页面文字大（页面是骨架，讲稿是血肉）。',
      '9) 不得重复其他页已经讲过的内容。',
      '10) 全部用中文；页面文字里不要出现 Markdown 标记（#、*、`）。',
      ...(imageCount > 0
        ? [
            '11) image / image-full / image-left / image-right 页：把 image.url 设为可用插图清单里**最贴合本页内容**的那个 fileId（照抄清单原文，禁止编造、禁止改写一个字符），caption 不超过 12 字；image-grid 页用 images 数组放 2–4 张同主题图片。image-left / image-right 页还要给 3–4 条 bullets 要点。',
          ]
        : []),
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private expandUserPrompt(
    source: DeckSource,
    content: string,
    batch: OutlineSlide[],
  ): string {
    const lines = [
      `课程：${source.courseTitle}`,
      `章节：${source.chapterTitle}`,
      '',
      '本章正文（供扩写取材）：',
      '"""',
      content,
      '"""',
    ];
    const images = source.availableImages ?? [];
    if (images.length) {
      lines.push(
        '',
        '可用插图清单（image.url / images.url 只能照抄这里的 fileId）：',
        ...images.map(
          (img, index) => `${index + 1}. ${img.fileId}${img.caption ? `（${img.caption}）` : ''}`,
        ),
      );
    }
    lines.push(
      '',
      '需要补全的页大纲（JSON）：',
      JSON.stringify({ slides: batch }, null, 2),
      '',
      '请输出补全后的 JSON。',
    );
    return lines.join('\n');
  }

  /**
   * 扩写产物的降级挽救：强制改成 bullets 版式、摘掉全部结构化字段后重新校验。
   * 能救回的是「要点与讲稿都写好了、只是结构化字段缺失/为空」的页（2026-09-30 实测：
   * image-left 页 image 给 null、compare 页两栏空但 bullets 齐全）；连要点都没有的页救不回，返回 null。
   */
  private degradeExpandedToBullets(raw: unknown, index: number): SlideJson | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const clone: Record<string, unknown> = { ...(raw as Record<string, unknown>), layout: 'bullets' };
    for (const key of ['compare', 'stats', 'image', 'images', 'quote', 'code', 'left', 'right']) {
      delete clone[key];
    }
    try {
      const slide = validateSlide(clone, index, SLIDES_LIMITS);
      return slide.bullets?.length ? slide : null;
    } catch {
      return null;
    }
  }

  /**
   * 大纲骨架兜底页：compare/stat 这类需要结构化字段的版式在大纲里没有数据，
   * 图片系版式在大纲里没有 fileId，兜底时一律降级为 bullets 页（要点还在，比整页丢失好）。
   * cover 封面不带要点（标题+副标题即全部）；section 保留大纲要点（它就是"本节导览"的素材），
   * kicker 按大纲保留（如「第 N 节」）。
   */
  private outlineSkeleton(item: OutlineSlide): SlideJson | null {
    const layout = SKELETON_DEGRADE_LAYOUTS.has(item.layout) ? 'bullets' : item.layout;
    try {
      return validateSlides(
        [
          {
            layout,
            kicker: item.kicker,
            title: item.title,
            bullets: layout === 'cover' ? undefined : item.bullets,
          },
        ],
        { ...SLIDES_LIMITS, maxSlides: 1 },
      )[0];
    } catch {
      return null;
    }
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
        kicker: typeof item.kicker === 'string' ? item.kicker : undefined,
        title: typeof item.title === 'string' ? item.title : undefined,
        keyPoint: typeof item.keyPoint === 'string' ? item.keyPoint : undefined,
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


// ---------------------------------------------------------------- 语义生成器（v2，默认）

/**
 * 语义模式的 LLM 生成器：两阶段与旧路径一致（先大纲、再分批扩写），
 * 但产出的是 `intent + blocks`（见 semantic.schema.ts），版式交给渲染层映射。
 *
 * 与旧路径的差别只在三处：
 *   1) prompt 换成"意图 + 内容块"（能表达关系图/管线/时间线，不再只能选 16 个格子）；
 *   2) 归一化走 `validateSemanticPages`（页数/块级预算/intent 白名单，非法块丢弃并记 warning）；
 *   3) 批内缺页用**计划骨架**兜底（页数、页序永不漂移）。
 */
export class SemanticLlmDeckGenerator implements DeckGenerator {
  readonly mode: SlidesGeneratorMode = 'llm';

  async generate(source: DeckSource): Promise<GenerateOutcome> {
    const content = truncate(source.chapterContent || '（本章暂无正文）', SLIDES_SOURCE_MAX_CHARS);
    const warnings: string[] = [];

    // 阶段一：页面计划（失败 = 整份失败，重试一次；与旧路径同口径）
    let outlineResponse: Awaited<ReturnType<typeof chatJson>> | null = null;
    let lastOutlineError: Error | null = null;
    for (let attempt = 0; attempt < 2 && !outlineResponse; attempt++) {
      try {
        const response = await chatJson(
          [
            { role: 'system', content: SEMANTIC_OUTLINE_SYSTEM },
            { role: 'user', content: this.outlineUserPrompt(source, content) },
          ],
          { maxTokens: SLIDES_MAX_TOKENS, temperature: 0.3, model: SLIDES_OUTLINE_MODEL || undefined },
        );
        this.parseOutline(response.content); // 先解析再算成功
        outlineResponse = response;
      } catch (error) {
        lastOutlineError = error as Error;
        if (attempt === 0) warnings.push(`大纲首次生成失败（${lastOutlineError.message}），已重试`);
      }
    }
    if (!outlineResponse) throw lastOutlineError ?? new Error('大纲生成失败');

    const outline = this.parseOutline(outlineResponse.content);
    const planCount = outline.slides.length;
    let promptTokens = outlineResponse.usage?.promptTokens ?? 0;
    let completionTokens = outlineResponse.usage?.completionTokens ?? 0;
    if (planCount > SLIDES_LIMITS.maxSlides) {
      warnings.push(`大纲给出 ${planCount} 页，超过上限 ${SLIDES_LIMITS.maxSlides}，已截断`);
    }
    const plan = outline.slides.slice(0, SLIDES_LIMITS.maxSlides);

    // 阶段二：分批扩写（批内缺页用计划骨架兜底）
    const pages: SemanticPage[] = [];
    for (let start = 0; start < plan.length; start += SLIDES_EXPAND_BATCH) {
      const batch = plan.slice(start, start + SLIDES_EXPAND_BATCH);
      const result = await this.expandBatch(source, batch, start);
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;
      warnings.push(...result.warnings);
      pages.push(...(result.slides as SemanticPage[]));
    }

    const { pages: validated, warnings: schemaWarnings } = validateSemanticPages(pages, {
      maxPages: SLIDES_LIMITS.maxSlides,
      maxNotes: SLIDES_LIMITS.maxNotes,
    });
    warnings.push(...schemaWarnings);

    return {
      deckTitle: outline.deckTitle || source.chapterTitle,
      slides: validated,
      model: outlineResponse.model,
      tokens: { promptTokens, completionTokens },
      warnings,
    };
  }

  /** 单批扩写（整份生成按批调用；「重生成当前页」传 1 页） */
  async expandBatch(source: DeckSource, batch: OutlineSlide[], startIndex = 0): Promise<ExpandBatchResult> {
    const content = truncate(source.chapterContent || '（本章暂无正文）', SLIDES_SOURCE_MAX_CHARS);
    const warnings: string[] = [];
    const plan = batch.map((item) => ({
      intent: item.intent ?? 'claim',
      kicker: item.kicker ?? '',
      title: item.title ?? '',
      lede: item.lede ?? '',
      keyPoint: item.keyPoint ?? '',
      plan: item.plan ?? [],
    }));

    let promptTokens = 0;
    let completionTokens = 0;
    let got: unknown[] = [];
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2 && got.length < plan.length; attempt++) {
      try {
        const response = await chatJson(
          [
            { role: 'system', content: SEMANTIC_EXPAND_SYSTEM },
            { role: 'user', content: this.expandUserPrompt(content, plan) },
          ],
          { maxTokens: SLIDES_MAX_TOKENS, temperature: 0.4, model: SLIDES_EXPAND_MODEL || undefined },
        );
        promptTokens += response.usage?.promptTokens ?? 0;
        completionTokens += response.usage?.completionTokens ?? 0;
        const parsed: unknown = parseLooseJson(response.content);
        const pages = isRecord(parsed) && Array.isArray(parsed.pages) ? (parsed.pages as unknown[]) : [];
        if (pages.length > got.length) got = pages;
      } catch (error) {
        lastError = error as Error;
      }
    }
    if (!got.length) {
      warnings.push(
        `第 ${startIndex + 1}–${startIndex + plan.length} 页扩写失败（${lastError?.message ?? '返回为空'}），已用计划骨架兜底`,
      );
    }

    const pages: SemanticPage[] = plan.map((item, i) => {
      const raw = got[i];
      const record = isRecord(raw) ? raw : null;
      const candidate: Record<string, unknown> = record
        ? {
            ...record,
            intent: item.intent,
            kicker: item.kicker || record.kicker,
            title: item.title || record.title,
          }
        : { intent: item.intent, kicker: item.kicker, title: item.title, lede: item.lede, blocks: [] };
      const { pages: validated, warnings: schemaWarnings } = validateSemanticPages([candidate], {
        maxPages: 1,
        maxNotes: SLIDES_LIMITS.maxNotes,
      });
      warnings.push(...schemaWarnings.map((text) => `第 ${startIndex + i + 1} 页：${text}`));
      if (validated[0]) return validated[0];
      // 兜底：计划骨架（页数/页序永不漂移）
      warnings.push(`第 ${startIndex + i + 1} 页内容缺失，已用计划骨架兜底`);
      return {
        intent: (item.intent as SemanticPage['intent']) ?? 'claim',
        kicker: item.kicker,
        title: item.title,
        blocks: [{ kind: 'evidence', items: item.plan?.length ? item.plan : [item.keyPoint || item.title || ''] }],
      } as SemanticPage;
    });

    return { slides: pages, warnings, promptTokens, completionTokens };
  }

  private outlineUserPrompt(source: DeckSource, content: string): string {
    return [`课程：${source.courseTitle}`, `章节：${source.chapterTitle}`, '', '【章节正文】', content].join('\n');
  }

  private expandUserPrompt(content: string, plan: unknown): string {
    return [
      '【页面计划（必须原样保持 intent/kicker/title，顺序不变）】',
      JSON.stringify(plan),
      '',
      '【章节正文】',
      content,
    ].join('\n');
  }

  private parseOutline(text: string): { deckTitle: string; slides: OutlineSlide[] } {
    const parsed: unknown = parseLooseJson(text);
    if (!isRecord(parsed) || !Array.isArray(parsed.pages) || !parsed.pages.length) {
      throw new Error('大纲 JSON 缺少 pages 数组');
    }
    const slides: OutlineSlide[] = parsed.pages.filter(isRecord).map((item) => ({
      layout: 'semantic',
      intent: typeof item.intent === 'string' ? item.intent : 'claim',
      kicker: typeof item.kicker === 'string' ? item.kicker : undefined,
      title: typeof item.title === 'string' ? item.title : undefined,
      lede: typeof item.lede === 'string' ? item.lede : undefined,
      keyPoint: typeof item.keyPoint === 'string' ? item.keyPoint : undefined,
      plan: Array.isArray(item.plan) ? item.plan.filter((value): value is string => typeof value === 'string') : [],
    }));
    if (!slides.length) throw new Error('大纲 JSON 没有可用的页面');
    return { deckTitle: typeof parsed.deckTitle === 'string' ? parsed.deckTitle : '', slides };
  }
}

export function createDeckGenerator(mode: SlidesGeneratorMode): DeckGenerator {
  if (mode !== 'llm') return new MockDeckGenerator();
  // 默认语义模型（v2）；SLIDES_SEMANTIC=0 回退旧模型
  return SLIDES_SEMANTIC ? new SemanticLlmDeckGenerator() : new LlmDeckGenerator();
}
