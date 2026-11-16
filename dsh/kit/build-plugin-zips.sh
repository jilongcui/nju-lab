#!/usr/bin/env bash
# 打包「插件包」（学生端 nju-lab-client 的独立安装形态）—— 四个平台各一份。
#
# 用法：cd dsh/kit && ./build-plugin-zips.sh     （插件需先 npm run build）
#
# 为什么要分平台：插件代码本身是纯 JS（lib 只 import dsh-tools / schemastery + node 内置），
# 唯一平台相关的是依赖树里那一颗原生 addon —— `node-addon-require-builtin-<os>-<arch>*`
# （@deepseek-ai/cordis-plugin-loader → node-addon-require-builtin 的 optionalDependency，
# 共 9 个平台变体）。所以「同一份代码 + 各平台各一份依赖树」即可。
#
# 关键技巧：**不需要 Windows / macOS 机器**。npm 支持交叉装：
#     npm ci --omit=dev --os=win32 --cpu=x64
# 会在 Linux 上装出 win32 的依赖树（2026-11-16 实测）。
#
# 用 --omit=dev 而不是全量 npm ci：插件的 devDependencies（dsh-agent / dsh-session /
# dsh-client-* 等 22 个包）运行时用不到，带上会让包从 ~2.6MB 涨到 ~4.2MB。
#
# 产物：dist/plugin/nju-lab-client-plugin-<label>.zip
#   <label> ∈ win-x64 / darwin-arm64 / darwin-x64 / linux-x64
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

CLIENT="../nju-lab-client"
OUT="dist/plugin"
STAGE="dist/stage"

[ -d "$CLIENT/lib/host" ] || { echo "插件未构建：先 cd ../nju-lab-client && npm run build"; exit 1; }
[ -f "$CLIENT/package-lock.json" ] || { echo "缺 $CLIENT/package-lock.json（需要它做 --omit=dev 的确定性安装）"; exit 1; }

# 版本凭据与安装包共用：先跑过 build-kit.sh 就能复用同一个版本号，
# 否则学生装完插件点「检查更新」会莫名其妙提示有新版本。
if [ -f "$STAGE/kit-version.json" ]; then
  KIT_VERSION_JSON="$STAGE/kit-version.json"
else
  mkdir -p "$STAGE"
  printf '{"version":"%s"}\n' \
    "$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)" \
    > "$STAGE/kit-version.json"
  KIT_VERSION_JSON="$STAGE/kit-version.json"
fi
VERSION="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$KIT_VERSION_JSON")"
echo "kit-version: $VERSION"

rm -rf "$OUT"
mkdir -p "$OUT"

# os arch label —— 顺序即构建顺序（先做最常用的）
for target in "win32 x64 win-x64" "darwin arm64 darwin-arm64" "darwin x64 darwin-x64" "linux x64 linux-x64"; do
  read -r os arch label <<<"$target"
  root="$OUT/$label"
  dir="$root/nju-lab-client"
  mkdir -p "$dir"

  # 1) 插件本体（与 kit 里 nju-lab-client 同一份产物）
  cp "$CLIENT/package.json" "$CLIENT/package-lock.json" "$CLIENT/cordis.patch.yml" "$CLIENT/README.md" "$dir/"
  cp -r "$CLIENT/lib" "$dir/lib"
  cp "$KIT_VERSION_JSON" "$dir/kit-version.json"

  # 2) 该平台的运行时依赖树（交叉安装；--omit=dev 见文件头）
  ( cd "$dir" && npm ci --omit=dev --os="$os" --cpu="$arch" --no-audit --no-fund >/dev/null )

  # 3) 原生 addon 自检：该平台的那一颗必须真的在
  native="$(find "$dir/node_modules" -maxdepth 1 -type d -name "node-addon-require-builtin-$os-*" | head -1)"
  if [ -z "$native" ]; then
    echo "❌ $label: 依赖树里没有 node-addon-require-builtin-$os-* —— 交叉安装没生效"
    exit 1
  fi
  echo "  $label: $(basename "$native") ✓  ($(du -sh "$dir/node_modules" | cut -f1) 未压缩)"

  # 4) 安装说明（ASCII 文件名 + UTF-8 内容：Windows 资源管理器与 mac/Linux 解压都不乱码）
  sed "s|__PLATFORM__|$label|g" plugin-INSTALL.md > "$root/INSTALL.md"

  # 5) 打包（根下是 nju-lab-client/ + INSTALL.md，和原先的 win 包结构一致）
  ( cd "$root" && zip -qr "../nju-lab-client-plugin-$label.zip" . )
  rm -rf "$root"
done

echo
ls -lh "$OUT"/*.zip | awk '{print "  " $9 "  " $5}'
echo "built: $(ls "$OUT"/*.zip | wc -l) 个平台包  ($OUT)"
