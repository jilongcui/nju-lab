#!/usr/bin/env bash
#
# NJU-Lab 前端静态产物部署 —— 把 web/dist 同步到线上 /var/www/lab（medai.nju.edu.cn/lab）
#
# 用法（普通用户即可，不需要 sudo）：
#     bash deploy/deploy-web-lab.sh              # 构建（VITE_BASE=/lab/）+ 部署
#     bash deploy/deploy-web-lab.sh --no-build   # 用现有 web/dist 直接部署
#
# 为什么要有脚本（2026-09-29 踩坑，详见 HANDOFF §2.1「前端产物部署纪律」）：
#   ① 顺序铁律：**先写 assets/ 新 chunk，最后才换 index.html**。
#      本机 nginx 是 `try_files $uri $uri/ /lab/index.html` 的 SPA 回退 —— 若 index.html 先换、
#      chunk 还没到位，浏览器请求的 /lab/assets/x.js 会拿到 **200 + text/html**（回退到 index.html），
#      ES module 按 MIME 解析直接失败 → **白屏**；而 curl 看状态码一切正常，极易漏判。
#   ② 验证铁律：**不能只看状态码**。本脚本核对 md5 + Content-Type，并按线上 index.html
#      实际引用的资源逐个探测（缺 chunk 会命中 SPA 回退，表现为 text/html）。
#   ③ 属主：线上 assets/ 历史上属 www-data(33)。在 Reasonix 受限会话里（user namespace 只映射
#      `1000 → 宿主 0`，见 /proc/self/uid_map），除 uid 1000 外的属主一律显示为 nobody:65534
#      （overflow id），且 ns 内权限检查会拒绝写入 —— **即使宿主上是 root 身份也没用**。
#      现在 assets/、index.html 属主已是 ubuntu(1000)，直接 cp 即可；若再次不可写，见文末「属主修复」。
#      判定宿主真实属主一律用 docker（本机 docker.io 不通，用已有镜像）：
#        docker run --rm -v /var/www/lab:/d nginx:alpine stat -c '%A %U:%G %n' /d /d/assets
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$REPO/web"
TARGET="${LAB_WEB_ROOT:-/var/www/lab}"
BACKUP_ROOT="${LAB_WEB_BACKUP_ROOT:-/home/ubuntu/lab-web-backups}"
SITE_HOST="${LAB_SITE_HOST:-medai.nju.edu.cn}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_ROOT/$STAMP"
BUILD=1
if [ "${1:-}" = "--no-build" ]; then BUILD=0; fi

step() { printf '\n== %s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

step "0/6 前置检查"
[ -d "$TARGET" ] || die "找不到 $TARGET"
[ -d "$WEB" ] || die "找不到 $WEB"

if [ "$BUILD" = 1 ]; then
  step "1/6 构建（VITE_BASE=/lab/，base 不能省）"
  ( cd "$WEB" && VITE_BASE=/lab/ npm run build )
else
  step "1/6 跳过构建（--no-build）"
fi
[ -f "$WEB/dist/index.html" ] || die "缺少 $WEB/dist/index.html"
ls "$WEB"/dist/assets/*.js >/dev/null 2>&1 || die "缺少 $WEB/dist/assets/*.js"

if [ ! -d "$TARGET/assets" ]; then mkdir -m 755 "$TARGET/assets"; fi
[ -w "$TARGET/assets" ] || die "$TARGET/assets 不可写 —— 属主可能不是当前用户；见本脚本末尾「属主修复」"

step "2/6 备份当前线上产物 → $BACKUP"
mkdir -p "$BACKUP"
cp -r "$TARGET/assets" "$BACKUP/assets"
cp "$TARGET/index.html" "$BACKUP/index.html"

step "3/6 先写 assets/ 新 chunk（顺序铁律①）"
for f in "$WEB"/dist/assets/*.js; do
  b="$(basename "$f")"
  if [ -e "$TARGET/assets/$b" ] && [ ! -w "$TARGET/assets/$b" ]; then rm -f "$TARGET/assets/$b"; fi
  cp -f "$f" "$TARGET/assets/$b"
  echo "   + assets/$b"
done

step "4/6 校验 md5（本地 dist ↔ 线上）"
for f in "$WEB"/dist/assets/*.js; do
  b="$(basename "$f")"
  a="$(md5sum "$f" | cut -d' ' -f1)"
  c="$(md5sum "$TARGET/assets/$b" | cut -d' ' -f1)"
  [ "$a" = "$c" ] || die "md5 不一致：assets/$b（线上 $c ≠ 本地 $a）"
  echo "   ok assets/$b  $a"
done

rollback() {
  printf '\n↩️  回滚：只把 index.html 换回备份即可（旧 chunk 全程未删，回滚立即生效）\n'
  cp -f "$BACKUP/index.html" "$TARGET/index.html"
  printf '   已回滚。备份留在 %s\n' "$BACKUP"
}

step "5/6 最后切换 index.html（顺序铁律①）"
cp -f "$WEB/dist/index.html" "$TARGET/index.html"

step "6/6 自检：按线上 index.html 实际引用的资源逐个探测（验证铁律②）"
fail=0
while read -r res; do
  [ -n "$res" ] || continue
  # 注意：curl -w 的输出没有尾随换行，若用 `read < <(...)` 会返回非 0 并在 set -e 下静默退出，
  # 所以这里用 herestring（自带换行）
  read -r code ctype <<<"$(curl -s -o /dev/null -w '%{http_code} %{content_type}' \
    -H "Host: $SITE_HOST" "http://127.0.0.1$res")"
  if [ "$code" = 200 ]; then
    case "$ctype" in
      application/javascript*|text/css*)
        printf '   ok %-34s %s %s\n' "$res" "$code" "$ctype" ;;
      *)
        printf '   ✗  %-34s %s %s（应为 js/css；text/html = 命中了 SPA 回退 = chunk 缺失）\n' \
          "$res" "$code" "$ctype"
        fail=1 ;;
    esac
  else
    printf '   ✗  %-34s HTTP %s\n' "$res" "$code"
    fail=1
  fi
done < <(grep -oE '/[A-Za-z0-9_./-]*assets/[A-Za-z0-9_.-]+\.(js|css)' "$TARGET/index.html" | sort -u)

if [ "$fail" != 0 ]; then
  rollback
  die "自检失败，已回滚"
fi

printf '\n✅ 部署完成：http://%s/lab/ 已指向本次构建\n' "$SITE_HOST"
printf '   备份：%s\n' "$BACKUP"
printf '   回滚：cp %s/index.html %s/index.html\n' "$BACKUP" "$TARGET"
printf '\n属主修复（仅当上面提示 assets 不可写时）：\n'
printf '   mv %s/assets %s/assets.pre-deploy-%s   # rename 只需父目录写权限\n' "$TARGET" "$TARGET" "$STAMP"
printf '   mkdir -m 755 %s/assets\n' "$TARGET"
printf '   cp -r %s/assets.pre-deploy-%s/. %s/assets/   # 补回历史 chunk，旧 HTML 缓存才不 404\n' "$TARGET" "$STAMP" "$TARGET"
printf '   然后再跑本脚本（顺序不能反：chunk 先、index.html 后）\n'
