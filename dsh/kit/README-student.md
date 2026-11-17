# NJU-Lab 学生端使用手册

在本手册指导下，你将在自己的电脑上装好实验环境（DSH + NJU-Lab 插件），之后全部实验都在本地 DSH 中完成。

## 1. 安装（约 5 分钟）

> **Windows 用户先看这里** —— 有三条路：
>
> **⓪ 已经有 DSH 的（含官方桌面版）—— 最省事**：不用跑本安装包，直接在 DSH 里
> 设置 → 插件 → 「添加插件」，指向平台「客户端下载」页那个
> `nju-lab-client-plugin-win-x64.zip` 解压出来的目录即可。插件是同一个 `nju-lab-client`，
> 依赖已内置，右侧栏立刻出现「NJU-Lab 平台」。
>
> **① 不想在自己电脑上装任何东西（最省事）**：登录平台 → 左侧菜单「**实验环境**」→「启动」。
> 浏览器里就是一个完整的 DSH（含 python / pandas / torch 等依赖），做实验、提交都走同一个平台账号。
> 环境里的文件请放在 `/workspace`（持久卷，容器回收/重建后仍在）。
>
> **② 想在自己电脑上用本地 DSH**：用安装包里的 `install.ps1` 把环境装进 **WSL2**
> （Windows 的 Linux 子系统）—— 细节见下面的 §1.1。**这条路的自测口径与平台复验完全一致**
> （实验脚本与判据都是 Linux 口径）。

1. 安装 **Node.js 22 或更高版本**（https://nodejs.org，或学校镜像）。已有可跳过。
2. 从平台下载安装包 `nju-lab-student-kit.zip`（平台左侧菜单「客户端下载」），解压。
3. 在解压目录运行：
   ```sh
   ./install.sh        # macOS / Linux
   ```
   脚本会自动：检查 Node → 装 pnpm → 装 DSH CLI（基线 0.2.2-rc.1，0.2.x 均可）→ 装学生 profile 与插件 → 装依赖。
   机房电脑已预装，跳过本步。

## 1.1 Windows（WSL2）

安装包里带一个引导脚本 `install.ps1`：它**不替你改系统**，只做四件事 —— 检查 WSL2 是否可用、
确认 WSL 里装了 Node.js 22+、把安装包复制进 WSL 的家目录、在里面跑现成的 `install.sh`
（所以 Node / DSH / 插件全装在 WSL 里），装完再做一次自检把结果摆给你看。

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
4. 如果脚本提示 **WSL 里没有 Node（或版本太低）**：先在 WSL 终端里装（三行，整段粘贴）：
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v          # 应输出 v22 或更高
   ```
   Ubuntu 自带的 `nodejs` 一般是 12/18，**不够**；装完回到第 2 步重跑脚本。
5. 装完后日常使用：
   ```powershell
   wsl -d Ubuntu          # 打开 WSL 终端（开始菜单里的 Ubuntu 也行）
   dsh --profile nju-lab-student
   ```
   浏览器没自动打开时，把终端里打印的 `http://127.0.0.1:.../?token=...` 复制到浏览器 ——
   **WSL2 与 Windows 共用 `127.0.0.1`**，所以直接用 Windows 上的浏览器打开就行。
6. ⚠️ **实验文件放在 WSL 的家目录**（例如 `~/lab`），不要放在 `/mnt/c`（Windows 盘）：
   那样既慢，文件权限与 `chmod` 也不可靠。
7. ⚠️ **全程要在校园网或校内 VPN 下**：平台在校外会被网关拦去统一认证页，表现就是
   「提交失败 / 401 / 302」，跟 Windows 本身无关。

## 1.2 装完自检（出问题先跑这个）

安装包里有 `check.sh`。它只**读**不**改**，把该看的都看一遍：

```bash
bash ~/nju-lab-student-kit/check.sh      # 完整自检：安装 + token + 能不能连上平台
bash ~/nju-lab-student-kit/check.sh --install   # 只查安装完整性
```

输出里 `[FAIL]` 是要解决的，`[WARN]` 多是"token 还没填"。**遇到任何问题，先跑一次，把输出贴给老师** ——
它一次就能分清是插件没装上、token 失效、不在校园网，还是被 WAF 拦了，不用来回猜。

## 1.3 备选：不用引导脚本的两种装法

`install.ps1` 只是个**摆渡脚本**，真正干活的永远是 `install.sh` —— 所以下面两条路和它是等价的。

### 1.3.1 在 WSL 里手敲（`install.ps1` 出问题时的退路）

1. 把 `nju-lab-student-kit.zip` 解压到 Windows 本地盘，记下路径，例如 `C:\Users\你\Downloads\nju-lab-student-kit`。
2. 打开 WSL 终端（开始菜单里的 Ubuntu，或 PowerShell 里 `wsl -d Ubuntu`），**先复制到家目录再装**
   （不要直接在 `/mnt/c` 上装：慢，权限位也不可靠）：

   ```bash
   rm -rf ~/nju-lab-student-kit
   cp -a "/mnt/c/Users/你/Downloads/nju-lab-student-kit" ~/
   cd ~/nju-lab-student-kit && bash install.sh
   ```

   > 路径里的中文和空格都没关系，加引号即可；`你` 换成你的 Windows 用户名。
3. 自检（应当全绿，或只剩 token / serverUrl 未填的 `[WARN]`）：

   ```bash
   bash check.sh --install
   ```

### 1.3.2 交给 DSH 里的 AI（不想碰命令的话）

前提：你已经在 WSL 里装好 dsh，并且**会话工作区是家目录 `~`**（否则沙箱不允许写 `~/.dsh`）。

1. 把安装包里的 `INSTALL-by-ai.md` 拖进 DSH 对话框；
2. 说一句「**按 INSTALL-by-ai.md 装**」—— 里面是固定命令 + 硬约束，AI 只会执行 `bash install.sh`，
   遇到缺 node / 权限不足会停下来告诉你，不会自己乱试；
3. 装完 `exit` 退出，重新 `dsh --profile nju-lab-student`。

## 2. 首次配置（只做一次）

1. 浏览器登录平台 https://lab.xiaohe.biz → 右上角头像 →「API Token」→「生成 token」→ 复制。
2. 终端启动：`dsh --profile nju-lab-student`，浏览器自动打开（或手动打开提示的地址）。
3. 打开 设置（左下 Settings）→ Plugins →「NJU-Lab 平台」卡片：
   - `serverUrl`：`https://lab.xiaohe.biz/api`
   - `token`：粘贴第 1 步的 token

> token 有效期 365 天。泄露后在平台「API Token」弹窗点「全部吊销」即可全部作废。

## 2.5 装实验依赖（torch / scikit-learn / matplotlib…）

平台把教学常用包**镜像在平台自己身上**。配一次之后，**所有 `pip install` 默认走「本站优先 → 清华镜像兜底」**，
不再直连境外 PyPI：

```bash
python -m pip config set global.index-url https://medai.nju.edu.cn/lab/pypi/simple
python -m pip config set global.extra-index-url https://pypi.tuna.tsinghua.edu.cn/simple
```

撤销：`python -m pip config unset global.index-url`（另一条同理）。只想这一次用、不改配置：

```bash
python -m pip install --index-url https://medai.nju.edu.cn/lab/pypi/simple \
    --extra-index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    torch==2.14.1+cpu scikit-learn matplotlib pandas numpy
```

> **torch 一定要写 `torch==2.14.1+cpu`**：清华镜像上的 Windows/Linux torch 是 CUDA 版，会带几百 MB 的
> `nvidia-*` 依赖；`+cpu` 只有本站有，所以 pip 会只从本站取。

- 覆盖 **Windows x64 / macOS（Apple 芯片、Intel）/ Linux x64** × **Python 3.12 / 3.13**，
  依赖（sympy / filelock / pillow / joblib…）已一并收录，不用再连外网。
- Linux 上的 torch 是 **CPU 版**（`+cpu`，与平台复验容器同源），不会拽 CUDA 那一大坨。
- **Intel Mac 的 torch 上游停在 2.2.2**（不再出新版），所以那个平台不提供 torch；
  要做深度学习实验请用浏览器「实验环境」。
- 只收录了实验真正用到的那几类；缺什么包告诉老师，补进索引后同一条命令即可（`--upgrade` 或指定版本）。

索引页可以直接在浏览器打开：`https://medai.nju.edu.cn/lab/pypi/simple/`

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

- **我用的是 DSH 桌面版，能不能做实验？** 能 —— 用「设置 → 插件 → 添加插件」装上
  `nju-lab-client-plugin-win-x64.zip` 里的插件目录即可（见平台「客户端下载」页），
  插件依赖已内置、不用建 profile。注意桌面版会自动升级，跨大版本时如遇异常装回匹配版本。
  （本手册讲的 `install.ps1` 是另一条路：把完整 DSH 装进 WSL2，口径与平台复验完全一致。）
- **出任何问题第一步**：`bash ~/nju-lab-student-kit/check.sh`，把输出贴给老师（见 §1.2）。
- **插件有新版本**：面板顶部会出现「发现新版本插件 → 立即更新」，点一下即可，**不用重新下载安装包**；更新完退出 dsh 重新启动生效。（只有很旧的安装没有这个能力，那时才需要重下安装包。）
- **`dsh: command not found`**：重开终端，或确认 npm 全局 bin 在 PATH（`npm prefix -g`）。
- **工具调用返回 401**：token 未配或已失效 → 重新在平台生成并更新设置。
- **提交时返回 403**：校园 WAF 拦了请求体。先确认安装包是最新版（新版对上传做了规避），仍不行联系老师。
- **请求被重定向 / 落到统一认证页（302）**：你不在校园网也没连校内 VPN —— 连上再试。
- **领取按钮灰色/工具提示未解锁**：先完成该实验之前章节的课程学习。
- **pnpm 安装失败 / 卡在 corepack 下载 pnpm**：corepack 默认从 registry.npmjs.org 下载 pnpm 本体，网络不通会超时。先 `npm i -g pnpm` 手动装一次再重跑 `install.sh` 即可。
- **pnpm 装不上、报权限错（`EACCES` / 全局目录不可写）**：apt 装的 Node 会把全局目录指到系统路径。
  `install.sh` 现在会自动退到用户态前缀 `~/.local`；若仍失败，手动执行
  `npm i -g --prefix "$HOME/.local" pnpm && export PATH="$HOME/.local/bin:$PATH"` 再重跑。
- **版本问题**：本学期以 `0.2.2-rc.1` 为基线，**0.2.x 各版本（含 rc）都能用** —— 安装脚本遇到
  `0.2.0-rc.2` 或更新版本会直接沿用，不再强制重装；只有 `0.1.x` 这类更老的才会被纠正。
  （实测：`dsh@0.2.2-rc.3` 上插件的 6 项端到端测试全通过。）
- **Windows：提示「禁止运行脚本」**（`about_Execution_Policies`）：用 `powershell -ExecutionPolicy Bypass -File .\install.ps1` 运行（只对这一条命令生效），或先 `Unblock-File .\install.ps1`。
- **Windows：`wsl --install` 报错 / 装完打不开 Ubuntu**：多为 BIOS 里没开虚拟化（VT-x / SVM）或没重启。
  先在任务管理器 →「性能 → CPU」看「虚拟化：已启用」；再说 `wsl --update` 更新一次内核。
- **Windows：装完 `install.ps1` 提示「使用 WSL 发行版：U」这类怪名字**：那是很旧的安装包（单发行版
  名称被截成首字符的 bug，2026-11-15 已修）。重下最新安装包即可。
- **Windows：WSL 里 `dsh` 提示模型 key 缺失**：那是 DSH 自身的模型配置，与平台 token 是两件事；
  工作台/本地都支持用环境变量预设（`DEEPSEEK_API_KEY` 等），具体 keys 找课程老师。
- **Windows：能用浏览器「实验环境」吗？** 能，且免安装 —— 只是没有本机 GPU、也不能自己装额外依赖。
