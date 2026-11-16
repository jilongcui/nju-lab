<#
NJU-Lab 学生端 —— Windows 引导安装（WSL2 路线）

用法（在本文件所在目录，即解压后的安装包目录里）：
    powershell -ExecutionPolicy Bypass -File .\install.ps1

做四件事：
  0. 先说明另一条更省事的路：**如果你已经有 DSH（含官方桌面版）**，不需要本脚本 ——
     在 DSH 里「设置 → 插件 → 添加插件」指向平台下载页的插件包目录即可；
     本脚本是另一条：把完整 DSH 装进 WSL2（自测口径与平台复验完全一致）；
  1. 检查这台机器有没有可用的 WSL2 发行版；
  2. 有 → 先确认 WSL 里装了 Node.js 22+（install.sh 只检查、不代装，这是最常见的卡点）；
  3. 把本安装包复制进 WSL 的家目录，在里面跑现成的 install.sh
     （Node / pnpm / DSH / profile / 插件全部装在 WSL 里，与 macOS/Linux 完全同一条路径），
     装完再跑一次 check.sh --install 自检，当场告诉你成没成；
  4. 没有 WSL → 打印开启 WSL 的确切步骤（需要管理员 + 重启一次），不替你改系统。

为什么走 WSL 而不是原生 Windows：
  实验材料（python 脚本 + 判据）与平台复验容器都是 Linux 口径，WSL 里跑能保证
  "学生自测条件 = 复验条件"。平台的浏览器「实验环境」页则是零安装的另一条路。

参数：
  -Distro <名称>   指定 WSL 发行版（默认取 `wsl -l -q` 里的第一个）
#>
[CmdletBinding()]
param(
  [string]$Distro = ''
)

$ErrorActionPreference = 'Stop'

function Say([string]$msg) { Write-Host "[nju-lab] $msg" -ForegroundColor Cyan }
function Warn([string]$msg) { Write-Host "[nju-lab] $msg" -ForegroundColor Yellow }
function Die([string]$msg) { Write-Host "[nju-lab] $msg" -ForegroundColor Red; exit 1 }

if ($env:OS -ne 'Windows_NT') {
  Die '这个脚本是给 Windows 用的；macOS / Linux 请运行 ./install.sh'
}

$kitDir = $PSScriptRoot
if (-not (Test-Path (Join-Path $kitDir 'install.sh'))) {
  Die "安装包不完整：$kitDir 里没有 install.sh —— 请重新解压完整的 nju-lab-student-kit.zip"
}

Say '这是 Windows 引导安装脚本：把环境装进 WSL2（Linux 子系统）里。'
Say '如果你不想装 WSL，也可以直接用平台左侧菜单的「实验环境」（浏览器即用，免安装）。'
Warn '如果你只是想在已有的 DSH（含桌面版）里做实验，不用跑本脚本：在 DSH 里「设置 → 插件 →'
Warn '添加插件」指向平台下载页的插件包目录即可。本脚本是另一条路：把完整 DSH 装进 WSL2。'

# ---- 1. 检查 wsl.exe ----
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  Warn '这台机器上没有 WSL。开启方式（需要管理员权限，装完要重启一次）：'
  $help = @'

  1) 开始菜单 → 搜索 "PowerShell" → 右键「以管理员身份运行」
  2) 执行：  wsl --install
     （Windows 10 2004+ / Windows 11 支持；会自动启用所需的 Windows 功能并安装 Ubuntu）
  3) 重启电脑，首次进入 Ubuntu 时按提示设置 Linux 用户名与密码
  4) 回到本安装包目录，重新运行：
        powershell -ExecutionPolicy Bypass -File .\install.ps1

  更老的 Windows 10 请改用：
     dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
     dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
     重启后安装内核更新包，再到 Microsoft Store 安装 Ubuntu

'@
  Write-Host $help -ForegroundColor Gray
  exit 1
}

# wsl.exe 的输出是 UTF-16LE，PowerShell 读进来会带 NUL 字符，必须清掉
function Get-WslDistros {
  $raw = & wsl.exe -l -q 2>$null
  if ($LASTEXITCODE -ne 0) { return @() }
  return @($raw | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ -ne '' })
}

# 必须用 @(...) 兜一层：只有**一个**发行版时，函数返回值会被 PowerShell 拆成
# 裸字符串，`$distros[0]` 就变成取首字符（"U"），后面所有 `wsl -d U` 全失败。
# 这是 2026-11-15 用假 wsl.exe 实测出来的坑。
$distros = @(Get-WslDistros)
if ($distros.Count -eq 0) {
  Warn 'WSL 已启用，但还没有任何 Linux 发行版。安装方式（需要管理员权限）：'
  $help2 = @'

  1) 以管理员身份打开 PowerShell
  2) 执行：  wsl --install -d Ubuntu
  3) 首次进入时按提示设置 Linux 用户名与密码
  4) 回到本安装包目录，重新运行本脚本

'@
  Write-Host $help2 -ForegroundColor Gray
  exit 1
}

$target = $Distro
if ([string]::IsNullOrWhiteSpace($target)) {
  $target = $distros[0]
  if ($distros.Count -gt 1) {
    Say ("检测到多个 WSL 发行版：" + ($distros -join ', ') + "；本次使用 $target（可用 -Distro 指定别的）")
  }
} elseif ($distros -notcontains $target) {
  Die ("没有名为 $target 的 WSL 发行版；现有：" + ($distros -join ', '))
}
Say "使用 WSL 发行版：$target"

# ---- 2. 先确认 WSL 里有 Node.js 22+ ----
# install.sh 只检查、不代装。在这里挡住，学生拿到的是一段可直接粘贴的命令，
# 而不是 WSL 深处的一句 bash 报错。
Say '检查 WSL 里的 Node.js（需要 22 或更高，安装脚本不会代装）…'
$nodeProbe = 'if command -v node >/dev/null 2>&1; then node -p ''process.versions.node.split(".")[0]''; else echo MISSING; fi'
$nodeMajor = (@(& wsl.exe -d $target -- bash -lc $nodeProbe 2>$null | ForEach-Object { ($_ -replace "`0", '').Trim() }) -join '')

if ($nodeMajor -eq 'MISSING' -or [string]::IsNullOrWhiteSpace($nodeMajor)) {
  Warn "WSL（$target）里没有 node。请先在 WSL 终端里安装（三行，整段粘贴）："
  $nodeHelp = @'

  1) PowerShell 里执行：  wsl -d __DISTRO__
     （或开始菜单里的 Ubuntu）
  2) 在 Ubuntu 里逐行执行：
       curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
       sudo apt-get install -y nodejs
       node -v            # 应输出 v22 或更高
  3) 回到本安装包目录，重新运行：
       powershell -ExecutionPolicy Bypass -File .\install.ps1

'@
  Write-Host ($nodeHelp -replace '__DISTRO__', $target) -ForegroundColor Gray
  exit 1
}

$nodeOk = $false
if ($nodeMajor -match '^\d+$') { $nodeOk = ([int]$nodeMajor -ge 22) }
if (-not $nodeOk) {
  Warn "WSL（$target）里 Node.js 版本是 $nodeMajor，需要 22+。升级方式（在 WSL 里执行）："
  Write-Host @'

    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
    node -v

  装完回到本安装包目录，重新运行本脚本。

'@ -ForegroundColor Gray
  exit 1
}
Say "WSL 里的 Node.js 主版本：$nodeMajor ✓"

# ---- 3. 把安装包复制进 WSL 家目录（不直接在 /mnt/c 上装：慢，且权限位不可靠）----
$wslKit = (& wsl.exe -d $target -- wslpath -a "$kitDir" 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($wslKit)) {
  Die "无法把安装包路径转成 WSL 路径（$kitDir）—— 请确认该目录在本地盘上，而不是网络驱动器"
}
Say "安装包位置（WSL 视角）：$wslKit"

$remoteKit = '~/nju-lab-student-kit'
$copyCmd = 'rm -rf ' + $remoteKit + ' && mkdir -p ' + $remoteKit + ' && cp -a "' + $wslKit + '/." ' + $remoteKit + '/'
Say '正在把安装包复制到 WSL 家目录…'
& wsl.exe -d $target -- bash -lc $copyCmd
if ($LASTEXITCODE -ne 0) { Die '复制失败。可手动开 WSL 终端，把该目录解压到家目录后再运行 bash install.sh' }

# ---- 4. 在 WSL 里跑现成的 install.sh ----
Say '开始在 WSL 里安装（pnpm / DSH / profile / 插件）…'
& wsl.exe -d $target -- bash -lc 'cd ~/nju-lab-student-kit && bash install.sh'
if ($LASTEXITCODE -ne 0) {
  Die 'WSL 里安装失败（上面的输出有原因）。可开 WSL 终端手动重跑：cd ~/nju-lab-student-kit && bash install.sh'
}

# ---- 5. 装完自检（决定"能用/不能用"的关键一步，别只看安装脚本有没有报错）----
Say '自检：确认插件真的进了 profile、dsh 版本对不对…'
& wsl.exe -d $target -- bash -lc 'cd ~/nju-lab-student-kit && bash check.sh --install'
$checkOk = ($LASTEXITCODE -eq 0)
if (-not $checkOk) {
  Warn '自检有失败项（见上面的 [FAIL] 行）。把这段输出贴给老师即可定位，不用自己猜。'
}

Write-Host ''
if ($checkOk) { Say '安装完成，自检通过。' } else { Say '安装已完成，但自检未全通过（见上）。' }
Say '后续使用步骤：'
$next = @"

  1) 打开 WSL 终端（开始菜单里的 Ubuntu，或在 PowerShell 里执行  wsl -d $target）
  2) 启动 DSH：   dsh --profile nju-lab-student
     浏览器没自动打开的话，把终端里打印的地址（http://127.0.0.1:.../?token=...）复制到浏览器
     （WSL2 与 Windows 共用 127.0.0.1，用 Windows 的浏览器打开就行）
  3) 首次使用：设置 → Plugins →「NJU-Lab 平台」
       serverUrl 与 token 见平台「客户端下载」页（token 在右上角头像 → API Token 生成）
  4) 做实验：让 AI「列出我的实验任务」→「领取」→ 开发 → 自测 →「提交」

  ⚠️ 实验文件请放在 WSL 里的家目录（例如 ~/lab），**不要放在 /mnt/c（Windows 盘）** ——
     那样既慢，文件和权限也不可靠。
  ⚠️ 全程要在校园网或校内 VPN 下，否则平台的 API 会被网关拦去认证页（提交必失败）。

  任何时候出问题，先跑一次自检，把输出贴给老师：
       wsl -d $target -- bash -lc 'cd ~/nju-lab-student-kit && bash check.sh'

"@
Write-Host $next -ForegroundColor Gray
