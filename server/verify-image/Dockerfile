# NJU-Lab 复验一次性容器镜像：dsh headless(锁定 0.1.5-rc.2) + nju-lab-verify
# profile(approval=never) + 复验驱动 run-eval.mjs。
#
# 构建（在 server/verify-image/ 下）：
#   docker build -t nju-lab-verify:0.1.5-rc.2 .
#
# 遗留（生产化）：网络白名单代理——当前容器以默认 bridge 网络运行，
# 模型 API 出站与学生 Skill 出站未隔离；生产环境需加 egress 白名单代理
# 并配合 DSH_BASE_URL 指向代理。
FROM node:22-slim

# zstd: 解 session 日志提取 token 用量；unzip: 解提交物/数据集；python3: 学生 Skill 脚本运行时
RUN apt-get update \
 && apt-get install -y --no-install-recommends zstd unzip python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/verify
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY run-eval.mjs ./
COPY profile/ ./profile/

# 每次运行由驱动把 profile 同步进可写的 DSH_HOME（/tmp 即可，容器是一次性的）
ENV DSH_HOME=/tmp/dsh-home \
    DSH_TELEMETRY_DISABLED=1

ENTRYPOINT ["node", "/opt/verify/run-eval.mjs"]
