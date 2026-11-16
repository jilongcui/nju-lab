# 学生端插件包（artifacts）

这里放**插件包**的产物与说明。产物不入库（`.gitignore` 已忽略 `*.zip`），
用 `dsh/kit/build-plugin-zips.sh` 在任意 Linux/macOS 机器上生成，再投放 `/var/www/lab/kit/`。

## 什么是「插件包」

不是完整安装包，只装插件本身（`nju-lab-client`），装进学生**已经在用的 DSH**
（官方桌面版也行），不需要 WSL、不需要全局装 dsh CLI、不需要新建 profile。

用法见平台「客户端下载」页（`/lab/student/client`）：解压到固定目录 →
DSH 设置 → 插件 →「添加插件」指向该目录 → 填 token。

## 四个平台包（2026-11-16 起）

| 包 | 平台 | 原生 addon |
|---|---|---|
| `nju-lab-client-plugin-win-x64.zip` | Windows x64 | `node-addon-require-builtin-win32-x64-msvc` |
| `nju-lab-client-plugin-darwin-arm64.zip` | macOS Apple 芯片 | `…-darwin-arm64` |
| `nju-lab-client-plugin-darwin-x64.zip` | macOS Intel | `…-darwin-x64` |
| `nju-lab-client-plugin-linux-x64.zip` | Linux x64 | `…-linux-x64-gnu` |

**插件代码完全一样**（纯 JS：`lib` 只 import `@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`
与 node 内置模块）。唯一平台相关的是依赖树里那一颗原生 addon ——
它来自 `@deepseek-ai/cordis-plugin-loader → node-addon-require-builtin`（9 个平台变体）。
所以「同一份代码 + 各平台各一份依赖树」，装错平台会在加载时报找不到原生模块。

## 怎么生成

```sh
cd dsh/kit
(cd ../nju-lab-client && npm ci && npm run build)   # 先出 lib/
PLATFORM_URL=https://medai.nju.edu.cn/lab ./build-kit.sh   # 顺带定下 kit-version（与安装包共用）
./build-plugin-zips.sh                              # 四个平台包 → dist/plugin/*.zip
```

**不需要 Windows / macOS 机器**：脚本用 npm 的交叉安装
（`npm ci --omit=dev --os=win32 --cpu=x64`）在 Linux 上装出各平台的依赖树，
并逐个校验「该平台的原生 addon 真的在」。

`--omit=dev` 是刻意的：`devDependencies`（`dsh-agent` / `dsh-session` / `dsh-client-*` 等 22 个包）
运行时用不到，带上会让包从 ~2.6MB 涨到 ~4.2MB。

## 投放与回滚

```sh
cp dsh/kit/dist/plugin/*.zip /var/www/lab/kit/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/lab/kit/nju-lab-client-plugin-win-x64.zip   # 200
```

- 每个 zip 根下是 `nju-lab-client/` + `INSTALL.md`（ASCII 文件名 + UTF-8 内容，三平台解压都不乱码）。
- 回滚：把旧 zip 覆盖回 `/var/www/lab/kit/` 即可（保留 `.bak`）。
- 学生侧更新：面板「发现新版本 → 立即更新」从 `/kit/nju-lab-student-kit.zip` 取同一份插件，
  **只覆盖 `lib/`**，`node_modules/` 保留 —— 所以插件包的依赖不会被冲掉。

## 已知限制

- macOS / Linux 包只做到「交叉生成依赖树 + Linux 上 import 验证」，**没做真机端到端**
  （跑一次「列出我的实验任务」需要真机 + token）。
- Linux 没有官方桌面版：Linux 学生要先用 `npm i -g @deepseek-ai/dsh` 装 CLI，再添加插件。
