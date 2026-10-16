/**
 * 封面 / 分节页辅助背景的**照片**素材位（可选）。
 *
 * 本文件由 `node web/tools/embed-tower-photo.mjs <照片路径>` 自动生成，请勿手工编辑
 * （手工改完再跑一次脚本会被覆盖）。置空字符串即回落到自绘的钟楼剪影（nju-tower.svg）。
 * 
 *
 * 为什么用 data URI 而不是 public/ 下的静态文件：幻灯片是 `iframe srcdoc` 的**自包含**文档
 * （沙箱 opaque origin、离线也能放映、导出 PDF 时没有网络），外部 URL 一概取不到。
 */
export const NJU_HERO_PHOTO = '';
