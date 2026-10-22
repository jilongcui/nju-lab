<#
NJU-Lab 学生端 —— Windows 引导安装（WSL2 路线）

用法（在本文件所在目录，即解压后的安装包目录里）：
    powershell -ExecutionPolicy Bypass -File .\install.ps1

做三件事：
  1. 检查这台机器有没有可用的 WSL2 发行版；
  2. 有 → 把本安装包复制进 WSL 的家目录，并在里面跑现成的 install.sh
     （Node / pnpm / DSH / profile / 插件全部装在 WSL 里，与 macOS/Linux 完全同一条路径）；
  3. 没有 → 打印开启 WSL 的确切步骤（需要管理员 + 重启一次），不替你改系统。

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

$distros = Get-WslDistros
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

# ---- 2. 把安装包复制进 WSL 家目录（不直接在 /mnt/c 上装：慢，且权限位不可靠）----
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

# ---- 3. 在 WSL 里跑现成的 install.sh ----
Say '开始在 WSL 里安装（Node / pnpm / DSH / profile / 插件）…'
& wsl.exe -d $target -- bash -lc 'cd ~/nju-lab-student-kit && bash install.sh'
if ($LASTEXITCODE -ne 0) {
  Die 'WSL 里安装失败（上面的输出有原因）。可开 WSL 终端手动重跑：cd ~/nju-lab-student-kit && bash install.sh'
}

Write-Host ''
Say '安装完成。后续使用步骤：'
$next = @"

  1) 打开 WSL 终端（开始菜单里的 Ubuntu，或在 PowerShell 里执行  wsl -d $target）
  2) 启动 DSH：   dsh --profile nju-lab-student
     浏览器没自动打开的话，把终端里打印的地址（http://127.0.0.1:.../?token=...）复制到浏览器
  3) 首次使用：设置 → Plugins →「NJU-Lab 平台」
       serverUrl 与 token 见平台「客户端下载」页（token 在右上角头像 → API Token 生成）
  4) 做实验：让 AI「列出我的实验任务」→「领取」→ 开发 → 自测 →「提交」

  ⚠️ 实验文件请放在 WSL 里的家目录（例如 ~/lab），**不要放在 /mnt/c（Windows 盘）** ——
     那样既慢，文件和权限也不可靠。

"@
Write-Host $next -ForegroundColor Gray
