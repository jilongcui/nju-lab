# 学生端插件包（artifacts）

## `nju-lab-client-plugin-win-x64.zip`

**Windows 学生端的「插件包」**：不是完整安装包，只装插件本身（`nju-lab-client`），
装进学生**已经在用的 DSH**（含官方桌面版），不需要 WSL、不需要全局装 dsh CLI、不需要新建 profile。

用法见平台「客户端下载」页（`/lab/student/client`）：解压到固定目录 → DSH 设置 → 插件 →
「添加插件」指向该目录 → 填 token。

### 内容

```
nju-lab-client/
  package.json          依赖已按 0.2.2 对齐（dsh-tools 0.2.2-rc.1 / cordis ~4.1.0 / schemastery ~3.19.0）
  cordis.patch.yml      serverUrl 预填 https://medai.nju.edu.cn/lab/api
  kit-version.json      与 build-kit.sh 同源的版本凭据（面板「立即更新」靠它比对）
  lib/                  host + client 两半的构建产物
  node_modules/         已内置（win32-x64 原生二进制），所以解压后不需要联网装包
  pnpm-lock.yaml
```

### 怎么生成的（Windows 机器上）

```powershell
# 在仓库的 dsh/nju-lab-client 里（版本已对齐 0.2.2）
npm ci
npm run build
mkdir C:\nju-lab && cd DSH_KIT
# 打包：把 nju-lab-client 整个目录（含 node_modules）压进 zip，另附一份安装说明
```

> ⚠️ 目前**只能在 Windows 上构建**：`node_modules` 里有 `node-addon-require-builtin-win32-x64-msvc`
> 这类平台特定产物。想在 Linux 上产出同一份，需要 `npm ci --os=win32 --cpu=x64`（未验证）。

### 更新与回滚

- 学生侧：右侧 NJU-Lab 面板「发现新版本 → 立即更新」会从 `/kit/nju-lab-student-kit.zip`
  取同一份插件并**只覆盖 `lib/`**（`node_modules` 保留），所以插件包的依赖不会被冲掉。
- 平台侧：直接替换 `/var/www/lab/kit/nju-lab-client-plugin-win-x64.zip`（保留旧文件做 `.bak`）。
