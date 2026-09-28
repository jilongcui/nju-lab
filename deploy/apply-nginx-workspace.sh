#!/usr/bin/env bash
#
# NJU-Lab 平台侧实验工作台 —— 把两个 nginx 片段接进现网配置（幂等、失败自动回滚）
#
# 用法（需要 sudo）：
#     sudo bash ~/nju-lab/deploy/apply-nginx-workspace.sh
#
# 背景：dsh 的运行时路径锚定 origin 根（/api、/api/remote.mux、/plugins、/open-in-app），
#       而 medai 只有 80 端口、只有一个 Host，所以工作台用「页面认路径 + 根路径认 cookie」
#       形态 —— 配置本体是仓库里的 deploy/nginx/medai-workspace-{http,server}.conf，
#       本脚本负责把它们 cp 到 /etc/nginx/snippets/、在两处加 include、校验并热加载。
#       取舍与实测见 docs/DESIGN-2026-09-28-platform-workspace.md §4.5.2 · HANDOFF.md §8
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNIP_DIR="/etc/nginx/snippets"
NGINX_CONF="/etc/nginx/nginx.conf"
CMS_CONF="/etc/nginx/sites-enabled/cms.conf"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 sudo 运行：sudo bash $0" >&2
  exit 1
fi

for f in "$NGINX_CONF" "$CMS_CONF" \
         "$REPO/deploy/nginx/medai-workspace-http.conf" \
         "$REPO/deploy/nginx/medai-workspace-server.conf"; do
  [ -f "$f" ] || { echo "缺少文件：$f" >&2; exit 1; }
done

echo "== 1/5 备份现有配置"
cp -a "$NGINX_CONF" "/home/ubuntu/nginx.conf.bak-$STAMP"
cp -a "$CMS_CONF" "/home/ubuntu/cms.conf.bak-$STAMP"
echo "   /home/ubuntu/nginx.conf.bak-$STAMP"
echo "   /home/ubuntu/cms.conf.bak-$STAMP"

echo "== 2/5 片段就位"
install -m 0644 "$REPO/deploy/nginx/medai-workspace-http.conf" "$SNIP_DIR/"
install -m 0644 "$REPO/deploy/nginx/medai-workspace-server.conf" "$SNIP_DIR/"
echo "   $SNIP_DIR/medai-workspace-{http,server}.conf"

echo "== 3/5 幂等插入 include"
python3 - "$NGINX_CONF" "$CMS_CONF" <<'PY'
import sys

nginx_conf, cms_conf = sys.argv[1], sys.argv[2]

# ① http{} 级：加在 "http {" 之后
p = nginx_conf
s = open(p, encoding="utf-8").read()
line = "    include /etc/nginx/snippets/medai-workspace-http.conf;"
if "medai-workspace-http.conf" in s:
    print("   nginx.conf: 已含 include，跳过")
else:
    if "http {" not in s:
        sys.exit("   nginx.conf: 找不到 'http {'，请手工加这一行：" + line)
    open(p, "w", encoding="utf-8").write(s.replace("http {", "http {\n" + line, 1))
    print("   nginx.conf: 已在 http{} 加入 include")

# ② 主 server 级：紧跟 FoxCMS 的 include
p = cms_conf
s = open(p, encoding="utf-8").read()
line = "    include /etc/nginx/snippets/medai-workspace-server.conf;"
anchor = "    include /etc/nginx/snippets/medai-foxcms.conf;"
if "medai-workspace-server.conf" in s:
    print("   cms.conf: 已含 include，跳过")
else:
    if anchor not in s:
        sys.exit("   cms.conf: 找不到 foxcms include 行，请手工加这一行：" + line)
    open(p, "w", encoding="utf-8").write(s.replace(anchor, anchor + "\n" + line, 1))
    print("   cms.conf: 已在 server 里加入 include")
PY

echo "== 4/5 nginx -t"
if ! nginx -t; then
  echo "❌ 配置校验失败 → 回滚到改动前（**未 reload**，现网无变化）"
  cp -a "/home/ubuntu/nginx.conf.bak-$STAMP" "$NGINX_CONF"
  cp -a "/home/ubuntu/cms.conf.bak-$STAMP" "$CMS_CONF"
  exit 1
fi

echo "== 5/5 热加载 + 自检"
systemctl reload nginx
code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: medai.nju.edu.cn' http://127.0.0.1/lab/ws/aaaa/ || true)"
echo "   /lab/ws/<伪key>/ → HTTP $code（期望 **403** = 鉴权拦截已生效；若为 200 说明仍是 SPA，片段没生效）"
echo
echo "✅ 完成。浏览器里：登录 → 侧栏「实验环境」→ 启动实验环境 → 进入实验环境"
echo
echo "回退方法（如需）："
echo "   sudo cp /home/ubuntu/nginx.conf.bak-$STAMP $NGINX_CONF"
echo "   sudo cp /home/ubuntu/cms.conf.bak-$STAMP   $CMS_CONF"
echo "   sudo systemctl reload nginx"
