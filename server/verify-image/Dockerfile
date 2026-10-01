# NJU-Lab 复验一次性容器镜像：dsh headless(锁定 0.2.0-rc.2) + nju-lab-verify
# profile(approval=never) + 复验驱动 run-eval.mjs + 预装教学依赖集。
#
# 构建（在 server/verify-image/ 下）：
#   docker build -t nju-lab-verify:0.2.0-rc.2-pkg1 .
#
# 「包驱动」的两半（见 run-eval.mjs 头部注释与 docs/EXPERIMENT-PACKAGE-SPEC.md）：
#   1) 题目与评分口径随**数据集包**走（manifest.json / task.md / judge.md）——
#      新增实验类型不用改代码、不用重建本镜像。
#   2) 运行环境（Python 依赖 / 命令行工具）**必须预装在本镜像**：复验容器在
#      --internal 网络里没有外网（只放行模型 API 的 SNI 白名单），镜像层只读，
#      容器内 pip install 不可能成功。包内用 manifest.requires 声明依赖，
#      驱动启动前自检，缺了就明确失败（不静默降级）。
#      要加库 = 改下面的「预装依赖集」+ 重建镜像。
#
# 遗留（生产化）：网络白名单代理——当前容器以默认 bridge 网络运行，
# 模型 API 出站与学生 Skill 出站未隔离；生产环境需加 egress 白名单代理
# 并配合 DSH_BASE_URL 指向代理。
# 锁定基底小版本：node:22-slim 是漂浮 tag，v22.18.0 的基底会导致镜像内 sharp
# 原生模块加载失败（2026-09-22 njuserver 实测），与生产保持一致用 22.23.2。
# 跨机部署首选 `docker save | ssh … docker load` 整体同步，不要异地重建。
FROM node:22.23.2-slim

# zstd: 解 session 日志提取 token 用量；unzip: 解提交物/数据集；jq: 包自检与运维排查；
# python3: 学生 Skill 脚本运行时；pip: 装下面的预装依赖集
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      zstd unzip jq python3 python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- 预装依赖集（教学常用集）----
# 覆盖三类最常见的实验：表格数据处理（pandas/numpy/openpyxl）、文本与网页处理
# （requests/beautifulsoup4/lxml/PyYAML）、脚本自测（pytest）。
# 基线镜像里的 Debian 有 PEP668 保护，故显式 --break-system-packages；
# pandas/numpy 钉主版本上限，避免下次重建镜像时被大版本跳跃打乱学生脚本行为。
# 冻结清单（含解析到的精确版本）留在镜像里，供驱动/运维排查与回归对照。
WORKDIR /opt/verify
RUN pip3 install --no-cache-dir --break-system-packages \
      'pandas<4' 'numpy<3' 'openpyxl<4' 'python-dateutil<3' \
      'requests<3' 'beautifulsoup4<5' 'lxml<7' 'PyYAML<7' 'tabulate<1' 'pytest<10' \
 && python3 -m pip freeze > PYTHON-PACKAGES.txt \
 && rm -rf /root/.cache/pip

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY run-eval.mjs ./
COPY profile/ ./profile/

# 每次运行由驱动把 profile 同步进可写的 DSH_HOME（/tmp 即可，容器是一次性的）
ENV DSH_HOME=/tmp/dsh-home \
    DSH_TELEMETRY_DISABLED=1

ENTRYPOINT ["node", "/opt/verify/run-eval.mjs"]
