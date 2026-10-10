/**
 * 旧模型 → 语义模型 适配器（**有损**，目的是让平台里既有的 deck 零生成成本地用上新渲染层）。
 *
 * 为什么需要它：服务端生成侧目前仍产 `SlideJson`（16 种版式枚举）。这一步让新渲染层
 * 先把「观感」铺到既有内容上；等生成侧改成直接产语义模型（P2）后，本文件即可退场。
 *
 * 映射原则：
 *   1) **版式意图靠猜，内容不丢**：拿不准的映射宁可朴素（如 `two-col` → 卡片组），
 *      也不做会丢字的转换；
 *   2) 富文本只在必要时降级为纯文本（`two-col` 的 Markdown 片段）；
 *   3) 旧模型没有的语义（如 relation/flow）不做臆造 —— 不做"看起来更炫但内容不符"的版式。
 */
import type { SlideJson, SlideTemplateDesign } from '../../types';
import type { Block, MetricItem, Page, PageIntent, SequenceItem } from './types';

/** 去 Markdown 行内标记与列表符号，拿纯文本（用于 two-col 的片段降级） */
function plainText(markdown: string | undefined): string {
  if (!markdown) return '';
  return markdown
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\n{2,}/g, '；')
    .replace(/\n/g, ' ')
    .trim();
}

function fileIdOf(url: string | undefined): string {
  if (!url) return '';
  return url.startsWith('file:') ? url.slice(5) : url;
}

const METRIC_TONE = (): MetricItem['tone'] => undefined;

/** 单页映射 */
function pageOf(slide: SlideJson, intent: PageIntent, blocks: Page['blocks']): Page {
  return {
    intent,
    kicker: slide.kicker,
    title: slide.title,
    subtitle: slide.layout === 'cover' ? slide.subtitle : undefined,
    blocks,
    notes: slide.notes,
  };
}

/**
 * 整份 deck → 语义页数组。
 * 未知版式退化为「主张 + 要点」（绝不空白页）。
 */
export function legacyDeckToPages(slides: SlideJson[]): Page[] {
  return slides.map((slide) => {
    const bullets = (slide.bullets ?? []).filter(Boolean);
    const image = slide.image ? { fileId: fileIdOf(slide.image.url), caption: slide.image.caption } : undefined;
    switch (slide.layout) {
      case 'cover':
        return pageOf(slide, 'cover', bullets.length ? [{ kind: 'evidence', items: bullets.slice(0, 5) }] : []);
      case 'agenda':
        return pageOf(slide, 'toc', [
          { kind: 'sequence', items: bullets.map((title) => ({ title })) as SequenceItem[] },
        ]);
      case 'section':
        return pageOf(slide, 'section', bullets.length ? [{ kind: 'evidence', items: bullets.slice(0, 3) }] : []);
      case 'steps':
        return pageOf(slide, 'sequence', [
          { kind: 'sequence', items: bullets.map((title) => ({ title })) as SequenceItem[] },
        ]);
      case 'stat':
        return pageOf(slide, 'metric', [
          {
            kind: 'metric',
            items: (slide.stats ?? []).slice(0, 4).map((stat) => ({
              value: stat.value,
              label: stat.label,
              detail: stat.detail,
              tone: METRIC_TONE(),
            })),
          },
        ]);
      case 'compare':
        return pageOf(slide, 'contrast', [
          {
            kind: 'compare',
            left: { title: slide.compare?.leftTitle ?? 'A', items: slide.compare?.left ?? [], tone: 'accent' },
            right: { title: slide.compare?.rightTitle ?? 'B', items: slide.compare?.right ?? [], tone: 'accent' },
          },
        ]);
      case 'two-col': {
        const items = [plainText(slide.left), plainText(slide.right)].filter(Boolean);
        return pageOf(slide, 'pillars', items.length ? [{ kind: 'evidence', items }] : []);
      }
      case 'code':
        return pageOf(slide, 'example', slide.code ? [{ kind: 'code', lang: slide.code.lang, content: slide.code.content }] : []);
      case 'quote':
        return pageOf(slide, 'quote', slide.quote ? [{ kind: 'quote', text: slide.quote.text, cite: slide.quote.cite }] : []);
      case 'image':
      case 'image-full': {
        const blocks: Block[] = [];
        if (image) {
          blocks.push({
            kind: 'image',
            fileId: image.fileId,
            caption: image.caption,
            role: slide.layout === 'image-full' ? 'full' : 'inline',
          });
        }
        if (bullets.length) blocks.push({ kind: 'evidence', items: bullets });
        return pageOf(slide, image ? 'image' : 'claim', blocks);
      }
      case 'image-left':
      case 'image-right': {
        const blocks: Block[] = [];
        if (image) blocks.push({ kind: 'image', fileId: image.fileId, caption: image.caption, role: 'hero' });
        if (bullets.length) blocks.push({ kind: 'evidence', items: bullets });
        return pageOf(slide, image ? 'image' : 'claim', blocks);
      }
      case 'image-grid': {
        const items = (slide.images ?? []).slice(0, 4).map((item) => ({
          fileId: fileIdOf(item.url),
          caption: item.caption,
        }));
        if (!items.length) return pageOf(slide, 'claim', bullets.length ? [{ kind: 'evidence', items: bullets }] : []);
        const block: Block = { kind: 'image', fileId: items[0].fileId, role: 'grid', items };
        return pageOf(slide, 'image', [block]);
      }
      case 'end':
        return pageOf(slide, 'summary', bullets.length ? [{ kind: 'evidence', items: bullets }] : []);
      case 'bullets':
      default:
        return pageOf(slide, 'claim', bullets.length ? [{ kind: 'evidence', items: bullets }] : []);
    }
  });
}

/**
 * 旧模板调参（`SlideTemplateDesign`）→ 新 token 覆盖。
 * 颜色/字体/圆角直接映射；`fontScale` / `density` / `cardStyle` 映射到版式令牌
 * （`--ly-scale` / `--ly-gap` / `--ly-card-*`）—— 于是旧模板的观感档位在新渲染器上照样生效。
 */
export function designToTokenOverrides(design: SlideTemplateDesign | undefined): Record<string, string> {
  if (!design) return {};
  const tokens: Record<string, string> = {};
  if (design.primary) tokens['--accent'] = design.primary;
  if (design.accent) {
    tokens['--accent-2'] = design.accent;
    tokens['--accent-soft'] = `color-mix(in srgb, ${design.primary ?? design.accent} 12%, transparent)`;
  }
  if (design.background) {
    tokens['--bg'] = design.background;
    tokens['--bg-soft'] = design.background;
  }
  if (design.text) tokens['--text-1'] = design.text;
  if (design.headingFontFamily) tokens['--font-display'] = design.headingFontFamily;
  if (design.fontFamily) {
    tokens['--font-sans'] = design.fontFamily;
  }
  // 字号阶梯 / 疏密 / 卡片风格 —— 旧模板调参的三个观感档位，映射到新版式令牌
  if (design.fontScale === 'compact') tokens['--ly-scale'] = '0.93';
  if (design.fontScale === 'large') tokens['--ly-scale'] = '1.08';
  if (design.density === 'compact') tokens['--ly-gap'] = '0.82';
  if (design.density === 'loose') tokens['--ly-gap'] = '1.22';
  if (design.cardStyle === 'none') {
    tokens['--ly-card-bg'] = 'transparent';
    tokens['--ly-card-border'] = 'none';
    tokens['--ly-card-shadow'] = 'none';
  }
  if (design.cardStyle === 'outline') {
    tokens['--ly-card-bg'] = 'transparent';
    tokens['--ly-card-border'] = '1.5px solid var(--border-strong)';
    tokens['--ly-card-shadow'] = 'none';
  }
  if (typeof design.radius === 'number') {
    tokens['--radius'] = `${design.radius}px`;
    tokens['--radius-sm'] = `${Math.max(0, design.radius - 4)}px`;
    tokens['--radius-lg'] = `${design.radius + 8}px`;
  }
  return tokens;
}
