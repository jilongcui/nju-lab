#!/usr/bin/env bash
#
# 学生应用分享页「短路径」—— 把 /lab/apps/ 接进现网 nginx（幂等、失败自动回滚）
#
# 用法（需要 sudo）：
#     sudo bash ~/nju-lab/deploy/apply-nginx-app-share.sh           # 落地
#     sudo bash ~/nju-lab/deploy/apply-nginx-app-share.sh --check    # 只校验，不改配置
#
# 做了什么：
#   1. 备份 /etc/nginx/sites-enabled/cms.conf；
#   2. 把 deploy/nginx/medai-lab-apps.conf 装到 /etc/nginx/snippets/；
#   3. 在 cms.conf 里 `include /etc/nginx/snippets/medai-lab.conf;` 之后补一行 include（已存在则跳过）；
#   4. nginx -t 校验 → 失败立即回滚并退出；
#   5. reload nginx，并自检 `/lab/apps/share/<假 key>/site` 的 **Content-Type**：
#      正确 = application/json（后端应答「分享链接无效」）；
#      错误 = text/html（命中了 SPA 回退 = location 没生效）。
#
# 生效后还有一个前端动作（脚本会提示）：
#   web/src/api/index.ts 的 `APP_SHARE_PATH` 改成 'apps/share' → `cd web && npm run deploy:lab`
#
# 为什么要有这个脚本：现网 `/lab` 只有 `/lab/api/`（→ 后端）与 `/lab/`（→ SPA）两条前缀
# location，`/lab/apps/…` 会落到 SPA 的 try_files 回退，返回 200 + 平台首页。
# 详解见片段头部注释与 HANDOFF。
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/deploy/nginx/medai-lab-apps.conf"
SNIP_DIR="/etc/nginx/snippets"
SNIP="$SNIP_DIR/medai-lab-apps.conf"
CMS_CONF="/etc/nginx/sites-enabled/cms.conf"
INCLUDE_LINE="include /etc/nginx/snippets/medai-lab-apps.conf;"
ANCHOR="include /etc/nginx/snippets/medai-lab.conf;"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/home/ubuntu/cms.conf.bak-$STAMP"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

step() { printf '\n== %s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行：sudo bash $0"
[ -f "$SRC" ] || die "缺少片段源文件：$SRC"
[ -f "$CMS_CONF" ] || die "找不到 $CMS_CONF"
command -v nginx >/dev/null || die "没有 nginx 命令"

if [ "$CHECK_ONLY" = 1 ]; then
  step "只校验：nginx -t"
  nginx -t
  step "当前状态"
  if [ -f "$SNIP" ] && grep -qF "$INCLUDE_LINE" "$CMS_CONF"; then
    echo "   片段与 include 都已在位"
  else
    echo "   尚未落地（片段或 include 缺失）"
  fi
  printf '   探测 /lab/apps/share/<假key>/site → '
  curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
    "http://127.0.0.1/lab/apps/share/deadbeefdeadbeefdeadbeefdeadbeef/site" || true
  exit 0
fi

step "1/6 备份 cms.conf → $BACKUP"
cp -a "$CMS_CONF" "$BACKUP"

rollback() {
  printf '\n↩️  回滚 cms.conf：%s\n' "$BACKUP"
  cp -a "$BACKUP" "$CMS_CONF"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  printf '   已回滚（片段 %s 留着无害：没有被 include 就不生效）\n' "$SNIP"
}

step "2/6 片段就位 → $SNIP"
install -m 0644 "$SRC" "$SNIP"

step "3/6 在 cms.conf 里补 include（已存在则跳过）"
if grep -qF "$INCLUDE_LINE" "$CMS_CONF"; then
  echo "   已存在，跳过"
else
  grep -qF "$ANCHOR" "$CMS_CONF" || die "cms.conf 里找不到锚点：$ANCHOR（请手工加 include 后重跑）"
  # 用 awk 在锚点行之后插入，保留缩进风格（锚点行首缩进原样复制）
  awk -v anchor="$ANCHOR" -v line="$INCLUDE_LINE" '
    { print }
    index($0, anchor) { match($0, /^[ \t]*/); printf "%s%s\n", substr($0, 1, RLENGTH), line }
  ' "$CMS_CONF" > "$CMS_CONF.new"
  mv "$CMS_CONF.new" "$CMS_CONF"
  echo "   已插入：$INCLUDE_LINE"
fi

step "4/6 nginx -t"
if ! nginx -t; then
  rollback
  die "nginx -t 失败，已回滚"
fi

step "5/6 reload"
if ! systemctl reload nginx; then
  rollback
  die "reload 失败，已回滚"
fi
echo "   已 reload"

step "6/6 自检（判定依据是 Content-Type，不是状态码）"
probe="http://127.0.0.1/lab/apps/share/deadbeefdeadbeefdeadbeefdeadbeef/site"
read -r code ctype <<<"$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$probe")"
printf '   %-56s %s %s\n' "/lab/apps/share/<假key>/site" "$code" "$ctype"
case "$ctype" in
  application/json*)
    echo "   ✅ 已交给后端（404 = 分享链接无效，预期）"
    ;;
  text/html*)
    echo "   ❌ 仍命中 SPA 回退 —— location 没生效，请检查 include 是否在 http/server 作用域内"
    rollback
    exit 1
    ;;
  *)
    echo "   ⚠️  非预期 Content-Type，请人工确认（配置已生效但应答异常）"
    ;;
esac

cat <<EOF

✅ 落地完成。还差一步（前端切路径，另需普通用户权限即可）：
   cd $REPO/web
   # 把 src/api/index.ts 里的  const APP_SHARE_PATH = 'api/apps/share';  改成  'apps/share';
   npm run deploy:lab

   然后分享链接会变成  http://medai.nju.edu.cn/lab/apps/share/<shareKey>/site
   老的 /lab/api/apps/share/<shareKey>/site 仍然可用（两条路都通），可平滑切换。

   回滚：cp -a $BACKUP $CMS_CONF && systemctl reload nginx
EOF
