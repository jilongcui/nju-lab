#!/usr/bin/env bash
# NJU-Lab 学生端一键安装：DSH CLI + nju-lab-student profile + nju-lab-client 插件
# 用法：解压安装包后  ./install.sh
#
# Windows 不要直接跑这个脚本 —— 用同目录的 install.ps1（它把包装进 WSL2 再跑这里）。
set -euo pipefail

DSH_VERSION="0.2.0-rc.2"   # 学期内锁定，不升级
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info() { printf '\033[1;34m[nju-lab]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[nju-lab]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[nju-lab] %s\033[0m\n' "$*" >&2; exit 1; }

# 是不是 WSL：报错文案要能直接照抄（Ubuntu 里没有 node 是最常见的卡点）
is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }

NODE_HINT_WSL='在 WSL 的 Ubuntu 终端里执行（三行，整段粘贴）：
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
    node -v          # 应输出 v22 或更高
  装完回到本目录重新运行：bash install.sh'
NODE_HINT_GENERIC='从 https://nodejs.org 或学校镜像安装 Node.js 22+，装完重新运行 ./install.sh'

# 1. Node.js 22+
if ! command -v node >/dev/null 2>&1; then
  if is_wsl; then fail "未找到 node。$NODE_HINT_WSL"; else fail "未找到 node。$NODE_HINT_GENERIC"; fi
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  if is_wsl; then
    fail "Node.js 版本过低（$(node -v)），需要 22+。$NODE_HINT_WSL"
  else
    fail "Node.js 版本过低（$(node -v)），需要 22+。$NODE_HINT_GENERIC"
  fi
fi
command -v npm >/dev/null 2>&1 || fail "未找到 npm —— Node 安装不完整，请重装 Node.js 22+"
info "Node.js $(node -v) ✓"

# 2. pnpm（dsh plugin install 需要）
# corepack 的 pnpm 只是 shim，首次运行要从 registry 下载本体，网络不通时会失败，
# 所以要验证 pnpm 真正可用，而不是只看 PATH 里有没有。
export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-$(npm config get registry)}"

# 把 ~/.local/bin 持久化进 PATH（幂等）。只在真的要装到那里时才调用。
ensure_local_bin_on_path() {
  export PATH="$HOME/.local/bin:$PATH"
  local rc="$HOME/.bashrc"
  [ -f "$rc" ] || return 0
  if ! grep -q 'nju-lab: ~/.local/bin' "$rc" 2>/dev/null; then
    printf '\n# nju-lab: ~/.local/bin\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    info "已把 ~/.local/bin 写进 ~/.bashrc（新开终端仍能找到 pnpm / dsh）"
  fi
}

if ! pnpm -v >/dev/null 2>&1; then
  info "pnpm 不可用（corepack 下载失败或未安装），改用 npm 安装…"
  GLOBAL_PREFIX="$(npm prefix -g 2>/dev/null || echo '')"
  # apt 装的 Node 会把全局目录指到 /usr/lib/node_modules（属 root）—— 普通用户写不进去。
  # 这种情况下退到用户态前缀，别让整条安装卡死在权限上。
  if [ -n "$GLOBAL_PREFIX" ] && { [ -w "$GLOBAL_PREFIX" ] || [ -w "$GLOBAL_PREFIX/lib" ]; }; then
    npm i -g pnpm
  else
    warn "npm 全局目录（${GLOBAL_PREFIX:-未知}）不可写 —— apt 装 Node 时很常见，改装到 ~/.local"
    npm i -g --prefix "$HOME/.local" pnpm
    ensure_local_bin_on_path
  fi
fi
pnpm -v >/dev/null 2>&1 || fail "pnpm 仍不可用。可手动执行：npm i -g --prefix \"\$HOME/.local\" pnpm && export PATH=\"\$HOME/.local/bin:\$PATH\""
info "pnpm $(pnpm -v) ✓"

# 3. DSH CLI（锁定版本）
#
# 判据：>= 0.2.0-rc.2 且 < 0.3.0 —— **0.2.x 全接受，含 rc/alpha**。
# 依据（2026-11-15 实测，不是推断）：在 `dsh@0.2.2-rc.3` 上跑插件的 L2 端到端
# （`DSH_BIN=... node --test test/dsh-e2e.test.mjs`）**6/6 通过** —— 插件加载、工具面收窄
# （`tools.restrict`）、claim 后即时受限、`.dshc` 证据导出、引导注入、跨进程钉定全部正常；
# 且 profile 里只有一份 `dsh-tools`，没有依赖分叉。
# 低于 0.2.0-rc.2（0.1.x / 0.2.0-rc.1）拒绝：插件依赖 `^0.2.0-rc.2`，更老的版本没验证过。
# 备注：平台侧的复验镜像仍是 0.2.0-rc.2（`nju-lab-verify:0.2.0-rc.2-pkg10`），
# 所以学生本地版本高低不影响"复验按哪套跑"，只是本地体验可能略有差异。
dsh_version_ok() {
  local v="${1#v}"
  case "$v" in
    0.2.0-rc.*)
      local n="${v##*.}"
      case "$n" in ''|*[!0-9]*) return 1 ;; esac
      [ "$n" -ge 2 ] ;;
    0.2.*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! command -v dsh >/dev/null 2>&1 || ! dsh_version_ok "$(dsh --version 2>/dev/null || true)"; then
  if command -v dsh >/dev/null 2>&1; then
    info "当前 dsh 是 $(dsh --version 2>/dev/null || echo '未知')（低于 0.2.0-rc.2），安装 @deepseek-ai/dsh@$DSH_VERSION …"
  else
    info "安装 @deepseek-ai/dsh@$DSH_VERSION …"
  fi
  npm i -g "@deepseek-ai/dsh@$DSH_VERSION"
fi
command -v dsh >/dev/null 2>&1 || fail "dsh 仍不在 PATH。若刚才装到了 ~/.local，请先执行：export PATH=\"\$HOME/.local/bin:\$PATH\"（新开终端即可）"
info "dsh $(dsh --version) ✓"

# 4. profile 与插件落位（幂等：先清旧版）
mkdir -p "$DSH_HOME/profiles"
rm -rf "$DSH_HOME/profiles/nju-lab-student" "$DSH_HOME/nju-lab-client"
cp -r "$KIT_DIR/nju-lab-student" "$DSH_HOME/profiles/nju-lab-student"
cp -r "$KIT_DIR/nju-lab-client" "$DSH_HOME/nju-lab-client"
info "profile 与插件已安装到 $DSH_HOME ✓"

# 5. 安装 profile 依赖（含本地插件）
dsh plugin --profile nju-lab-student install
info "依赖安装完成 ✓"

# 6. 现场自检（只查"装没装好"，不要求 token）。不通过也继续，但把原因摆出来 ——
#    学生把这一段输出贴给老师就能定位，不用再猜。
echo
if [ -f "$KIT_DIR/check.sh" ]; then
  bash "$KIT_DIR/check.sh" --install || warn "自检未全通过（见上面的 FAIL 行）。配好 token 后可再跑：bash check.sh"
else
  warn "安装包里缺 check.sh（自检脚本），跳过自检"
fi
echo

cat <<MSG

============================================================
安装完成！接下来：

  1. 启动：dsh --profile nju-lab-student
     · 浏览器没自动打开时，把终端打印的 http://127.0.0.1:<端口>/?token=... 复制到浏览器
     · WSL 里与 Windows 共用 127.0.0.1，直接用 Windows 的浏览器打开即可
  2. 打开后，点右侧栏「NJU-Lab」标签
  3. 首次使用请在 设置 → Plugins →「NJU-Lab 平台」填写：
       serverUrl: https://lab.xiaohe.biz/api
       token:     登录平台 → 右上角头像 →「API Token」→ 生成
  （也可用环境变量预设：NJU_LAB_SERVER_URL / NJU_LAB_TOKEN）

  日常使用：让 AI「列出我的实验任务」→「领取」→ 开发 → 自测 →「提交」

  遇到问题先跑一次自检，把输出贴给老师：
       bash ~/nju-lab-student-kit/check.sh     # 若安装包解压在别处，用实际路径
============================================================
MSG
