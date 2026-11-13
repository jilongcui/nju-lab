#!/bin/sh
# 打包 + 结构/依赖自检（不烧 token）。完整复验见 README「本地验证」第 2 步。
set -eu
cd "$(dirname "$0")/.."
IMG="${VERIFY_IMAGE:-nju-lab-verify:0.2.0-rc.2-pkg10}"
(cd problem && rm -f ../problem.zip && zip -qr ../problem.zip .)
(cd skill-template && rm -f ../skill-template.zip && zip -qr ../skill-template.zip .)
docker run --rm -v "$PWD:/p:ro" "$IMG" --check --skill /p/skill-template.zip --problem /p/problem.zip
echo "OK: problem.zip / skill-template.zip 结构 + 依赖自检通过（$IMG）"
