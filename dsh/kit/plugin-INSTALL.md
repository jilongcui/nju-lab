# NJU-Lab 学生端插件包（`__PLATFORM__`）

这个包装的是**插件**（`nju-lab-client`），装进你已经在用的 DSH ——
不需要 WSL、不需要全局装 dsh 命令行、不需要新建 profile。
依赖已经打进去了，解压后不需要联网装包。

## 1. 解压到一个固定的位置

- **Windows**：`C:\nju-lab\nju-lab-client`
- **macOS / Linux**：`~/nju-lab/nju-lab-client`

解压后确认里面有 `package.json`、`cordis.patch.yml`、`lib/`、`node_modules/`。

> ⚠️ 这个目录之后不要随手删或移动 —— DSH 是**链接**到它的，挪走插件就失效。

## 2. 在 DSH 里添加插件

打开 DSH → 左下角 **设置（齿轮）** → **插件** → 右上角 **「添加插件 / Add plugin」**
→ 选择（或输入）上面那个目录路径。

装好后插件列表里会出现 **nju-lab-client**，状态应为「已启用」。

## 3. 填 token

**设置 → 插件 → 「NJU-Lab 平台」**：

- `serverUrl`：已预填 `https://medai.nju.edu.cn/lab/api`，一般不用改
- `token`：平台右上角头像 →「API Token」→ 生成后粘贴

保存即生效（这两个字段是实时的，不用重启 DSH）。

## 验证

在对话框里说一句 **「列出我的实验任务」** —— 能列出任务列表就说明整条链路通了
（token 有效、能连上平台、工具已注册）。

如果报「未配置平台 token」，就是第 3 步没保存成功。

## 说明与限制

- **适用版本**：DSH 0.2.x（本包依赖按 `0.2.2` 编译）。
- **口径提醒**：平台的实验判据与复验容器是 **Linux** 口径。在 Windows / macOS 本地做实验，
  自测条件可能与复验条件有差异（例如涉及 `bash`、`chmod`、Linux 路径的脚本）。
  需要严格一致时用平台左侧菜单的「**实验环境**」（浏览器里的 Linux 容器），或 Windows 上的 WSL2。
- **更新**：右侧 NJU-Lab 面板顶部出现「发现新版本 → 立即更新」时，点一下即可 ——
  它会从平台拉新包覆盖插件目录里的 `lib/`（`node_modules/` 保留），更新后重启 DSH 生效。
- **卸载**：设置 → 插件 → `nju-lab-client` → 移除。
- 包里**不含** token，也不含 profile 配置（`cordis.patch.yml` 属于 DSH 自己的 profile）。

## 关于平台包

本包是 `__PLATFORM__` 版。四个发行包（`win-x64` / `darwin-arm64` / `darwin-x64` / `linux-x64`）
里的**插件代码完全一样**（纯 JS），差别只有依赖树里那一颗平台相关的原生 addon
（`node-addon-require-builtin-<os>-<arch>`）。装错平台的话，插件会在加载时报找不到原生模块。
