# 让 DSH 自己装 NJU-Lab 学生端（可选路径）

> 这是给 **AI 看的指令**，也是给学生的说明。想用安装脚本的人不需要本文件 —— 直接看 `README.md`。

前提：你已经在 WSL2 / Linux / macOS 里装好 dsh（`dsh --version` 有输出）。

## 给学生（两句话）

1. 把本文件拖进 DSH 对话框，说「**按 INSTALL-by-ai.md 装**」；
2. 装完**退出 dsh 重开**：`dsh --profile nju-lab-student`（依赖变了，旧进程不会加载新插件）。

## 给 AI：先做 3 项前置检查，任何一项不合格就**停下并如实告知**，不要绕

1. `dsh --version` → 需要 `0.2.0-rc.2` 或更高的 `0.2.x`（含 rc；`0.2.2-rc.3` 已实测通过）。
   `0.1.x` 太老，插件没验证过。版本不对就告诉用户，**不要自行升级或降级**（`install.sh` 会处理）。
2. 当前会话工作区必须**覆盖家目录**：`touch ~/.dsh/.write-test && rm ~/.dsh/.write-test` 成功。
   失败说明沙箱边界不包含 `~/.dsh`（`workspace-write` 只允许会话工作区内的写入）——
   停，告诉用户「请在 `~` 下打开工作区，或改用 `install.ps1`」。
3. 本文件所在目录里必须有 `install.sh`。没有就停（安装包不完整）。

## 然后：只执行这一条（不要改写、不要拆开、不要替换成等价的 cp/pnpm 命令）

```bash
bash install.sh
```

它自带：Node ≥22 检查、pnpm 权限兜底、DSH 版本锁定、profile/插件幂等落位、末尾自检。
**手写一遍等价命令会丢掉这些保护。**

## 硬约束（违反任何一条都会让学生端不可用）

- 不要 `sudo`，不要 `npm i -g @deepseek-ai/dsh`（版本已锁 `0.2.0-rc.2`）
- 不要改 `install.sh`、`check.sh`、`cordis.patch.yml`
- 不要改 `serverUrl` / token 的默认值（属于学生自己的配置，装完在设置页填）
- 不要尝试提权或关闭沙箱（`danger-full-access` 在学生端是刻意禁用的）
- 失败时**不要**自行换一种装法重试，先回报

## 失败时按顺序回报

1. `bash install.sh` 的完整输出（原样，不要总结）
2. 再跑 `bash check.sh --install`，把它也原样贴出来
3. 一句话说明卡在哪一行

## 装完

告诉学生：`exit` 退出，重新 `dsh --profile nju-lab-student`，然后在 设置 → Plugins →
「NJU-Lab 平台」填 `serverUrl`（见平台「客户端下载」页）与个人 token。
