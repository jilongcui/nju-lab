#!/usr/bin/env bash
# NJU-Lab 学生端一键安装：DSH CLI + nju-lab-student profile + nju-lab-client 插件
# 用法：解压安装包后  ./install.sh
set -euo pipefail

DSH_VERSION="0.1.5-rc.2"   # 学期内锁定，不升级
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info() { printf '\033[1;34m[nju-lab]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[nju-lab] %s\033[0m\n' "$*" >&2; exit 1; }

# 1. Node.js 22+
command -v node >/dev/null 2>&1 || fail "未找到 node，请先安装 Node.js 22+（https://nodejs.org）"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "Node.js 版本过低（$(node -v)），需要 22+"
command -v npm >/dev/null 2>&1 || fail "未找到 npm"
info "Node.js $(node -v) ✓"

# 2. pnpm（dsh plugin install 需要）
# corepack 的 pnpm 只是 shim，首次运行要从 registry.npmjs.org 下载本体，
# 网络不通时会失败，所以要验证 pnpm 真正可用，而不是只看 PATH 里有没有。
export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-$(npm config get registry)}"
if ! pnpm -v >/dev/null 2>&1; then
  info "pnpm 不可用（corepack 下载失败或未安装），改用 npm 安装…"
  npm i -g pnpm
fi
info "pnpm $(pnpm -v) ✓"

# 3. DSH CLI（锁定版本）
if ! command -v dsh >/dev/null 2>&1 || [ "$(dsh --version 2>/dev/null || true)" != "$DSH_VERSION" ]; then
  info "安装 @deepseek-ai/dsh@$DSH_VERSION …"
  npm i -g "@deepseek-ai/dsh@$DSH_VERSION"
fi
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

cat <<MSG

============================================================
安装完成！接下来：

  1. 启动：dsh --profile nju-lab-student
  2. 浏览器打开后，点右侧栏「NJU-Lab」标签
  3. 首次使用请在 设置 → nju-lab 填写：
       serverUrl: https://lab.xiaohe.biz/api
       token:     登录平台 → 右上角头像 →「API Token」→ 生成
  （也可用环境变量预设：NJU_LAB_SERVER_URL / NJU_LAB_TOKEN）

  日常使用：让 AI「列出我的实验任务」→「领取」→ 开发 → 自测 →「提交」
============================================================
MSG
