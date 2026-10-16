#!/usr/bin/env node
/**
 * 把一张照片内联成主题「南大风」封面/分节页的辅助背景。
 *
 * 用法：
 *   node web/tools/embed-tower-photo.mjs <照片路径> [--width=1600] [--quality=0.82]
 *   node web/tools/embed-tower-photo.mjs --clear          # 还原成自绘钟楼剪影
 *
 * 做什么：读照片 → 在无头 Chromium 里缩放到 `--width` 宽（等比）→ 编码成 JPEG data URI →
 * 写进 `web/src/slides/semantic/assets/nju-hero-photo.ts`。
 *
 * 为什么必须内联（而不是 public/ 下放个文件）：幻灯片是 `iframe srcdoc` 的**自包含**文档
 * （沙箱 opaque origin + 导出 PDF 时没有网络），外部 URL 取不到；换图也只需重跑本脚本，
 * 主题与版式一行都不用改。
 *
 * 为什么要压缩：data URI 会整个进 srcdoc，几 MB 的原图会让每次放映都多背几兆。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const webRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const target = resolve(webRoot, 'src/slides/semantic/assets/nju-hero-photo.ts');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve(homedir(), '.cache', 'ms-playwright');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const clear = args.includes('--clear');
const photoArg = args.find((a) => !a.startsWith('--'));
const width = Number(flag('width', '1600'));
const quality = Number(flag('quality', '0.82'));

const TEMPLATE = (dataUri, note) => `/**
 * 封面 / 分节页辅助背景的**照片**素材位（可选）。
 *
 * 本文件由 \`node web/tools/embed-tower-photo.mjs <照片路径>\` 自动生成，请勿手工编辑
 * （手工改完再跑一次脚本会被覆盖）。置空字符串即回落到自绘的钟楼剪影（nju-tower.svg）。
 * ${note}
 *
 * 为什么用 data URI 而不是 public/ 下的静态文件：幻灯片是 \`iframe srcdoc\` 的**自包含**文档
 * （沙箱 opaque origin、离线也能放映、导出 PDF 时没有网络），外部 URL 一概取不到。
 */
export const NJU_HERO_PHOTO = '${dataUri}';
`;

if (clear || !photoArg) {
  if (!clear) {
    console.error('用法：node web/tools/embed-tower-photo.mjs <照片路径> [--width=1600] [--quality=0.82]');
    console.error('      node web/tools/embed-tower-photo.mjs --clear');
    process.exit(1);
  }
  writeFileSync(target, TEMPLATE('', ''), 'utf8');
  console.log('已清空照片素材位 → 主题回落到自绘钟楼剪影（nju-tower.svg）');
  process.exit(0);
}

const photoPath = resolve(process.cwd(), photoArg);
const ext = extname(photoPath).toLowerCase();
const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
const bytes = readFileSync(photoPath);
console.log(`素材：${photoPath}（${(bytes.length / 1024).toFixed(0)} KB，${mime}）`);

// 用 data URL 而不是 file:// 喂给浏览器：Chromium 把 file:// 当 opaque origin，
// 画进 canvas 再 toDataURL 会抛 SecurityError（tainted canvas）。
const sourceDataUrl = `data:${mime};base64,${bytes.toString('base64')}`;

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
const result = await page.evaluate(
  ([src, maxWidth, q]) =>
    new Promise((resolvePromise, rejectPromise) => {
      const img = new Image();
      img.onerror = () => rejectPromise(new Error('图片解码失败（格式不受支持？）'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.naturalWidth);
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // 透明背景（PNG）压到浅底上，避免 JPEG 编码把透明区变成黑块
        ctx.fillStyle = '#f7f4fb';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolvePromise({ dataUrl: canvas.toDataURL('image/jpeg', q), w, h, sourceW: img.naturalWidth, sourceH: img.naturalHeight });
      };
      img.src = src;
    }),
  [sourceDataUrl, width, quality],
);
await browser.close();

const kb = (result.dataUrl.length / 1024).toFixed(0);
writeFileSync(
  target,
  TEMPLATE(
    result.dataUrl,
    `\n * 当前素材：${photoPath.split('/').pop()}（原图 ${result.sourceW}×${result.sourceH} → ${result.w}×${result.h}，内联 ${kb} KB）`,
  ),
  'utf8',
);
console.log(`已写入 ${pathToFileURL(target).pathname}：${result.w}×${result.h}，data URI ${kb} KB`);
console.log('提示：`node web/tools/preview-semantic.mjs --themes=builtin-nju` 可立刻看效果。');
