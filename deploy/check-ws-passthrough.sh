#!/usr/bin/env bash
#
# 验证「上游反代 → 本机 nginx」这一跳的 WebSocket 升级透传是否配置正确。
#
# 背景
#   实验工作台的实时通道是 `wss://medai.nju.edu.cn/api/remote.mux`（dsh 把运行时路径
#   写死在 origin 根，不带 /lab 前缀）。上游反代（默认 219.219.122.131，反解
#   paper.nju.edu.cn）必须在承载它的 location 里配齐：
#
#       proxy_http_version 1.1;
#       proxy_set_header Upgrade    $http_upgrade;
#       proxy_set_header Connection $connection_upgrade;
#       proxy_set_header Host       $http_host;      # ← 漏了它，dsh 的 WS 一律 403
#
#   本脚本从本机发一次带升级头的请求（经上游绕回本机），抓两跳的明文请求头来核对。
#
# 为什么在**本机**抓而不是去校园内网抓
#   上游 → 本机这一跳是明文 HTTP/1.1（本机 nginx 只监听 80，没有 443），请求头都能看到；
#   而「客户端 → 上游」那一段是 HTTPS，去内网抓只能抓到密文。
#
# 这个脚本能验证 / 不能验证
#   ✅ 上游有没有透传 `Upgrade` / `Connection: upgrade`
#   ✅ 上游透传的 `Host` 是不是对外域名（`10.28.128.56` 这类内网 IP 会让 WS 403）
#   ❌ 端到端是否真的 101 —— 那需要有活跃工作台会话（重新走一次「进入实验环境」），
#      然后 `grep -a -c " 101 " /var/log/nginx/access.log`，大于 0 即为通
#   ✅ 上游的 proxy_read_timeout / proxy_send_timeout —— 抓包看不出（超时是行为，不体现在
#      请求头里），但**实测不需要**：应用侧有服务端事件流/心跳，WS 连接不会静默到触发它
#      （2026-09-29 实测：原生 WS 连接连续存活 4 分半无间断，远超 nginx 默认的 60s）
#
# 用法：./deploy/check-ws-passthrough.sh
# 依赖：sudo（tcpdump 抓包）、curl、tcpdump
# 可用环境变量覆盖：UP_IP、HOST_HDR、URL_PATH
#
# 详见 docs/OPS-2026-09-29-gateway-websocket.md
#
set -uo pipefail

UP_IP="${UP_IP:-219.219.122.131}"      # 上游反代
HOST_HDR="${HOST_HDR:-medai.nju.edu.cn}"
URL_PATH="${URL_PATH:-/api/remote.mux}"

command -v tcpdump >/dev/null || { echo "需要 tcpdump（apt install tcpdump）" >&2; exit 1; }
command -v curl    >/dev/null || { echo "需要 curl" >&2; exit 1; }

UP_LOG="$(mktemp)"
DOWN_LOG="$(mktemp)"
trap 'rm -f "$UP_LOG" "$DOWN_LOG"; sudo kill $UP_PID $DOWN_PID 2>/dev/null' EXIT

echo "请求：https://${HOST_HDR}${URL_PATH}  （经上游 ${UP_IP} 绕回本机）"
echo

# ① 上游 → 本机（80，明文）：看它传进来的头
sudo tcpdump -i any -A -s0 -l "tcp port 80 and host ${UP_IP}" >"$UP_LOG" 2>/dev/null &
UP_PID=$!
# ② 本机 → 容器/回落（8081 = FoxCMS 回落；有会话时是容器 IP）:看我们转发出去的头
sudo tcpdump -i any -A -s0 -l "tcp port 8081" >"$DOWN_LOG" 2>/dev/null &
DOWN_PID=$!

sleep 2
curl -skS -o /dev/null --max-time 8 --resolve "${HOST_HDR}:443:${UP_IP}" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "https://${HOST_HDR}${URL_PATH}" || true
sleep 3

sudo kill "$UP_PID" "$DOWN_PID" 2>/dev/null
wait "$UP_PID" "$DOWN_PID" 2>/dev/null

PATTERN='^GET |^Host:|^Upgrade:|^Connection:|^X-Forwarded-For:'

echo "==== (1) 上游 ${UP_IP} → 本机：它传进来的请求头 ===="
grep -a -i -E "$PATTERN" "$UP_LOG" || echo "(未抓到 —— 上游可能没把这个请求转发过来)"
echo
echo "==== (2) 本机 → 容器/回落：我们转发出去的请求头 ===="
grep -a -i -E "$PATTERN" "$DOWN_LOG" || echo "(未抓到)"
echo
echo "==== 判定 ===="

rc=0

if grep -aqi "^Host: ${HOST_HDR}" "$UP_LOG"; then
  echo "✅ 上游 Host 透传正确（${HOST_HDR}）"
else
  echo "❌ 上游 Host 不对：期望 ${HOST_HDR}，实际 $(grep -ai '^Host:' "$UP_LOG" | head -1 | tr -d '\r')"
  echo "   → 请上游在其 location 里加：proxy_set_header Host \$http_host;"
  rc=1
fi

if grep -aqi "^Upgrade: websocket" "$UP_LOG"; then
  echo "✅ 上游 Upgrade 透传正常"
else
  echo "❌ 上游没有透传 Upgrade 头"
  echo "   → 需要 proxy_http_version 1.1 + proxy_set_header Upgrade \$http_upgrade"
  echo "     + proxy_set_header Connection \$connection_upgrade"
  rc=1
fi

if grep -aqi "^Host: ${HOST_HDR}" "$DOWN_LOG"; then
  echo "✅ 本机转发出去的 Host 也是 ${HOST_HDR}"
fi

echo
echo "提示：上面只验证了「配置是否正确」。端到端 101 需要有人在校园网**重新**进一次"
echo "      「进入实验环境」（旧标签页永远不行 —— 它的 cookie 是失效的旧 wsKey），然后："
echo "        grep -a -c \" 101 \" /var/log/nginx/access.log"
echo "      超时项抓包看不出来，但**实测不需要**（应用侧有事件流/心跳，连接不会静默）。"

exit $rc
