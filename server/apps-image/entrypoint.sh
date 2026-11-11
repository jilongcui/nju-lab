#!/bin/sh
# 应用运行时容器的入口：解包学生的产物 → 起 app_host.py。
#
# 为什么在容器里解包而不是宿主：平台不带解压库（server 依赖里没有 unzip 系），
# 而镜像里本来就有 `unzip`（verify 基底装了）。产物以**只读**方式挂在 /pkg/app.zip，
# 解出来的目录在 /work/app（容器可写层，随容器回收），因此学生代码碰不到宿主路径。
set -e

: "${APP_PORT:=9200}"
: "${APP_HOST:=0.0.0.0}"
: "${APP_DATA_DIR:=/work/data}"

rm -rf /work/app
mkdir -p /work/app "$APP_DATA_DIR"

if [ ! -f /pkg/app.zip ]; then
  echo "[entrypoint] 缺少 /pkg/app.zip" >&2
  exit 1
fi

unzip -q -o /pkg/app.zip -d /work/app || {
  echo "[entrypoint] 解包失败（产物不是合法 zip？）" >&2
  exit 1
}

# 兼容"zip 里多包了一层目录"的产物：以含 app.json 的那层为根
if [ ! -f /work/app/app.json ]; then
  found=$(find /work/app -maxdepth 2 -name app.json -print -quit 2>/dev/null || true)
  if [ -n "$found" ]; then
    root=$(dirname "$found")
    echo "[entrypoint] 产物根在 $root"
    cd "$root"
  else
    echo "[entrypoint] 产物里没有 app.json（根目录应为 app.json + harness/api.py）" >&2
    exit 1
  fi
else
  cd /work/app
fi

export APP_PORT APP_HOST APP_DATA_DIR
exec python3 app_host.py
