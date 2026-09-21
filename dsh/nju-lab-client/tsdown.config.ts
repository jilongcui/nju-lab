import { defineConfig } from 'tsdown'

// host 半与 client 半分开打包：
//  - host 半是 Node 模块（平台 API、工具、条件锁定）。
//  - client 半是浏览器模块（React slot 组件），由 dsh 的 client-modules 服务按
//    package.json 的 dsh.client 声明扫描并挂载；必须导出到 exports["./client"]。
export default defineConfig([
  {
    entry: ['src/host/index.ts'],
    outDir: 'lib/host',
    format: ['esm'],
    platform: 'node',
    dts: true,
  },
  {
    entry: ['src/client/index.tsx'],
    outDir: 'lib/client',
    format: ['esm'],
    platform: 'browser',
    dts: true,
    // react 由 DSH 的模块 loader 在运行时提供（client 半代码里是 require("react")），
    // 必须外部化：打包进来会让页面上出现第二份 React，hooks 直接崩。
    external: [/^@deepseek-ai\/dsh-client-/, 'react', 'react/jsx-runtime', 'react-dom'],
  },
])
