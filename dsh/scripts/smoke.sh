#!/usr/bin/env bash
# 冒烟测试：用一次性 overlay 把 nju-lab-client 的 host 半装进 web profile，
# 启动（限时）并检查插件是否加载。
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"          # → dsh/
PLUGIN_HOST="$HERE/nju-lab-client/src/host/index.ts"
DSH="${DSH_BIN:-npx @deepseek-ai/dsh@0.1.7-rc.2}"
: "${DSH_HOME:=$HOME/.dsh}"; export DSH_HOME

echo "DSH_HOME=$DSH_HOME"
echo "plugin   =$PLUGIN_HOST"

OVERLAY="$(mktemp)"
trap 'rm -f "$OVERLAY"' EXIT
cat > "$OVERLAY" <<YAML
- insert:
    - id: nju-lab-client
      name: '$PLUGIN_HOST'
      config:
        serverUrl: 'http://127.0.0.1:3000/api'
YAML

echo "--- booting web with overlay (bounded 30s) ---"
set +e
timeout 30 $DSH --profile web --patch "$OVERLAY" --no-open > /tmp/nju-lab-smoke.log 2>&1
set -e

if grep -q "\[nju-lab-client\] host half loaded" /tmp/nju-lab-smoke.log; then
  echo "✅ PASS: nju-lab-client host half loaded"
else
  echo "❌ FAIL: plugin did not load; log:"
  tail -30 /tmp/nju-lab-smoke.log
  exit 1
fi
