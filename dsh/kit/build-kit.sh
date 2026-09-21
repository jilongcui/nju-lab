#!/usr/bin/env bash
# 打包学生端安装包：profile + 插件产物 + install.sh + 学生手册 → dist/nju-lab-student-kit.zip
# 用法：cd dsh/kit && ./build-kit.sh   （插件需先 npm run build）
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

[ -d ../nju-lab-client/lib/host ] || { echo "插件未构建：先 cd ../nju-lab-client && npm run build"; exit 1; }

rm -rf dist
mkdir -p dist/stage/nju-lab-client

cp -r ../profiles/nju-lab-student dist/stage/nju-lab-student
cp ../nju-lab-client/package.json ../nju-lab-client/cordis.patch.yml ../nju-lab-client/README.md dist/stage/nju-lab-client/
cp -r ../nju-lab-client/lib dist/stage/nju-lab-client/lib
cp install.sh dist/stage/
chmod +x dist/stage/install.sh
cp README-student.md dist/stage/README.md

(cd dist/stage && zip -qr ../nju-lab-student-kit.zip .)
echo "built: $(du -h dist/nju-lab-student-kit.zip | cut -f1)  dist/nju-lab-student-kit.zip"
