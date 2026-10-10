import { randomUUID } from 'crypto';
import type { SemanticPage } from './semantic.schema';

/**
 * deck 内容的**结构与校验**（内容真源就是这套 JSON，见
 * `docs/DESIGN-2026-09-29-chapter-slides.md` §5 / §7）。
 *
 * 为什么手写校验而不用 class-validator：平台只装了 class-validator，它擅长校验 DTO 的平面字段，
 * 而这里要校验的是**深层嵌套的 JSON 数组**（模型产出，形状不可信），手写反而更直白、错误信息更准。
 * 原则：**校验失败要明确报错，绝不把畸形结构渲染出去**。
 */

export const SLIDE_LAYOUTS = [
  'cover',
  'section',
  'agenda',
  'bullets',
  'steps',
  'stat',
  'compare',
  'two-col',
  'code',
  'quote',
  'image',
  'image-full',
  'image-left',
  'image-right',
  'image-grid',
  'end',
] as const;

export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export interface SlideStat {
  value: string;
  label: string;
  detail?: string;
}

export interface SlideCompare {
  leftTitle?: string;
  rightTitle?: string;
  left: string[];
  right: string[];
}

/** 单张图片引用：只允许平台内 `file:<fileId>`（见 validateSlide 的校验注释） */
export interface SlideImage {
  url: string;
  caption?: string;
}

export interface SlideJson {
  id: string;
  layout: SlideLayout;
  /** 眉题（封面/分节页上方的小字，如课程名） */
  kicker?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  /** steps：有序步骤（复用 bullets 承载，渲染为带序号的流程）——见 validateSlide */
  /** stat：大数字（1–4 个），商业 deck 高频版式 */
  stats?: SlideStat[];
  /** compare：左右两栏带列标题的要点清单（比 two-col 的裸 Markdown 更结构化） */
  compare?: SlideCompare;
  /** two-col：两栏内容，都是 Markdown 片段 */
  left?: string;
  right?: string;
  code?: { lang: string; content: string };
  quote?: { text: string; cite?: string };
  /** image / image-full / image-left / image-right：单图（left/right 另配 bullets 要点） */
  image?: SlideImage;
  /** image-grid：多图网格（1–4 张） */
  images?: SlideImage[];
  /** 讲者备注 → reveal 的 <aside class="notes"> */
  notes?: string;
  /** 传给 reveal 的页级指令 */
  attrs?: { background?: string; transition?: string; className?: string };
}

/**
 * deck 的一页：**语义模型（v2，默认）** 或 **旧版式模型（v1，历史 deck 与回退）**。
 * 两者共用 `slide_decks.slides` JSON 列，按结构自辨识（有 `intent` 即 v2），无需迁移。
 */
export type DeckSlide = SlideJson | SemanticPage;

export interface DeckConfig {
  transition?: 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom';
  slideNumber?: boolean | 'c/t';
  progress?: boolean;
  /** v1 固定 false：hash 会改地址栏，在平台内嵌场景里只会制造麻烦 */
  hash?: boolean;
  controls?: boolean;
  center?: boolean;
  loop?: boolean;
}

export const DECK_TRANSITIONS = [
  'none',
  'fade',
  'slide',
  'convex',
  'concave',
  'zoom',
] as const;

export const DEFAULT_DECK_CONFIG: Required<
  Pick<
    DeckConfig,
    'transition' | 'slideNumber' | 'progress' | 'hash' | 'controls' | 'center' | 'loop'
  >
> = {
  transition: 'slide',
  slideNumber: 'c/t',
  progress: true,
  hash: false,
  controls: true,
  center: true,
  loop: false,
};

export interface SlideLimits {
  maxSlides: number;
  maxBullets: number;
  maxChars: number;
  maxNotes: number;
}

export class DeckValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeckValidationError';
  }
}

const LAYOUT_SET = new Set<string>(SLIDE_LAYOUTS);

/** 平台文件引用（image.url / images[].url / attrs.background 共用）：只允许 `file:<uuid>` */
const FILE_REF_RE = /^file:[0-9a-fA-F-]{36}$/;

export function newSlideId(): string {
  return randomUUID();
}

/** 取字符串并裁剪长度；非字符串一律 undefined（不抛错，交给调用方决定是否必需） */
function readString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function readStringArray(
  value: unknown,
  limits: SlideLimits,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new DeckValidationError('bullets 必须是字符串数组');
  }
  const items: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new DeckValidationError('bullets 里出现了非字符串元素');
    }
    const text = readString(raw, limits.maxChars);
    if (text) items.push(text);
    if (items.length >= limits.maxBullets) break;
  }
  return items.length ? items : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验单页。`index` 只用于错误信息（"第 3 页 …"）。
 * 注意：这里**不补默认值**，只做形状校验与上限裁剪。
 */
export function validateSlide(raw: unknown, index: number, limits: SlideLimits): SlideJson {
  if (!isRecord(raw)) {
    throw new DeckValidationError(`第 ${index + 1} 页不是对象`);
  }
  const layout = raw.layout;
  if (typeof layout !== 'string' || !LAYOUT_SET.has(layout)) {
    throw new DeckValidationError(
      `第 ${index + 1} 页的 layout 非法（${String(layout)}），允许：${SLIDE_LAYOUTS.join('/')}`,
    );
  }

  const slide: SlideJson = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : newSlideId(),
    layout: layout as SlideLayout,
  };

  const kicker = readString(raw.kicker, 30);
  if (kicker) slide.kicker = kicker;
  const title = readString(raw.title, limits.maxChars);
  if (title) slide.title = title;
  const subtitle = readString(raw.subtitle, limits.maxChars);
  if (subtitle) slide.subtitle = subtitle;

  const bullets = readStringArray(raw.bullets, limits);
  if (bullets) slide.bullets = bullets;

  if (raw.stats !== undefined && raw.stats !== null) {
    if (!Array.isArray(raw.stats)) {
      throw new DeckValidationError(`第 ${index + 1} 页的 stats 必须是数组`);
    }
    const stats: NonNullable<SlideJson['stats']> = [];
    for (const item of raw.stats) {
      if (!isRecord(item)) throw new DeckValidationError(`第 ${index + 1} 页的 stats 元素必须是对象`);
      const value = readString(item.value, 16);
      const statLabel = readString(item.label, 48);
      if (!value || !statLabel) {
        throw new DeckValidationError(`第 ${index + 1} 页的 stats 元素必须有 value 与 label`);
      }
      const stat: SlideStat = {
        value,
        label: statLabel,
      };
      const detail = readString(item.detail, 120);
      if (detail) stat.detail = detail;
      stats.push(stat);
      if (stats.length >= 4) break;
    }
    if (stats.length) slide.stats = stats;
  }

  if (raw.compare !== undefined && raw.compare !== null) {
    if (!isRecord(raw.compare)) {
      throw new DeckValidationError(`第 ${index + 1} 页的 compare 必须是对象`);
    }
    const pickSide = (side: unknown): string[] => {
      if (!Array.isArray(side)) return [];
      const items: string[] = [];
      for (const entry of side) {
        if (typeof entry !== 'string') {
          throw new DeckValidationError(`第 ${index + 1} 页的 compare 清单里出现了非字符串元素`);
        }
        const text = readString(entry, limits.maxChars);
        if (text) items.push(text);
        if (items.length >= limits.maxBullets) break;
      }
      return items;
    };
    const compare: NonNullable<SlideJson['compare']> = {
      left: pickSide(raw.compare.left),
      right: pickSide(raw.compare.right),
    };
    const leftTitle = readString(raw.compare.leftTitle, 30);
    if (leftTitle) compare.leftTitle = leftTitle;
    const rightTitle = readString(raw.compare.rightTitle, 30);
    if (rightTitle) compare.rightTitle = rightTitle;
    if (!compare.left.length && !compare.right.length) {
      // 模型常把 prompt 里的完整 schema 抄成空壳占位（"compare": {"left": [], "right": []}），
      // 出现在 section/bullets 等无关页上 —— 空 compare 只有在本页就是 compare 版式时才算失败，
      // 其余情况直接丢弃，不该拖垮整页（2026-09-30 实测一批 6 页被这种占位误杀）
      if (slide.layout === 'compare') {
        throw new DeckValidationError(`第 ${index + 1} 页的 compare 两栏都是空的`);
      }
    } else {
      slide.compare = compare;
    }
  }

  const left = readString(raw.left, limits.maxChars * 4);
  if (left) slide.left = left;
  const right = readString(raw.right, limits.maxChars * 4);
  if (right) slide.right = right;

  if (raw.code !== undefined && raw.code !== null) {
    if (!isRecord(raw.code)) {
      throw new DeckValidationError(`第 ${index + 1} 页的 code 必须是对象`);
    }
    const content = readString(raw.code.content, limits.maxChars * 20);
    if (content) {
      slide.code = {
        lang: readString(raw.code.lang, 32) || 'text',
        content,
      };
    }
  }

  if (raw.quote !== undefined && raw.quote !== null) {
    if (!isRecord(raw.quote)) {
      throw new DeckValidationError(`第 ${index + 1} 页的 quote 必须是对象`);
    }
    const text = readString(raw.quote.text, limits.maxChars * 2);
    if (text) {
      slide.quote = { text, cite: readString(raw.quote.cite, limits.maxChars) };
    }
  }

  if (raw.image !== undefined && raw.image !== null) {
    if (!isRecord(raw.image)) {
      throw new DeckValidationError(`第 ${index + 1} 页的 image 必须是对象`);
    }
    const url = readString(raw.image.url, 2048);
    if (url) {
      // 只允许平台内文件引用（`file:<fileId>`）：外链图片会泄露访问者信息、也带来混合内容问题；
      // 渲染时由前端带鉴权取内容再内联成 data URL（演示 iframe 是 opaque origin，带不了 Authorization 头）
      if (!FILE_REF_RE.test(url)) {
        throw new DeckValidationError(
          `第 ${index + 1} 页的 image.url 必须是平台文件引用（file:<fileId>）`,
        );
      }
      slide.image = { url, caption: readString(raw.image.caption, limits.maxChars) };
    }
  }

  if (raw.images !== undefined && raw.images !== null) {
    if (!Array.isArray(raw.images)) {
      throw new DeckValidationError(`第 ${index + 1} 页的 images 必须是数组`);
    }
    const images: SlideImage[] = [];
    for (const item of raw.images) {
      if (!isRecord(item)) {
        throw new DeckValidationError(`第 ${index + 1} 页的 images 元素必须是对象`);
      }
      const url = readString(item.url, 2048);
      if (!url) continue;
      if (!FILE_REF_RE.test(url)) {
        throw new DeckValidationError(
          `第 ${index + 1} 页的 images.url 必须是平台文件引用（file:<fileId>）`,
        );
      }
      images.push({ url, caption: readString(item.caption, limits.maxChars) });
      if (images.length >= 4) break; // 网格最多 4 张，超出截断（与 stats 同款策略）
    }
    if (images.length) slide.images = images;
  }

  const notes = readString(raw.notes, limits.maxNotes);
  if (notes) slide.notes = notes;

  if (isRecord(raw.attrs)) {
    const attrs: SlideJson['attrs'] = {};
    const background = readString(raw.attrs.background, 256);
    if (background) {
      // 与 image.url 同理：只允许颜色值或平台文件引用，杜绝外链
      const isColor =
        /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.,\s%]+\)|hsla?\(\s*[\d.,\s%]+\)|[a-z]{3,20})$/.test(
          background,
        );
      if (!isColor && !/^file:[0-9a-fA-F-]{36}$/.test(background)) {
        throw new DeckValidationError(
          `第 ${index + 1} 页的 attrs.background 只能是颜色值或 file:<fileId>`,
        );
      }
      attrs.background = background;
    }
    const transition = readString(raw.attrs.transition, 32);
    if (transition && (DECK_TRANSITIONS as readonly string[]).includes(transition)) {
      attrs.transition = transition;
    }
    const className = readString(raw.attrs.className, 128);
    if (className) attrs.className = className;
    if (Object.keys(attrs).length) slide.attrs = attrs;
  }

  // 版式与内容的最低匹配：agenda/steps 没要点、stat 没数字，渲染出来就是空页
  if ((layout === 'agenda' || layout === 'steps') && !slide.bullets?.length) {
    throw new DeckValidationError(`第 ${index + 1} 页（${layout}）没有条目`);
  }
  if (layout === 'stat' && !slide.stats?.length) {
    throw new DeckValidationError(`第 ${index + 1} 页（stat）没有大数字`);
  }
  // 图片系新版式没图就是空页（image-left/right 的 bullets 可空，图不可空；
  // 旧 image 版式保持宽松，不追加强校验以免误伤既有 deck）
  if (
    (layout === 'image-full' ||
      layout === 'image-left' ||
      layout === 'image-right') &&
    !slide.image
  ) {
    throw new DeckValidationError(`第 ${index + 1} 页（${layout}）没有图片`);
  }
  if (layout === 'image-grid' && !slide.images?.length) {
    throw new DeckValidationError(`第 ${index + 1} 页（image-grid）没有图片`);
  }

  // 每页至少要有点可展示的东西，否则渲染出来是空白页
  const hasContent =
    !!slide.title ||
    !!slide.subtitle ||
    !!slide.bullets?.length ||
    !!slide.stats?.length ||
    !!slide.compare ||
    !!slide.left ||
    !!slide.right ||
    !!slide.code ||
    !!slide.quote ||
    !!slide.image ||
    !!slide.images?.length;
  if (!hasContent) {
    throw new DeckValidationError(`第 ${index + 1} 页没有任何内容`);
  }

  return slide;
}

/** 校验整个 slides 数组（模型产出入口） */
export function validateSlides(raw: unknown, limits: SlideLimits): SlideJson[] {
  if (!Array.isArray(raw)) {
    throw new DeckValidationError('slides 必须是数组');
  }
  if (!raw.length) {
    throw new DeckValidationError('slides 不能为空');
  }
  if (raw.length > limits.maxSlides) {
    throw new DeckValidationError(
      `页数 ${raw.length} 超过上限 ${limits.maxSlides}`,
    );
  }
  return raw.map((item, index) => validateSlide(item, index, limits));
}

/** 从 `{ deckTitle, slides }` 这类模型响应里取 slides 字段（兼容模型偶尔多包一层） */
export function extractSlidesFromModelJson(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw)) {
    if (Array.isArray(raw.slides)) return raw.slides;
    // 少数情况：{ deck: { slides: [...] } }
    if (isRecord(raw.deck) && Array.isArray(raw.deck.slides)) return raw.deck.slides;
  }
  return raw;
}

/** 校验整份 deck 配置（教师可改的一部分） */
export function validateDeckConfig(raw: unknown): DeckConfig {
  if (!isRecord(raw)) {
    throw new DeckValidationError('config 必须是对象');
  }
  const config: DeckConfig = {};
  const transition = raw.transition;
  if (transition !== undefined) {
    if (
      typeof transition !== 'string' ||
      !(DECK_TRANSITIONS as readonly string[]).includes(transition)
    ) {
      throw new DeckValidationError(
        `transition 非法，允许：${DECK_TRANSITIONS.join('/')}`,
      );
    }
    config.transition = transition as DeckConfig['transition'];
  }
  if (raw.slideNumber !== undefined) {
    if (raw.slideNumber === 'c/t') config.slideNumber = 'c/t';
    else if (typeof raw.slideNumber === 'boolean') config.slideNumber = raw.slideNumber;
    else throw new DeckValidationError('slideNumber 只能是布尔或 "c/t"');
  }
  for (const key of ['progress', 'hash', 'controls', 'center', 'loop'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new DeckValidationError(`${key} 必须是布尔值`);
    }
    config[key] = value;
  }
  return config;
}

/** 存库前统一过一遍：页数与各项上限（教师手工编辑也可能超限） */
export function normalizeSlides(slides: SlideJson[], limits: SlideLimits): SlideJson[] {
  return validateSlides(slides, limits);
}
