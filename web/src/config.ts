/**
 * 部署前缀工具。vite 构建时通过 `VITE_BASE` 注入（默认 '/'）；
 * 子目录部署（如 https://medai.nju.edu.cn/lab/）用 `VITE_BASE=/lab/ npm run build`。
 * `import.meta.env.BASE_URL` 恒以 '/' 结尾。
 */
export const BASE_URL = import.meta.env.BASE_URL;

/** 拼接部署前缀：withBase('api') → '/api'（根部署）或 '/lab/api'（子目录） */
export function withBase(path: string): string {
  const p = path.startsWith('/') ? path.slice(1) : path;
  return `${BASE_URL}${p}`;
}

/** 服务端返回的 url 字段（形如 /api/files/<id>）转换为带部署前缀的路径 */
export function apiUrl(path: string): string {
  return path.startsWith('/api/') ? withBase(`api/${path.slice(5)}`) : path;
}

/**
 * 站点名（侧边栏、登录页、浏览器标签都用它）。
 *
 * 怎么改：**构建时**给一个环境变量即可 —— `VITE_APP_NAME='分子医学 AI 实验室' npm run build`，
 * 或在 `web/.env.local`（不进仓库）里写 `VITE_APP_NAME=…`；不设则用下面的默认值。
 * 为什么放在构建期而不是后端下发：站点名出现在浏览器标签、登录页（未登录、拿不到后端配置）
 * 这些地方，构建期注入是唯一能覆盖全部场景的时机。
 */
export const APP_NAME: string = (import.meta.env.VITE_APP_NAME as string | undefined) || '分子医学AI实验室';
