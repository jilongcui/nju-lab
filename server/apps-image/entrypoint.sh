#!/bin/sh
# 应用运行时容器的入口。两种产物形态：
#
#   ① **skill 模式**（第 20 章）：zip 里只有 `SKILL.md` + `scripts/`（学生提交的 Skill）
#      → 复制镜像内置的**平台 harness**（/opt/platform/app）到 /work/app，再把 skill 放到 skill/
#   ② **完整产物模式**（旧）：zip 根目录有 `app.json` 与 `harness/api.py`
#      → 直接用学生自己的 core（向后兼容）
#
# 判定看 zip 解包后有没有 `harness/api.py`。学生不需要知道这些 —— 平台按需选形态。
set -e

: "${APP_PORT:=9200}"
: "${APP_HOST:=0.0.0.0}"
: "${APP_DATA_DIR:=/work/data}"

rm -rf /work/app /work/extracted
mkdir -p /work/app /work/extracted "$APP_DATA_DIR"

if [ ! -f /pkg/app.zip ]; then
  echo "[entrypoint] 缺少 /pkg/app.zip" >&2
  exit 1
fi

unzip -q -o /pkg/app.zip -d /work/extracted || {
  echo "[entrypoint] 解包失败（产物不是合法 zip？）" >&2
  exit 1
}

# 兼容"zip 里多包了一层目录"
ROOT=/work/extracted
if [ ! -f "$ROOT/app.json" ] && [ ! -f "$ROOT/SKILL.md" ] && [ ! -d "$ROOT/scripts" ]; then
  found=$(find /work/extracted -maxdepth 2 \( -name app.json -o -name SKILL.md \) -print -quit 2>/dev/null || true)
  [ -n "$found" ] && ROOT=$(dirname "$found")
fi

if [ -f "$ROOT/harness/api.py" ]; then
  echo "[entrypoint] 完整产物模式（学生自带 core）"
  cp -a "$ROOT"/. /work/app/
  cd /work/app
else
  echo "[entrypoint] skill 模式（平台 harness + 学生 Skill）"
  cp -a /opt/platform/app/. /work/app/
  mkdir -p /work/app/skill
  cp -a "$ROOT"/. /work/app/skill/
  # 平台把标题/场景/主色通过 env 传进来（app.json 由这里生成，学生不用管）
  python3 - <<'PY' || true
import json, os
meta = {
    "title": os.environ.get("APP_TITLE") or "我的智能体应用",
    "subtitle": os.environ.get("APP_SCENARIO") or "由平台托管的智能体应用（Skill 驱动）",
    "scenario": os.environ.get("APP_SCENARIO") or "",
    "entry": "skill/scripts/api.py",
    "theme": {"mode": "light", "accent": os.environ.get("APP_ACCENT") or "#2f6feb"},
    "attachments": ["pdf", "docx", "image"],
    "visibility": "teacher",
}
path = "/work/app/app.json"
base = {}
if os.path.exists(path):
    try:
        base = json.load(open(path, encoding="utf-8"))
    except Exception:
        base = {}
base.update(meta)
json.dump(base, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  cd /work/app
fi

export APP_PORT APP_HOST APP_DATA_DIR
exec python3 app_host.py
