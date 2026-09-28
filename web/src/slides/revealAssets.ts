/**
 * reveal 资产的**懒加载**与内联准备。
 *
 * 为什么内联、而不是让 srcdoc 去请求静态文件：
 *   1) 演示文档跑在 `sandbox="allow-scripts"`（**不给 allow-same-origin**）的 iframe 里，
 *      是 opaque origin —— 它拿不到平台的 localStorage/cookie，也就不该依赖同源静态资源；
 *   2) 内联后文档**完全自包含**，前端不需要往 `/var/www/lab` 添加任何文件，
 *      部署面零变化（HANDOFF §2.2 的部署纪律不用再被触碰）；
 *   3) 实测 `dist/reveal.js` 是 **UMD**（`e.Reveal = t()`），内联为经典 `<script>` 会自动挂
 *      `globalThis.Reveal` —— 不用改写源码、也不用 blob URL（opaque origin 下 blob 导入不可靠）。
 *
 * 体积：reveal.js 118KB + reveal.css 54KB + 主题 8KB 量级（刻意只用无内嵌字体的主题，
 * black/black-contrast 各 564KB，已在后端白名单里排掉）。且只在真正打开幻灯片时才拉。
 */

export interface RevealAssets {
  /** dist/reveal.js（UMD）源码 */
  script: string;
  /** dist/reveal.css */
  css: string;
}

let assetsPromise: Promise<RevealAssets> | null = null;
const themeCache = new Map<string, string>();

/** 懒加载并缓存 reveal 核心资产（同一次会话只拉一次） */
export function loadRevealAssets(): Promise<RevealAssets> {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      import('virtual:reveal-script'),
      import('virtual:reveal-css'),
    ]).then(([script, css]) => ({
      script: script.default,
      css: css.default,
    }));
  }
  return assetsPromise;
}

/**
 * 主题 CSS 白名单（与后端 `template.schema.ts` 的 ALLOWED_BASE_THEMES 保持一致）。
 * 动态 import 需要能被静态分析，所以写成显式映射表而不是拼路径。
 */
const THEME_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  simple: () => import('virtual:reveal-theme/simple'),
  serif: () => import('virtual:reveal-theme/serif'),
  sky: () => import('virtual:reveal-theme/sky'),
  night: () => import('virtual:reveal-theme/night'),
  dracula: () => import('virtual:reveal-theme/dracula'),
  moon: () => import('virtual:reveal-theme/moon'),
  league: () => import('virtual:reveal-theme/league'),
  beige: () => import('virtual:reveal-theme/beige'),
  solarized: () => import('virtual:reveal-theme/solarized'),
  blood: () => import('virtual:reveal-theme/blood'),
};

export const REVEAL_THEMES = Object.keys(THEME_LOADERS);

/** 取主题 CSS（未知主题回落到 simple，不抛错——历史 deck 不该因为主题名失效就打不开） */
export async function loadThemeCss(theme: string): Promise<string> {
  const key = THEME_LOADERS[theme] ? theme : 'simple';
  const cached = themeCache.get(key);
  if (cached !== undefined) return cached;
  const css = (await THEME_LOADERS[key]()).default;
  themeCache.set(key, css);
  return css;
}
