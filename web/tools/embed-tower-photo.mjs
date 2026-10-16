#!/usr/bin/env node
/**
 * 把一张照片内联成主题「南大风」封面/分节页的辅助背景。
 *
 * 用法：
 *   node web/tools/embed-tower-photo.mjs <照片路径> [--width=1600] [--quality=0.82]
 *   node web/tools/embed-tower-photo.mjs <照片路径> --crop=0.08,0.05,0.84,0.72   # 原图比例裁切
 *   node web/tools/embed-tower-photo.mjs <照片路径> --crop-ratio=3:4             # 居中裁到该比例
 *   node web/tools/embed-tower-photo.mjs <照片路径> --fade=0.38,0.28             # 压淡强度 / 清晰半径
 *   node web/tools/embed-tower-photo.mjs <照片路径> --no-fade                    # 不压淡（默认会压成水印）
 *   node web/tools/embed-tower-photo.mjs <照片路径> --preview=/tmp/crop.png      # 先看一眼裁得对不对
 *   node web/tools/embed-tower-photo.mjs --clear                                 # 还原成自绘钟楼剪影
 *
 * 做什么：读照片 → （可选）按比例裁掉多余部分 → 缩放到 `--width` 宽 →
 * **压成水印**（向南大风的浅紫底压淡 + 以右下角为圆心向左上渐隐）→ 编码成 JPEG data URI →
 * 写进 `web/src/slides/semantic/assets/nju-hero-photo.ts`。
 *
 * 为什么必须内联（而不是 public/ 下放个文件）：幻灯片是 `iframe srcdoc` 的**自包含**文档
 * （沙箱 opaque origin + 导出 PDF 时没有网络），外部 URL 取不到；换图也只需重跑本脚本，
 * 主题与版式一行都不用改。
 *
 * 为什么要压缩：data URI 会整个进 srcdoc，几 MB 的原图会让每次放映都多背几兆。
 *
 * ⚠️ 裁剪参数用**原图比例（0–1）而不是像素**：同一组参数在缩略图、原图上含义一致，
 *    换一张同构图的照片也能复用，command line 里也好复述。
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
const previewPath = flag('preview', '');

/** 解析裁剪：`--crop=l,t,w,h`（原图比例）优先；否则 `--crop-ratio=W:H` 居中裁。 */
function parseCrop() {
  const rawCrop = flag('crop', '');
  if (rawCrop) {
    const parts = rawCrop.split(',').map((n) => Number(n.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`--crop 需要四个 0–1 的数字（left,top,width,height），收到：${rawCrop}`);
    }
    const [l, t, w, h] = parts;
    if (w <= 0 || h <= 0 || l < 0 || t < 0 || l + w > 1.0001 || t + h > 1.0001) {
      throw new Error(`--crop 超出原图范围：${rawCrop}`);
    }
    return { left: l, top: t, width: w, height: h, note: `裁切 ${rawCrop}（原图比例）` };
  }
  const rawRatio = flag('crop-ratio', '');
  if (rawRatio) {
    const [rw, rh] = rawRatio.split(':').map((n) => Number(n.trim()));
    if (!(rw > 0) || !(rh > 0)) throw new Error(`--crop-ratio 形如 3:4，收到：${rawRatio}`);
    return { ratio: rw / rh, note: `居中裁到 ${rawRatio}` };
  }
  return null;
}

const crop = parseCrop();

/**
 * 水印参数：`--fade=<压淡>,<清晰半径>`。
 *   压淡   = 往南大风的浅紫底压多少（0 = 照片原色，1 = 全被底色盖住）；默认 0.38
 *   清晰半径 = 椭圆内到这个归一化半径仍全清晰；0.5 就是"照片的边中点刚好透明"；默认 0.28
 * `--no-fade` 关掉（想自己用 CSS 叠遮罩时用；注意那时没有 alpha，输出是 JPEG）。
 */
const fadeSpec = (() => {
  if (args.includes('--no-fade')) return null;
  const raw = flag('fade', '');
  const parts = raw ? raw.split(',').map((n) => Number(n.trim())) : [];
  if (parts.length && (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)))) {
    throw new Error(`--fade 需要两个 0–1 的数（压淡,tint；渐隐半径 hold），收到：${raw}`);
  }
  return {
    tint: parts[0] ?? 0.38, // 浅紫压淡强度（0 = 不压，照片保持原色）
    hold: parts[1] ?? 0.28, // 椭圆内到这个归一化半径仍保持全清晰；0.5 是"边中点刚好透明"
    alpha: true,
  };
})();

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
    console.error('      node web/tools/embed-tower-photo.mjs <照片路径> --crop=0.08,0.05,0.84,0.72');
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
  ([src, maxWidth, q, cropSpec, fade]) =>
    new Promise((resolvePromise, rejectPromise) => {
      const img = new Image();
      img.onerror = () => rejectPromise(new Error('图片解码失败（格式不受支持？）'));
      img.onload = () => {
        const naturalW = img.naturalWidth;
        const naturalH = img.naturalHeight;
        // 裁切框（原图像素）
        let sx = 0;
        let sy = 0;
        let sw = naturalW;
        let sh = naturalH;
        let cropLabel = '不裁切';
        if (cropSpec && cropSpec.ratio) {
          const targetRatio = cropSpec.ratio;
          const sourceRatio = naturalW / naturalH;
          if (sourceRatio > targetRatio) {
            sw = naturalH * targetRatio;
            sx = (naturalW - sw) / 2;
          } else {
            sh = naturalW / targetRatio;
            sy = (naturalH - sh) / 2;
          }
          cropLabel = `居中裁到 ${targetRatio.toFixed(3)}（${Math.round(sw)}×${Math.round(sh)}）`;
        } else if (cropSpec) {
          sx = naturalW * cropSpec.left;
          sy = naturalH * cropSpec.top;
          sw = naturalW * cropSpec.width;
          sh = naturalH * cropSpec.height;
          cropLabel = `裁切框 ${Math.round(sx)},${Math.round(sy)} ${Math.round(sw)}×${Math.round(sh)}`;
        }
        const scale = Math.min(1, maxWidth / sw);
        const w = Math.round(sw * scale);
        const h = Math.round(sh * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // 透明背景（PNG）压到浅底上，避免 JPEG 编码把透明区变成黑块
        ctx.fillStyle = '#f7f4fb';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

        /**
         * 把照片"做旧"成水印：整体压淡 + 以钟楼为中心的径向渐隐。
         *
         * ⚠️ 为什么在素材侧做而不是用 CSS 的遮罩层：CSS 里 `background-size: Wpx auto`
         * 对**渐变层**而言 auto 等于整个定位区高度（渐变没有内在比例），于是遮罩层和照片层
         * 高度不一致 —— 照片上/左会露出一条硬边（2026-10 实测踩到）。
         * 烘焙进图片则只有一层背景，不存在对不齐。
         */
        // ① 压淡：把照片往南大风的浅紫调上靠，免得实景的绿/蓝跳到版面上
        if (fade && fade.tint > 0) {
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = `rgba(244,239,250,${fade.tint})`;
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = 'source-over';
        }

        // ② 椭圆形 alpha 渐隐：边缘**真正透明**（不是"用底色盖住"）
        if (fade && fade.alpha) {
          /**
           * ⚠️ 三个必须踩对的地方（各栽过一版）：
           *   1) 用 alpha 而不是"刷一层底色"：底色是固定的浅紫，而页面底是渐变，
           *      刷色会在照片边缘留下一条比对得出来的色差线；
           *   2) 渐隐形状必须是**与照片同比例的椭圆**：矩形四角离中心的距离是边中点的 √2 倍，
           *      用圆做时"边刚好融掉"意味着四角还差一大截，照样露出一圈矩形边；
           *   3) 半轴取 scale 之后的 w（y 被 scale(1,h/w) 压过，矩形在变换坐标系里是正方），
           *      所以"边中点"的归一化半径是 0.5 —— 渐隐必须在 0.5 处就归零（写成 0.847 会
           *      刚好差一倍，边缘于是完全不透明、露出硬边，实测栽过）。
           */
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.scale(1, h / w);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
          g.addColorStop(0, 'rgba(0,0,0,1)');
          g.addColorStop(fade.hold, 'rgba(0,0,0,1)');
          // 0.5 = 边中点（半轴取 scale 后的 w，矩形在变换坐标系里是正方）——
          // 必须在这里归零，否则边上还留着 0.69 的不透明度（实测：就是那圈看得见的矩形边）
          g.addColorStop(0.5, 'rgba(0,0,0,0)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalCompositeOperation = 'destination-in';
          ctx.fillStyle = g;
          // 变换后的坐标系：x/y 方向都取 ±w/2 即可覆盖整张画布（y 已被 scale 压缩）
          ctx.fillRect(-w / 2, -w / 2, w, w);
          ctx.restore();
          ctx.globalCompositeOperation = 'source-over';
        }

        const mimeOut = fade && fade.alpha ? 'image/webp' : 'image/jpeg';
        resolvePromise({
          dataUrl: canvas.toDataURL(mimeOut, q),
          w,
          h,
          naturalW,
          naturalH,
          cropLabel,
          mimeOut,
          previewDataUrl: canvas.toDataURL('image/png'),
        });
      };
      img.src = src;
    }),
  [sourceDataUrl, width, quality, crop, fadeSpec],
);
await browser.close();

console.log(`原图 ${result.naturalW}×${result.naturalH} → ${result.cropLabel} → 输出 ${result.w}×${result.h}（比例 ${(result.w / result.h).toFixed(2)}:1）`);

if (previewPath) {
  const out = resolve(process.cwd(), previewPath);
  writeFileSync(out, Buffer.from(result.previewDataUrl.split(',')[1], 'base64'));
  console.log(`预览（未压缩）：${out}`);
}

const kb = (result.dataUrl.length / 1024).toFixed(0);
writeFileSync(
  target,
  TEMPLATE(
    result.dataUrl,
    `\n * 当前素材：${photoPath.split('/').pop()}（原图 ${result.naturalW}×${result.naturalH} → ${result.cropLabel} → ${result.w}×${result.h}，内联 ${kb} KB）`,
  ),
  'utf8',
);
console.log(`已写入 ${pathToFileURL(target).pathname}：内联 ${kb} KB`);
console.log('提示：`node web/tools/preview-semantic.mjs --themes=builtin-nju --pages=1,3` 可立刻看效果。');
