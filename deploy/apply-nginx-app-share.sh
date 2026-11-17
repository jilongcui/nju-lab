#!/usr/bin/env bash
# 把 /lab/share/<key> 接进现网 nginx（幂等；配置失败自动回滚）。
# 用法：sudo bash deploy/apply-nginx-app-share.sh [--check]
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
SNIP_BACKUP="/home/ubuntu/medai-lab-apps.conf.bak-$STAMP"
PROBE="/lab/share/deadbeefdeadbeefdeadbeefdeadbeef"
HOST_HDR="${PROBE_HOST:-medai.nju.edu.cn}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1
HAD_SNIP=0

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

step "0/6 基线 nginx -t"
if ! nginx -t 2>&1 | sed 's/^/   /'; then
  die "现网配置本身就过不了 nginx -t，先修复既有问题"
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

step "1/6 备份现有配置"
cp -a "$CMS_CONF" "$BACKUP"
if [ -f "$SNIP" ]; then
  HAD_SNIP=1
  cp -a "$SNIP" "$SNIP_BACKUP"
fi
info "cms.conf → $BACKUP"

rollback() {
  printf '\n↩️  回滚 nginx 配置\n'
  cp -a "$BACKUP" "$CMS_CONF"
  if [ "$HAD_SNIP" = 1 ]; then
    cp -a "$SNIP_BACKUP" "$SNIP"
  else
    rm -f "$SNIP"
  fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
}

step "2/6 片段就位 → $SNIP"
install -m 0644 "$SRC" "$SNIP"
info "sha256 $(sha256sum "$SNIP" | cut -c1-12)"

step "3/6 在 cms.conf 补 include"
if grep -qF "$INCLUDE_LINE" "$CMS_CONF"; then
  info "已存在，跳过"
else
  anchor_ln="$(grep -nF "$ANCHOR" "$CMS_CONF" | head -1 | cut -d: -f1)"
  [ -n "$anchor_ln" ] || die "cms.conf 里找不到锚点：$ANCHOR"
  escaped="$(printf '%s' "$ANCHOR" | sed 's/[][\\.*^$/]/\\&/g')"
  sed -i "/$escaped/a\\    $INCLUDE_LINE" "$CMS_CONF"
  info "插入后回读：$(grep -nF "$INCLUDE_LINE" "$CMS_CONF" | head -1)"
fi

step "4/6 nginx -t"
if ! nginx -t 2>&1 | sed 's/^/   /'; then
  rollback
  die "nginx -t 失败，已回滚"
fi

step "5/6 reload"
if ! systemctl reload nginx; then
  rollback
  die "reload 失败，已回滚"
fi
info "已 reload"

step "6/6 自检（假 key 应返回后端 JSON，而不是 SPA HTML）"
ctype_now="$(probe | tail -1)"
case "$ctype_now" in
  application/json*)
    printf '\n✅ 分享短路径已生效：http://medai.nju.edu.cn/lab/share/<shareKey>\n'
    printf '   旧链接继续可用。\n'
    ;;
  text/html*)
    printf '\n❌ 仍返回 text/html，location 未生效；请检查 include 是否位于 server 作用域。\n'
    exit 1
    ;;
  *)
    printf '\n⚠️  非预期 Content-Type（%s），请人工确认。\n' "${ctype_now:-空}"
    exit 1
    ;;
esac
