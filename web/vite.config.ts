import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 把 reveal.js 的 dist 资源内联成 **virtual 模块**。
 *
 * 为什么不用常规写法：reveal 的 package.json `exports` **不导出 `./dist/*`**
 * （只有 "."、"./reveal.css"、"./theme/*"、"plugin/math"），实测
 *   · `import 'reveal.js/dist/reveal.js?raw'` → 被 exports 拦掉；
 *   · 用 alias 指到文件 + `?raw` → Vite 解析不了，Rollup 当成 external，**构建直接失败**。
 * virtual 模块完全绕开包解析：读文件 + `JSON.stringify` 返回，行为确定，
 * 且不需要把第三方文件拷进仓库。
 */
const REVEAL_DIST = new URL('./node_modules/reveal.js/dist/', import.meta.url).pathname;

/**
 * 读文件（构建期）。
 * 项目**刻意没装 @types/node**（同文件里既有的 `declare const process` 也是这个原因），
 * 所以用非字面量说明符动态导入 —— tsc 不会去解析它，运行期由 Vite 以 ESM 正常加载。
 */
async function readRevealFile(file: string): Promise<string> {
  const moduleName = 'node:fs';
  const fs = (await import(moduleName)) as unknown as {
    readFileSync: (path: string, encoding: 'utf8') => string;
  };
  return fs.readFileSync(file, 'utf8');
}

/** 与后端 template.schema.ts 的 ALLOWED_BASE_THEMES 保持一致（避开内嵌 564KB 字体的 black 系列） */
const REVEAL_THEMES = [
  'simple', 'serif', 'sky', 'night', 'dracula',
  'moon', 'league', 'beige', 'solarized', 'blood',
];

function revealRawPlugin() {
  return {
    name: 'reveal-raw-assets',
    resolveId(id: string) {
      if (id === 'virtual:reveal-script' || id === 'virtual:reveal-css') return '\0' + id;
      if (id.startsWith('virtual:reveal-theme/')) {
        const theme = id.slice('virtual:reveal-theme/'.length);
        if (REVEAL_THEMES.includes(theme)) return '\0' + id;
      }
      return null;
    },
    async load(id: string) {
      let file: string | null = null;
      if (id === '\0virtual:reveal-script') file = REVEAL_DIST + 'reveal.js';
      else if (id === '\0virtual:reveal-css') file = REVEAL_DIST + 'reveal.css';
      else if (id.startsWith('\0virtual:reveal-theme/')) {
        const theme = id.slice('\0virtual:reveal-theme/'.length);
        // 白名单校验，防路径穿越
        if (REVEAL_THEMES.includes(theme)) file = REVEAL_DIST + 'theme/' + theme + '.css';
      }
      if (!file) return null;
      return 'export default ' + JSON.stringify(await readRevealFile(file));
    },
  };
}

// 项目未装 @types/node；这里只需要 env 一个字段
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // 子目录部署（如 medai.nju.edu.cn/lab/）：VITE_BASE=/lab/ npm run build；默认根部署
  base: process.env.VITE_BASE || '/',
  plugins: [react(), revealRawPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
        },
      },
    },
  },
});
