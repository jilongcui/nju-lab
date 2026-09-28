/**
 * virtual 模块的类型声明。
 *
 * 这些模块由 `vite.config.ts` 的 `revealRawPlugin` 在构建期生成：把 reveal.js 的
 * dist 资源读成字符串再 `export default`（因为 reveal 的 `exports` 不导出 `./dist/*`，
 * 常规 `?raw` / alias 写法都会被拦掉）。每个模块的默认导出都是**文件全文**。
 */

declare module 'virtual:reveal-script' {
  /** dist/reveal.js（UMD）源码全文 */
  const source: string;
  export default source;
}

declare module 'virtual:reveal-css' {
  /** dist/reveal.css 全文 */
  const source: string;
  export default source;
}

declare module 'virtual:reveal-theme/*' {
  /** dist/theme/<name>.css 全文（白名单见 vite.config.ts 与后端 ALLOWED_BASE_THEMES） */
  const source: string;
  export default source;
}
