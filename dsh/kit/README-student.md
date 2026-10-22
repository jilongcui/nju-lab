# NJU-Lab 学生端使用手册

在本手册指导下，你将在自己的电脑上装好实验环境（DSH + NJU-Lab 插件），之后全部实验都在本地 DSH 中完成。

## 1. 安装（约 5 分钟）

> **Windows 用户先看这里** —— 有两条路，任选其一：
>
> **① 不想在自己电脑上装任何东西（最省事）**：登录平台 → 左侧菜单「**实验环境**」→「启动」。
> 浏览器里就是一个完整的 DSH（含 python / pandas / torch 等依赖），做实验、提交都走同一个平台账号。
> 环境里的文件请放在 `/workspace`（持久卷，容器回收/重建后仍在）。
>
> **② 想在自己电脑上用本地 DSH**：用安装包里的 `install.ps1` 把环境装进 **WSL2**
> （Windows 的 Linux 子系统）—— 细节见下面的 §1.1。这条路的自测口径与平台复验完全一致。

1. 安装 **Node.js 22 或更高版本**（https://nodejs.org，或学校镜像）。已有可跳过。
2. 从平台下载安装包 `nju-lab-student-kit.zip`（平台左侧菜单「客户端下载」），解压。
3. 在解压目录运行：
   ```sh
   ./install.sh        # macOS / Linux
   ```
   脚本会自动：检查 Node → 装 pnpm → 装 DSH CLI（锁定 0.2.0-rc.2）→ 装学生 profile 与插件 → 装依赖。
   机房电脑已预装，跳过本步。

## 1.1 Windows（WSL2）

安装包里带一个引导脚本 `install.ps1`：它**不替你改系统**，只做三件事 —— 检查 WSL2 是否可用、
把安装包复制进 WSL 的家目录、在里面跑现成的 `install.sh`（所以 Node / DSH / 插件全装在 WSL 里）。

1. 把 `nju-lab-student-kit.zip` 解压到本地盘（例如 `C:\Users\你\Downloads\`）。
2. 在该目录里打开 PowerShell，运行：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   （`-ExecutionPolicy Bypass` 只对这一条命令生效，不改系统设置。）
3. 如果脚本提示**没有 WSL**：按它输出的步骤执行一次
   ```powershell
   wsl --install          # 需管理员权限；Win10 2004+ / Win11
   ```
   然后**重启电脑**，首次进入 Ubuntu 时设置 Linux 用户名与密码，再回到第 2 步重跑。
4. 装完后日常使用：
   ```powershell
   wsl -d Ubuntu          # 打开 WSL 终端（开始菜单里的 Ubuntu 也行）
   dsh --profile nju-lab-student
   ```
   浏览器没自动打开时，把终端里打印的 `http://127.0.0.1:.../?token=...` 复制到浏览器。
5. ⚠️ **实验文件放在 WSL 的家目录**（例如 `~/lab`），不要放在 `/mnt/c`（Windows 盘）：
   那样既慢，文件权限与 `chmod` 也不可靠。

## 2. 首次配置（只做一次）

1. 浏览器登录平台 https://lab.xiaohe.biz → 右上角头像 →「API Token」→「生成 token」→ 复制。
2. 终端启动：`dsh --profile nju-lab-student`，浏览器自动打开（或手动打开提示的地址）。
3. 打开 设置（左下 Settings）→ Plugins →「NJU-Lab 平台」卡片：
   - `serverUrl`：`https://lab.xiaohe.biz/api`
   - `token`：粘贴第 1 步的 token

> token 有效期 365 天。泄露后在平台「API Token」弹窗点「全部吊销」即可全部作废。

## 3. 做一次实验

全部用自然语言让 AI 操作，它会自动调用 NJU-Lab 工具：

1. **看任务**：「列出我的实验任务」——能看到任务、解锁状态、截止时间
2. **领取**：「领取 <任务>」——模板与标准测试数据自动下载解压到工作区，评估条件（模型、工具集）被钉死
3. **开发**：在工作区 `skill/` 下的 Skill 目录里按模板 TODO 完成 SKILL.md 与脚本
4. **自测**：用随任务下发的题目包（题面 + 用例 + 期望值）运行你的 Skill，把结果填进 SKILL.md 实测档案
5. **提交**：「提交我的实验」——自动打包、生成证据包、登记文件哈希并上传
6. **看反馈**：教师复验批改后，在平台网页「我的提交与反馈」查看分数与评语

注意：**提交的截止时间以平台为准**；评估条件被平台统一钉死，不要试图绕过（绕过会导致自测与复验条件不一致，复验结果以平台为准）。

## 4. 常见问题

- **插件有新版本**：面板顶部会出现「发现新版本插件 → 立即更新」，点一下即可，**不用重新下载安装包**；更新完退出 dsh 重新启动生效。（只有很旧的安装没有这个能力，那时才需要重下安装包。）
- **`dsh: command not found`**：重开终端，或确认 npm 全局 bin 在 PATH（`npm prefix -g`）。
- **工具调用返回 401**：token 未配或已失效 → 重新在平台生成并更新设置。
- **领取按钮灰色/工具提示未解锁**：先完成该实验之前章节的课程学习。
- **pnpm 安装失败 / 卡在 corepack 下载 pnpm**：corepack 默认从 registry.npmjs.org 下载 pnpm 本体，网络不通会超时。先 `npm i -g pnpm` 手动装一次再重跑 `install.sh` 即可。
- **版本问题**：本学期 DSH 锁定 `0.2.0-rc.2`，**不要升级**，升级导致的异常请重装本安装包。
- **Windows：提示「禁止运行脚本」**（`about_Execution_Policies`）：用 `powershell -ExecutionPolicy Bypass -File .\install.ps1` 运行（只对这一条命令生效），或先 `Unblock-File .\install.ps1`。
- **Windows：`wsl --install` 报错 / 装完打不开 Ubuntu**：多为 BIOS 里没开虚拟化（VT-x / SVM）或没重启。
  先在任务管理器 →「性能 → CPU」看「虚拟化：已启用」；再说 `wsl --update` 更新一次内核。
- **Windows：WSL 里 `dsh` 提示模型 key 缺失**：那是 DSH 自身的模型配置，与平台 token 是两件事；
  工作台/本地都支持用环境变量预设（`DEEPSEEK_API_KEY` 等），具体 keys 找课程老师。
- **Windows：能用浏览器「实验环境」吗？** 能，且免安装 —— 只是没有本机 GPU、也不能自己装额外依赖。
