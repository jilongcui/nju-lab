import type { DeckSlide, SemanticPage } from '../../types';

/**
 * deck 结构自辨识：v2（语义模型）的每一页都带 `intent`。
 *
 * 前端据此决定走哪条渲染/编辑路径 —— 与服务端 `semantic.schema.ts` 的
 * `isSemanticDeck` 同口径（两边都不看版本号，只看结构，因此**不需要数据库迁移**）。
 */
export function isSemanticDeck(slides: unknown): slides is SemanticPage[] {
  if (!Array.isArray(slides) || !slides.length) return false;
  return slides.every(
    (page) => typeof page === 'object' && page !== null && typeof (page as { intent?: unknown }).intent === 'string',
  );
}

/** 给「换版式」等按页操作取 intent（旧 deck 没有 intent，返回 undefined） */
export function intentOf(slide: DeckSlide | undefined): string | undefined {
  return slide && 'intent' in slide ? (slide as SemanticPage).intent : undefined;
}
