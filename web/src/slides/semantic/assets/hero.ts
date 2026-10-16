/**
 * 辅助背景素材（封面 / 分节页的钟楼）。
 *
 * 默认用**自绘矢量钟楼剪影**（`nju-tower.svg`，无外部依赖、无第三方版权）；
 * 若 `nju-hero-photo.ts` 里给了照片数据 URI（由
 * `node web/tools/embed-tower-photo.mjs <照片路径>` 生成），则优先用照片 ——
 * **换图只需要换一个文件**，主题与版式一行都不用动。
 */
import towerSvg from './nju-tower.svg?raw';
import { NJU_HERO_PHOTO } from './nju-hero-photo';

/**
 * 剔掉 XML 注释再内联。
 *
 * ⚠️ 不是为了省字节：**XML 注释里出现连续两个减号会让整份 SVG 解析失败**，
 * 而 `background-image` 解析失败是**静默**的（不报错、不显示），2026-10 实测踩过 ——
 * 注释里写了一个以两个减号开头的 CSS 令牌名，结果剪影"配好了却看不见"，
 * 排查了半天。注释反正不需要进 srcdoc，直接删干净。
 */
const TOWER_SVG = towerSvg.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();

if (TOWER_SVG.includes('--')) {
  // 不该发生（注释已删）；真出现说明 SVG 正文里混进了连续减号，图会静默不渲染
  console.warn('[nju] nju-tower.svg 文本里出现连续减号，SVG 可能无法解析');
}

export const NJU_TOWER_SVG_URI = `data:image/svg+xml,${encodeURIComponent(TOWER_SVG)}`;

/** 主题「南大风」封面/分节页的辅助背景图（照片优先，回落剪影） */
export const NJU_HERO_URI: string = NJU_HERO_PHOTO || NJU_TOWER_SVG_URI;

/** 是否用的是照片（照片与剪影的浓淡/尺寸诉求不同，装饰层据此微调） */
export const NJU_HERO_IS_PHOTO = Boolean(NJU_HERO_PHOTO);
