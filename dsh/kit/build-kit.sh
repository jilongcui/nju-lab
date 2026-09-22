#!/usr/bin/env bash
# 打包学生端安装包：profile + 插件产物 + install.sh + 学生手册 → dist/nju-lab-student-kit.zip
# 用法：cd dsh/kit && ./build-kit.sh   （插件需先 npm run build）
# PLATFORM_URL 指定平台地址（默认 https://lab.xiaohe.biz），
# 如 PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh 打 njuserver 变体。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PLATFORM_URL="${PLATFORM_URL:-https://lab.xiaohe.biz}"

[ -d ../nju-lab-client/lib/host ] || { echo "插件未构建：先 cd ../nju-lab-client && npm run build"; exit 1; }

rm -rf dist
mkdir -p dist/stage/nju-lab-client

cp -r ../profiles/nju-lab-student dist/stage/nju-lab-student
cp ../nju-lab-client/package.json ../nju-lab-client/cordis.patch.yml ../nju-lab-client/README.md dist/stage/nju-lab-client/
cp -r ../nju-lab-client/lib dist/stage/nju-lab-client/lib
cp install.sh dist/stage/
chmod +x dist/stage/install.sh
cp README-student.md dist/stage/README.md

# 平台地址按部署目标替换（install.sh 的提示文案 + 学生手册）
if [ "$PLATFORM_URL" != "https://lab.xiaohe.biz" ]; then
  sed -i "s|https://lab.xiaohe.biz|${PLATFORM_URL}|g" dist/stage/install.sh dist/stage/README.md
fi

# 版本凭据：插件自更新靠它判断"本地 ≠ 远端"（见 nju-lab-client/src/host/update.ts）
KIT_VERSION="$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
printf '{"version":"%s"}\n' "$KIT_VERSION" > dist/stage/kit-version.json

(cd dist/stage && zip -qr ../nju-lab-student-kit.zip .)
echo "built: $(du -h dist/nju-lab-student-kit.zip | cut -f1)  dist/nju-lab-student-kit.zip"
