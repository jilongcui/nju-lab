#!/usr/bin/env bash
#
# 学生应用分享页「短路径」—— 把 /lab/apps/ 接进现网 nginx（幂等；每步留痕）
#
# 用法（需要 sudo）：
#     sudo bash ~/nju-lab/deploy/apply-nginx-app-share.sh            # 落地
#     sudo bash ~/nju-lab/deploy/apply-nginx-app-share.sh --check     # 只校验，不改配置
#
# 做了什么：
#   0. **先跑一次基线 `nginx -t`**：现网配置若本来就过不了，立刻停 —— 免得把既有问题
#      记到这次改动头上（2026-11-13 第一次执行就是在 4/6 失败后回滚，`cp -a` 把 cms.conf
#      的 mtime 也还原成旧值，从外部看像"根本没执行过"）。
#   1. 备份 cms.conf → /home/ubuntu/cms.conf.bak-<时间戳>；
#   2. 装片段 deploy/nginx/medai-lab-apps.conf → /etc/nginx/snippets/；
#   3. 在 `include …/medai-lab.conf;` 那行**之后**补一行 include（sed 就地改，已存在则跳过），
#      并立刻 grep 回读确认；
#   4. `nginx -t`（输出全量打印）→ 失败回滚；
#   5. `systemctl reload nginx` → 失败回滚；
#   6. 自检 `/lab/apps/share/<假 key>/site` 的 **Content-Type**：
#        正确 = application/json（后端应答「分享链接无效或已下架」）
#        错误 = text/html（仍命中 SPA 回退 = location 没生效）
#      这一步**不回滚**（配置已 reload，撤掉反而更乱），只打印诊断线索。
#
# 生效后还有一个前端动作（脚本末尾会提示）：
#   web/src/api/index.ts 的 `APP_SHARE_PATH` 改成 'apps/share' → `cd web && npm run deploy:lab`
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/deploy/nginx/medai-lab-apps.conf"
SNIP_DIR="/etc/nginx/snippets"
SNIP="$SNIP_DIR/medai-lab-apps.conf"
CMS_CONF="/etc/nginx/sites-enabled/cms.conf"
INCLUDE_LINE="include /etc/nginx/snippets/medai-lab-apps.conf;"
ANCHOR="/etc/nginx/snippets/medai-lab.conf;"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/home/ubuntu/cms.conf.bak-$STAMP"
PROBE="/lab/apps/share/deadbeefdeadbeefdeadbeefdeadbeef/site"
HOST_HDR="${PROBE_HOST:-medai.nju.edu.cn}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

step() { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

probe() {
  local code ctype
  read -r code ctype <<<"$(curl -s -o /dev/null -w '%{http_code} %{content_type}' \
    -H "Host: $HOST_HDR" "http://127.0.0.1$PROBE" 2>/dev/null || echo '000 -')"
  printf '   %-52s %s %s\n' "$PROBE" "${code:-000}" "${ctype:--}"
  printf '%s\n' "${ctype:-}"
}

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行：sudo bash $0"
[ -f "$SRC" ] || die "缺少片段源文件：$SRC"
[ -f "$CMS_CONF" ] || die "找不到 $CMS_CONF"
command -v nginx >/dev/null || die "没有 nginx 命令"

step "0/6 基线 nginx -t（先确认既有配置是好的）"
if ! nginx -t 2>&1 | sed 's/^/   /'; then
  die "现网配置本身就过不了 nginx -t —— 与本次改动无关，先修好它再跑本脚本"
fi

if [ "$CHECK_ONLY" = 1 ]; then
  step "只校验：现状"
  info "片段：$([ -f "$SNIP" ] && echo "在（$(sha256sum "$SNIP" | cut -c1-12)）" || echo 缺)"
  info "include：$(grep -cF "$INCLUDE_LINE" "$CMS_CONF" || true) 处"
  info "锚点：$(grep -nF "$ANCHOR" "$CMS_CONF" | head -1 || echo 未找到)"
  step "探测（Content-Type 才是判据）"
  probe >/dev/null
  exit 0
fi

step "1/6 备份 cms.conf → $BACKUP"
cp -a "$CMS_CONF" "$BACKUP"

rollback() {
  printf '\n↩️  回滚 cms.conf：%s\n' "$BACKUP"
  cp -a "$BACKUP" "$CMS_CONF"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  printf '   已回滚（片段 %s 留着无害：没被 include 就不生效）\n' "$SNIP"
}

step "2/6 片段就位 → $SNIP"
install -m 0644 "$SRC" "$SNIP"
info "sha256 $(sha256sum "$SNIP" | cut -c1-12)"

step "3/6 在 cms.conf 补 include"
if grep -qF "$INCLUDE_LINE" "$CMS_CONF"; then
  info "已存在，跳过"
else
  anchor_ln="$(grep -nF "$ANCHOR" "$CMS_CONF" | head -1 | cut -d: -f1)"
  [ -n "$anchor_ln" ] || die "cms.conf 里找不到锚点：$ANCHOR（请手工加 include 后重跑）"
  info "锚点在第 $anchor_ln 行"
  escaped="$(printf '%s' "$ANCHOR" | sed 's/[][\\.*^$/]/\\&/g')"
  sed -i "/$escaped/a\\    $INCLUDE_LINE" "$CMS_CONF"
  info "插入后回读：$(grep -nF "$INCLUDE_LINE" "$CMS_CONF" | head -1)"
fi

step "4/6 nginx -t（全量输出）"
if ! nginx -t 2>&1 | sed 's/^/   /'; then
  rollback
  die "nginx -t 失败，已回滚（上面的报错就是原因）"
fi

step "5/6 reload"
if ! systemctl reload nginx; then
  rollback
  die "reload 失败，已回滚"
fi
info "已 reload"

step "6/6 自检（判据是 Content-Type，不是状态码）"
ctype_now="$(probe | tail -1)"
case "$ctype_now" in
  application/json*)
    cat <<EOF

✅ 落地完成（nginx 侧）。还差一步前端切路径（普通用户即可）：
   cd $REPO/web
   # 把 src/api/index.ts 里的  const APP_SHARE_PATH = 'api/apps/share';  改成  'apps/share';
   npm run deploy:lab

   之后分享链接是  http://medai.nju.edu.cn/lab/apps/share/<shareKey>/site
   老路径 /lab/api/apps/share/<shareKey>/site 仍可用，可平滑切换。
EOF
    ;;
  text/html*)
    printf '\n❌ 仍是 text/html —— location 没生效（未回滚，配置已 reload）。诊断线索：\n'
    printf '   grep -n "medai-lab-apps" %s\n' "$CMS_CONF"
    printf '   nginx -T 2>/dev/null | grep -n -A6 "lab/apps"\n'
    printf '   （nginx -T 里没有这段 = include 没落在 server/http 作用域内）\n'
    exit 1
    ;;
  *)
    printf '\n⚠️  非预期 Content-Type（%s），配置已 reload，请人工确认。\n' "${ctype_now:-空}"
    exit 1
    ;;
esac
