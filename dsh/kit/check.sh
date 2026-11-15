#!/usr/bin/env bash
# NJU-Lab 学生端自检（doctor）
#
# 用法（在 WSL / Linux / macOS 的终端里）：
#   bash check.sh              # 完整自检：装没装好 + token 有没有 + 能不能连上平台
#   bash check.sh --install    # 只查"安装完整性"（install.sh 装完会自动调这个）
#
# 为什么要这个脚本：学生说"我提交不了"时，老师和助教无法看到他的机器。
# 把这条命令的输出贴出来，90% 的问题当场能定位（插件没装上 / token 失效 /
# 不在校园网被网关拦 / 被 WAF 拦），不用来回猜。
#
# 退出码：0 = 全绿（可能有 WARN）；1 = 有 FAIL。
set -uo pipefail

DSH_VERSION_EXPECTED="0.2.0-rc.2"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="$DSH_HOME/profiles/nju-lab-student"
PLUGIN="$DSH_HOME/nju-lab-client"
INSTALL_ONLY=0
[ "${1:-}" = "--install" ] && INSTALL_ONLY=1

FAILED=0
WARNED=0
ok()   { printf '  \033[32m[ OK ]\033[0m %s: %s\n' "$1" "$2"; }
skip() { printf '  \033[2m[ -- ]\033[0m %s: %s\n' "$1" "$2"; }
warn() { WARNED=$((WARNED + 1)); printf '  \033[33m[WARN]\033[0m %s: %s\n' "$1" "$2"; }
bad()  { FAILED=$((FAILED + 1)); printf '  \033[31m[FAIL]\033[0m %s: %s\n' "$1" "$2"; }

# 掩码：只留前 6 位，够判断"是不是同一个 token"，又不至于把凭据打进聊天记录
mask() {
  local v="$1"
  if [ ${#v} -le 6 ]; then printf '%s…（%d 位）' "$v" "${#v}"
  else printf '%s…（%d 位）' "${v:0:6}" "${#v}"; fi
}

# 从 settings.yaml 读一个键（学生多半是在设置页里填的）。
# 两遍扫描：先只在 nju-lab / nju-lab-client 节里找，找不到再全局找 —— 别的插件
# 也可能有 `token:` 这类同名键，但优先本插件的节能避开绝大多数误取。
from_settings_key() {
  local key="$1" file="$DSH_HOME/settings.yaml"
  [ -f "$file" ] || return 1
  awk -v k="$key" '
    # 一级键（无缩进）：记录当前是否在 nju-lab 节里
    /^[^[:space:]#][^:]*:/ { insec = ($0 ~ /^nju-lab(-client)?:[[:space:]]*$/) ; next }
    $0 !~ "^[[:space:]]+" k ":" { next }
    {
      v = $0
      sub("^[[:space:]]*" k ":[[:space:]]*", "", v)
      gsub(/^["'"'"']|["'"'"'][[:space:]]*$/, "", v)
      sub(/[[:space:]]+$/, "", v)
      if (v == "" || v ~ /^!!js/) next
      if (insec) { print v; exit }
      if (fallback == "") fallback = v
    }
    END { if (fallback != "") print fallback }
  ' "$file"
}

# 未求值的 `!!js ...` 表达式不是真实配置：别把它当"已填"（否则自检会假阳性）。
real_value() {
  local v="$1"
  case "$v" in ''|'!!'*|*'lab.example.edu'*) return 1 ;; esac
  printf '%s' "$v"
}

echo
echo "[nju-lab] 学生端自检（DSH ${DSH_VERSION_EXPECTED}）"
echo "  ------------------------------------------------"

# ---- 1. 运行环境 ----
if grep -qi microsoft /proc/version 2>/dev/null; then
  ok "平台" "WSL2（$(uname -srm)）"
else
  ok "平台" "$(uname -srm)"
fi
[ "$(id -u)" -eq 0 ] && warn "用户" "当前是 root —— 安装与运行请用普通用户，否则文件权限会乱"

# ---- 2. 工具链 ----
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then ok "node" "$(node -v)"
  else bad "node" "$(node -v) —— 需要 22+（apt 的默认版本太旧，见 README §1.1）"; fi
else
  bad "node" "未安装 —— WSL 里执行：curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
fi

if command -v pnpm >/dev/null 2>&1; then ok "pnpm" "$(pnpm -v 2>/dev/null)"
else bad "pnpm" "不可用 —— npm i -g --prefix \"\$HOME/.local\" pnpm && export PATH=\"\$HOME/.local/bin:\$PATH\""; fi

# 学期口径：>= 0.2.0-rc.2 且 < 0.3.0，且不接受其它元组的预发布
# （0.2.1-rc.x / 0.2.2-rc.x 不满足 `^0.2.0-rc.2`，会让插件依赖分叉，见 install.sh 注释）
dsh_version_ok() {
  local v="${1#v}"
  case "$v" in
    0.2.0-rc.*)
      local n="${v##*.}"
      case "$n" in ''|*[!0-9]*) return 1 ;; esac
      [ "$n" -ge 2 ] ;;
    0.2.[0-9]*)
      case "$v" in *-*) return 1 ;; *) return 0 ;; esac ;;
    *) return 1 ;;
  esac
}

if command -v dsh >/dev/null 2>&1; then
  DSH_VER="$(dsh --version 2>/dev/null || echo '(取不到)')"
  if dsh_version_ok "$DSH_VER"; then ok "dsh" "$DSH_VER"
  elif [ "$DSH_VER" = "$DSH_VERSION_EXPECTED" ]; then ok "dsh" "$DSH_VER"
  else warn "dsh" "$DSH_VER —— 学期口径是 ${DSH_VERSION_EXPECTED}（或将来的 0.2.x 正式版）；跨 rc 会让自测与复验条件不一致"; fi
else
  bad "dsh" "不在 PATH —— 重跑 install.sh；若刚装到 ~/.local，新开一个终端再试"
fi

# ---- 3. 安装产物 ----
if [ -f "$PROFILE/package.json" ]; then
  if grep -q 'nju-lab-client' "$PROFILE/package.json" 2>/dev/null; then ok "profile" "$PROFILE"
  else bad "profile" "$PROFILE 里没有 nju-lab-client 依赖 —— 重跑 install.sh"; fi
else
  bad "profile" "缺 $PROFILE —— 重跑 install.sh"
fi

if [ -f "$PLUGIN/lib/host/index.js" ]; then ok "插件" "$PLUGIN"
else bad "插件" "缺 $PLUGIN/lib/host/index.js —— 重跑 install.sh"; fi

# ---- 4. 插件是否真的被加载（--dump-config 是唯一可靠的证据）----
DUMP=""
if command -v dsh >/dev/null 2>&1 && [ -f "$PROFILE/package.json" ]; then
  DUMP="$(timeout 90 dsh --profile nju-lab-student --dump-config 2>/dev/null || true)"
fi
if [ -n "$DUMP" ]; then
  if printf '%s' "$DUMP" | grep -q 'nju-lab-client'; then ok "加载" "nju-lab-client 已进入 profile 配置"
  else bad "加载" "--dump-config 里没有 nju-lab-client —— 插件没被加载，提交工具不会出现"; fi
else
  bad "加载" "--dump-config 失败（profile 依赖可能没装全）—— 重跑：dsh plugin --profile nju-lab-student install"
fi

# ---- 5. 配置（serverUrl / token）----
# 只认三种来源：环境变量 > settings.yaml（设置页写的）> 无。
# **不要**去 `--dump-config` 里抓值 —— 它打印的是未求值的表达式
# （`!!js process.env.NJU_LAB_SERVER_URL ?? '...'`），抓来当配置会让自检假阳性
# （2026-11-15 实测踩到：没配 token 却报 [OK]）。
SERVER_URL="$(real_value "${NJU_LAB_SERVER_URL:-}" || true)"
[ -n "$SERVER_URL" ] || SERVER_URL="$(real_value "$(from_settings_key serverUrl || true)" || true)"

TOKEN="$(real_value "${NJU_LAB_TOKEN:-}" || true)"
[ -n "$TOKEN" ] || TOKEN="$(real_value "$(from_settings_key token || true)" || true)"

if [ -n "$SERVER_URL" ]; then
  case "$SERVER_URL" in
    *lab.example.edu*) warn "serverUrl" "$SERVER_URL —— 还是默认占位地址，请在 设置 → Plugins →「NJU-Lab 平台」填平台地址" ;;
    *) ok "serverUrl" "$SERVER_URL" ;;
  esac
else
  warn "serverUrl" "没读到 —— 启动 dsh 后到 设置 → Plugins →「NJU-Lab 平台」填写"
fi

if [ -n "$TOKEN" ]; then
  ok "token" "$(mask "$TOKEN")"
else
  warn "token" "没配置 —— 平台右上角头像 →「API Token」→ 生成"
fi

if [ "$INSTALL_ONLY" -eq 1 ]; then
  echo "  ------------------------------------------------"
  if [ "$FAILED" -gt 0 ]; then
    echo "  安装自检：$FAILED 项失败 —— 见上面 [FAIL] 行"
    echo
    exit 1
  fi
  echo "  安装自检通过。配好 token 后再跑一次完整自检： bash check.sh"
  echo
  exit 0
fi

# ---- 6. 能不能连上平台（token + 网络 + 网关 + WAF 一次问清）----
if [ -z "$TOKEN" ] || [ -z "$SERVER_URL" ]; then
  skip "网络" "缺 token / serverUrl，跳过连通性检查"
elif ! command -v curl >/dev/null 2>&1; then
  skip "网络" "没有 curl —— 先装：sudo apt-get install -y curl"
else
  RESP="$(curl -sS -m 15 -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "${SERVER_URL%/}/me" 2>&1 || true)"
  CODE="$(printf '%s' "$RESP" | tail -1)"
  BODY="$(printf '%s' "$RESP" | sed '$d')"
  case "$CODE" in
    200)
      if printf '%s' "$BODY" | grep -q '"code":[[:space:]]*0'; then
        ok "网络" "GET /me → 200（token 有效）"
      else
        warn "网络" "GET /me → 200 但响应不是平台格式，确认 serverUrl 是否带 /api"
      fi ;;
    401) bad "网络" "GET /me → 401：token 失效或被吊销，重新生成后更新配置" ;;
    403) bad "网络" "GET /me → 403：多是校园 WAF 拦了请求 —— 先确认安装包是最新版，仍不行请联系老师" ;;
    301|302|303|307|308)
      bad "网络" "GET /me → $CODE 重定向：多半不在校园网 / 校内 VPN 下，被网关拦去认证页" ;;
    000) bad "网络" "连不上 $SERVER_URL —— 检查网络、VPN、以及地址是否写错（要带 /api）" ;;
    *)   bad "网络" "GET /me → HTTP $CODE" ;;
  esac
fi

echo "  ------------------------------------------------"
if [ "$FAILED" -gt 0 ]; then
  echo "  结论：$FAILED 项失败，$WARNED 项需要注意 —— 先解决 [FAIL] 行"
  echo
  exit 1
fi
if [ "$WARNED" -gt 0 ]; then
  echo "  结论：安装正常，$WARNED 项需要留意（多为 token / serverUrl 未配置）"
  echo
  exit 0
fi
echo "  结论：一切正常，可以开始做实验了"
echo
exit 0
