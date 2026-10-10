import client from '../api/client';
import type { DeckSlide } from '../types';

/**
 * 平台文件（`file:<fileId>`）→ data URL。
 *
 * 为什么必须内联而不是直接给 iframe 一个 URL：演示文档跑在 `sandbox="allow-scripts"`（无
 * `allow-same-origin`）的 iframe 里，是 opaque origin —— `<img src="/lab/api/files/x">` 既带不了
 * `Authorization` 头、也拿不到平台 cookie，必然 401。所以在父窗口用带鉴权的 axios 取回内容、
 * 转成 data URL 再塞进文档（顺带把"外链图片"这条泄露面彻底关掉）。
 */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 收集 deck 里所有 `file:` 引用（图片页/多图网格 + 页背景 + 模板 logo）。
 * 同时支持 v1（`SlideJson.image.url = file:<id>`）与 v2（语义块的 `fileId` 裸 id）。
 */
export function collectFileRefs(
  slides: DeckSlide[],
  logoFileId?: string | null,
): string[] {
  const refs = new Set<string>();
  for (const slide of slides) {
    if ('blocks' in slide) {
      for (const block of slide.blocks) {
        if (block.kind !== 'image') continue;
        if (typeof block.fileId === 'string' && block.fileId) refs.add(`file:${block.fileId}`);
        for (const item of (block.items as { fileId?: string }[] | undefined) ?? []) {
          if (item?.fileId) refs.add(`file:${item.fileId}`);
        }
      }
      continue;
    }
    if (slide.image?.url?.startsWith('file:')) refs.add(slide.image.url);
    for (const img of slide.images ?? []) {
      if (img.url?.startsWith('file:')) refs.add(img.url);
    }
    if (slide.attrs?.background?.startsWith('file:')) refs.add(slide.attrs.background);
  }
  if (logoFileId) refs.add(`file:${logoFileId}`);
  return Array.from(refs);
}

/** 批量取内容并转 data URL；单个失败就跳过（不阻断整个渲染） */
export async function fetchFileDataUrls(
  refs: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(refs.filter((ref) => ref.startsWith('file:'))));
  const pairs = await Promise.all(
    unique.map(async (ref) => {
      const fileId = ref.slice('file:'.length);
      if (!/^[0-9a-fA-F-]{36}$/.test(fileId)) return null;
      try {
        const blob = await client.get<unknown, Blob>(`/files/${fileId}`, {
          responseType: 'blob',
        });
        return [ref, await blobToDataUrl(blob)] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p));
}
