import { readFile, writeFile } from 'node:fs/promises'
import { defineConfig } from 'tsdown'

// host 半与 client 半分开打包：
//  - host 半是 Node 模块（平台 API、工具、条件锁定）。
//  - client 半是浏览器模块（React slot 组件），由 dsh 的 client-modules 服务按
//    package.json 的 dsh.client 声明扫描并挂载；必须导出到 exports["./client"]。
//
// client 半的产物形态：dsh client-modules 的懒加载模型要求每个 client 入口是
// 自注册的 classic script —— 执行即调用 window.__ModuleLoader__.load({ id, factory })，
// 工厂体内是 CJS（require / module.exports），副作用在物化时才跑。combo 路由按
// 字节原样拼接产物，所以构建成 CJS 后在 build:done 包上这层外壳；发 ESM 会在
// 浏览器里直接 SyntaxError（import outside a module），整个 bundle 注册失败。
// 不用 rolldown 的 banner/footer 包：那会进入 dts 的 fake-js 解析，函数体内的
// import/export 会让它报错。
const LOADER_HEAD = [
  'window.__ModuleLoader__.load({',
  '\tid: "nju-lab-client",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
].join('\n')
const LOADER_TAIL = ['\t\treturn module.exports;', '\t}', '});'].join('\n')

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
    format: ['cjs'],
    platform: 'browser',
    dts: true,
    // react 由 DSH 的模块 loader 在运行时提供（client 半代码里是 require("react")），
    // 必须外部化：打包进来会让页面上出现第二份 React，hooks 直接崩。
    external: [/^@deepseek-ai\/dsh-client-/, 'react', 'react/jsx-runtime', 'react-dom'],
    // type:module 下 CJS 默认出 .cjs；这里强制 .js 以对齐 exports["./client"]
    // 与官方包的 client.js 约定（该文件只被 dsh 按字节读取，不经 Node 加载）。
    outExtensions: () => ({ js: '.js' }),
    hooks: {
      'build:done': async () => {
        const file = 'lib/client/index.js'
        const body = await readFile(file, 'utf8')
        await writeFile(file, `${LOADER_HEAD}\n${body.trimEnd()}\n${LOADER_TAIL}\n`)
      },
    },
  },
])
