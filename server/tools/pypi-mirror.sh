#!/usr/bin/env bash
# 把教学依赖集镜像成本机静态 PyPI 索引（PEP 503），供学生在校园网内直接装包。
#
# 用法：
#   bash server/tools/pypi-mirror.sh                # 全部目标
#   bash server/tools/pypi-mirror.sh win-cp312      # 只跑某个目标（调试/补齐用）
#
# 产物（默认 /var/www/lab/pypi，正好是 nginx 的 /lab/ 根，不用做符号链接）：
#   files/*.whl                 各平台 wheel 混放（pip 按 tag 自己挑）
#   simple/<pkg>/index.html     PEP 503 索引页
# 学生侧：python -m pip install --index-url https://<站点>/lab/pypi/simple torch ...
#
# 三条踩过的坑（2026-11-16 实测，别再踩）：
#  ① 宿主 python3 没有 pip → 用复验镜像里的 pip 跑（它支持 --platform/--python-version 交叉下载）。
#  ② **torch 必须 `--no-deps` 单独下**。PyPI 上 Windows/Linux 的 torch 带 CUDA 依赖
#     （nvidia-cudnn 419MB 之类），而且 pip 的 `--platform` 不会改写 `platform_system`
#     环境标记 → 交叉下载会按「宿主是 Linux」去解析依赖，报
#     `Could not find nvidia-nccl-cu13 ... platform_system == "Linux"`。
#     连官方 CPU 索引里的 `+cpu` 轮子也会因此被拖进 CUDA 依赖。
#     所以 torch 只下本体，依赖（filelock/typing-extensions/sympy/networkx/jinja2/fsspec/
#     MarkupSafe/mpmath/setuptools，全是 py3-none-any）单独下一份共用。
#  ③ Intel Mac 的 torch 停在 2.2.2（上游不再出新版）→ mac-intel 目标**跳过 torch**，
#     页面提示用「实验环境」。
# 另：macOS arm64 的 CPU 轮子 tag 是 macosx_14_0_arm64（不是 11_0），写 11_0 会匹配不到。
set -uo pipefail

ROOT="${PYPI_ROOT:-/var/www/lab/pypi}"
IMAGE="${PYPI_VERIFY_IMAGE:-nju-lab-verify:0.2.2-rc.1-pkg1}"
FILES="$ROOT/files"
SIMPLE="$ROOT/simple"
# 日志别放 ROOT 下 —— 那是公开可访问的静态目录
LOG_DIR="${PYPI_LOG_DIR:-${TMPDIR:-/tmp}/nju-lab-pypi-logs}"

CPU_INDEX="https://mirror.sjtu.edu.cn/pytorch-wheels/cpu/"
PYPI_INDEX="https://pypi.org/simple"
TORCH_VERSION="${TORCH_VERSION:-2.14.1}"

# 教学必需集（不含 torch —— 它走 --no-deps 单独下，见文件头②）
PACKAGES=(scikit-learn matplotlib pandas numpy scipy statsmodels
          openpyxl python-dateutil requests beautifulsoup4 lxml PyYAML tabulate pytest)
# torch 的运行时依赖（CPU 版就这些，全是 pure python，各平台通用）
TORCH_DEPS=(filelock typing-extensions sympy networkx jinja2 fsspec MarkupSafe mpmath setuptools)

mkdir -p "$FILES" "$SIMPLE" "$LOG_DIR"
info() { printf '\033[1;36m[pypi]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[pypi] %s\033[0m\n' "$*" >&2; exit 1; }

docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "镜像不存在：$IMAGE（先按 docs/UPGRADE-playbook.md §5 构建）"

# 目标 → "platform_tag|python版本|abi|torch 的写法"（第四段为空 = 该平台不提供 torch）
declare -A TARGETS=(
  [win-cp312]="win_amd64|3.12|cp312|torch==${TORCH_VERSION}+cpu"
  [win-cp313]="win_amd64|3.13|cp313|torch==${TORCH_VERSION}+cpu"
  [mac-arm-cp312]="macosx_14_0_arm64|3.12|cp312|torch==${TORCH_VERSION}"
  [mac-arm-cp313]="macosx_14_0_arm64|3.13|cp313|torch==${TORCH_VERSION}"
  [mac-intel-cp312]="macosx_10_9_x86_64,macosx_10_12_x86_64,macosx_10_13_x86_64,macosx_10_15_x86_64|3.12|cp312|"
  [mac-intel-cp313]="macosx_10_9_x86_64,macosx_10_12_x86_64,macosx_10_13_x86_64,macosx_10_15_x86_64|3.13|cp313|"
  [linux-cp312]="manylinux_2_28_x86_64,manylinux2014_x86_64,manylinux_2_17_x86_64|3.12|cp312|torch==${TORCH_VERSION}+cpu"
  [linux-cp313]="manylinux_2_28_x86_64,manylinux2014_x86_64,manylinux_2_17_x86_64|3.13|cp313|torch==${TORCH_VERSION}+cpu"
)
ORDER=(win-cp312 win-cp313 mac-arm-cp312 mac-arm-cp313 mac-intel-cp312 mac-intel-cp313 linux-cp312 linux-cp313)

# dl <log> <platform> <pyver> <abi> <索引参数...> -- <包...>
dl() {
  local log="$1" platform="$2" pyver="$3" abi="$4"; shift 4
  local -a idx=() pkgs=() plats=() pargs=()
  while [ "$1" != "--" ]; do idx+=("$1"); shift; done
  shift
  pkgs=("$@")
  # 一个目标可能要多个平台 tag：torch 的 wheel 是 manylinux_2_28（或 macosx_14_0），
  # 而 matplotlib 之类是 manylinux2014 / macosx_10_12，pip 的 --platform 是精确匹配。
  IFS=',' read -ra plats <<<"$platform"
  for p in "${plats[@]}"; do pargs+=(--platform "$p"); done
  docker run --rm -v "$FILES:/w" --entrypoint=python3 "$IMAGE" -m pip download -d /w \
    --only-binary=:all: "${pargs[@]}" \
    --python-version "$pyver" --implementation cp --abi "$abi" --no-cache-dir \
    "${idx[@]}" "${pkgs[@]}" >>"$log" 2>&1
}

download_target() {
  local name="$1" spec="${TARGETS[$1]}"
  local platform="${spec%%|*}" rest="${spec#*|}"
  local pyver="${rest%%|*}" rest="${rest#*|}"
  local abi="${rest%%|*}" torch_spec="${rest#*|}"
  local log="$LOG_DIR/$name.log"
  local note=""
  [ -n "$torch_spec" ] && note=" / $torch_spec" || note=" / 不含 torch"
  info "== $name（$platform / py$pyver$note）=="

  # ① torch 本体（--no-deps，见文件头②）
  if [ -n "$torch_spec" ]; then
    if ! dl "$log" "$platform" "$pyver" "$abi" \
        --index-url "$CPU_INDEX" --extra-index-url "$PYPI_INDEX" --no-deps -- "$torch_spec"; then
      printf '\033[1;31m  ✗ %s / torch 失败\033[0m\n' "$name"; grep -E "ERROR" "$log" | tail -3; return 1
    fi
  fi

  # ② 其它教学包（正常解析依赖）
  if ! dl "$log" "$platform" "$pyver" "$abi" --index-url "$PYPI_INDEX" -- "${PACKAGES[@]}"; then
    printf '\033[1;31m  ✗ %s / 教学包 失败\033[0m\n' "$name"; grep -E "ERROR" "$log" | tail -3; return 1
  fi

  # ③ torch 的 pure-python 依赖（跨平台通用；重复跑 pip 会跳过已有文件）
  if [ -n "$torch_spec" ]; then
    dl "$log" "$platform" "$pyver" "$abi" --index-url "$PYPI_INDEX" -- "${TORCH_DEPS[@]}" || true
  fi
  info "  ✓ $name（累计 $(ls -1 "$FILES" | wc -l) 个 wheel）"
}

gen_index() {
  info "生成索引页 → $SIMPLE"
  local tmp="$SIMPLE.new"
  rm -rf "$tmp"; mkdir -p "$tmp"
  FILES="$FILES" OUT="$tmp" python3 - <<'PY'
import os, re, html, collections, pathlib
files = pathlib.Path(os.environ["FILES"]); out = pathlib.Path(os.environ["OUT"])
norm = lambda n: re.sub(r"[-_.]+", "-", n).lower()
groups = collections.defaultdict(list)
for whl in sorted(files.glob("*.whl")):
    groups[norm(whl.name.split("-")[0])].append(whl.name)
for pkg, whls in groups.items():
    d = out / pkg; d.mkdir(parents=True, exist_ok=True)
    links = "\n".join(f'    <a href="../../files/{html.escape(w)}">{html.escape(w)}</a><br/>' for w in whls)
    (d / "index.html").write_text(
        f'<!DOCTYPE html><html><head><meta charset="utf-8"><title>{pkg}</title></head>\n'
        f'<body><h1>{pkg}</h1>\n{links}\n</body></html>\n', encoding="utf-8")
(out / "index.html").write_text(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NJU-Lab PyPI mirror</title></head>\n'
    "<body><h1>NJU-Lab PyPI mirror</h1>\n"
    + "\n".join(f'  <a href="{p}/">{p}</a><br/>' for p in sorted(groups))
    + "\n</body></html>\n", encoding="utf-8")
print(f"  包数 {len(groups)}，wheel 数 {sum(len(v) for v in groups.values())}")
PY
  rm -rf "$SIMPLE"; mv "$tmp" "$SIMPLE"
}

only="${1:-}"
failed=0
if [ -n "$only" ]; then
  [ -n "${TARGETS[$only]:-}" ] || fail "未知目标：$only（可选：${ORDER[*]}）"
  download_target "$only" || failed=1
else
  for name in "${ORDER[@]}"; do download_target "$name" || failed=1; done
fi

gen_index
echo
du -sh "$ROOT" | sed 's/^/  体积 /'
info "学生侧验证：python -m pip install --index-url <站点>/lab/pypi/simple numpy"
[ "$failed" -eq 0 ] || info "有目标失败，见 $LOG_DIR/*.log（其它目标仍可用）"
exit "$failed"
