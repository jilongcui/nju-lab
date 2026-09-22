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
