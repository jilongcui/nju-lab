import type { SlideJson, SlideLayout, StoredFileInfo } from '../types';

/**
 * 图片选择器确认后的落地动作（纯函数，不依赖 React）：
 * JSON 视图走结构化插入/替换；Markdown 视图按 server `splitPages` 同规则做文本 splice。
 * 两种落地都只改编辑区文本，「保存内容」后才真正生效（后端 normalizeSlides 再校验一遍）。
 */

export type ImageAction =
  | { kind: 'insert'; layout: SlideLayout; afterIndex: number }
  | { kind: 'replace'; index: number };

/** 单图系版式：换图动作只对这些页型开放（多图页请直接改文本） */
export const SINGLE_IMAGE_LAYOUTS: SlideLayout[] = [
  'image',
  'image-full',
  'image-left',
  'image-right',
];

/** 可选的图片版式（插入菜单与图片库共用） */
export const IMAGE_LAYOUT_OPTIONS: { value: SlideLayout; label: string }[] = [
  { value: 'image', label: '单图（居中）' },
  { value: 'image-full', label: '全幅大图' },
  { value: 'image-left', label: '左图右文' },
  { value: 'image-right', label: '右图左文' },
  { value: 'image-grid', label: '多图网格（2–4 张）' },
];

/** 文件名 → 图注：去扩展名、去掉会破坏 Markdown 图片语法的方括号 */
function altOf(info: StoredFileInfo): string {
  return info.originalName.replace(/\.[a-z0-9]+$/i, '').replace(/[[\]]/g, '');
}

/**
 * 选中图片 → Markdown 图片行片段（每张一行，末尾带换行）。
 * 供「光标处插入」场景共用：章节正文编辑、幻灯片 MD 视图。
 */
export function imageMarkdownSnippet(images: StoredFileInfo[]): string {
  return `${images.map((info) => `![${altOf(info)}](file:${info.fileId})`).join('\n')}\n`;
}

function newId(): string {
  // 注意：crypto.randomUUID 只在安全上下文可用，http 裸部署环境会缺席
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 用选中的图片构造新页（grid 用全部选中图，其余版式取第一张） */
export function buildImageSlide(layout: SlideLayout, images: StoredFileInfo[]): SlideJson {
  if (layout === 'image-grid') {
    return {
      id: newId(),
      layout,
      images: images.map((info) => ({ url: `file:${info.fileId}` })),
    };
  }
  const slide: SlideJson = {
    id: newId(),
    layout,
    image: { url: `file:${images[0].fileId}`, caption: altOf(images[0]) || undefined },
  };
  if (layout === 'image-left' || layout === 'image-right') {
    slide.bullets = ['在这里写要点（可改）'];
  }
  return slide;
}

/** JSON 视图：插入新页（afterIndex 之后）或替换某页单图 */
export function applyImageActionToSlides(
  slides: SlideJson[],
  action: ImageAction,
  images: StoredFileInfo[],
): SlideJson[] {
  if (action.kind === 'insert') {
    const slide = buildImageSlide(action.layout, images);
    const at = Math.min(Math.max(action.afterIndex + 1, 0), slides.length);
    return [...slides.slice(0, at), slide, ...slides.slice(at)];
  }
  const target = slides[action.index];
  if (!target || !SINGLE_IMAGE_LAYOUTS.includes(target.layout)) {
    throw new Error('当前页不是单图版式（多图页请直接在文本里改）');
  }
  return slides.map((slide, index) =>
    index === action.index
      ? { ...slide, image: { url: `file:${images[0].fileId}`, caption: slide.image?.caption } }
      : slide,
  );
}

// ---------------------------------------------------------------- Markdown 视图

// 与 server/src/slides/deck-markdown.ts 的 splitPages 同规则：指令行开新页、独立 --- 分页
const SLIDE_DIRECTIVE = /^\s*<!--\s*\.slide\s*:?\s*(.*?)\s*-->\s*$/;
const PAGE_BREAK = /^\s*---\s*$/;

/** 把 MD 文本切成页块（不含 `---` 分隔行），重新 join 时分隔符统一为 `\n\n---\n\n`（与 toMarkdown 一致） */
export function splitMarkdownPages(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const pages: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.some((l) => l.trim() !== '')) pages.push(current);
    current = [];
  };
  for (const line of lines) {
    if (SLIDE_DIRECTIVE.test(line)) {
      flush();
      current.push(line);
      continue;
    }
    if (PAGE_BREAK.test(line)) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return pages.map((page) => page.join('\n').trim());
}

/** 新图片页的 MD 文本（与 toMarkdown 的输出形态对齐，保存时 parseMarkdown 能无损读回） */
export function buildImagePageMarkdown(
  layout: SlideLayout,
  images: StoredFileInfo[],
): string {
  if (layout === 'image-grid') {
    return [
      '<!-- .slide: layout=image-grid -->',
      '',
      ...images.map((info) => `![${altOf(info)}](file:${info.fileId})`),
    ].join('\n');
  }
  const lines = [`<!-- .slide: layout=${layout} -->`, '# 图片页'];
  if (layout === 'image-left' || layout === 'image-right') {
    lines.push('- 在这里写要点（可改）');
  }
  lines.push('', `![${altOf(images[0])}](file:${images[0].fileId})`);
  return lines.join('\n');
}

/** Markdown 视图：插入新页块，或替换目标页的第一行图片（没有图片行就追加一行） */
export function applyImageActionToMarkdown(
  markdown: string,
  action: ImageAction,
  images: StoredFileInfo[],
): string {
  const pages = splitMarkdownPages(markdown);
  if (action.kind === 'insert') {
    const block = buildImagePageMarkdown(action.layout, images);
    const at = Math.min(Math.max(action.afterIndex + 1, 0), pages.length);
    pages.splice(at, 0, block);
  } else {
    const page = pages[action.index];
    if (page === undefined) return markdown;
    const lines = page.split('\n');
    const imageLine = `![${altOf(images[0])}](file:${images[0].fileId})`;
    const at = lines.findIndex((l) => /^\s*!\[/.test(l));
    if (at >= 0) lines[at] = imageLine;
    else lines.push('', imageLine);
    pages[action.index] = lines.join('\n');
  }
  return `${pages.join('\n\n---\n\n')}\n`;
}
