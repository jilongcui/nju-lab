# NJU-Lab 平台侧实验工作台镜像
#
# 设计见 docs/DESIGN-2026-09-28-platform-workspace.md；用法见本目录 README.md。
#
# 构建（build context **必须是仓库根**，因为要 COPY dsh/nju-lab-client）：
#   docker build -f server/workspace-image/Dockerfile -t nju-lab-workspace:0.2.0-rc.2-pkg8 .
#
# ---- 为什么基座是 nju-lab-verify 而不是 node:22.23.2-slim ----
# 本机 docker.io 直连不通（见 HANDOFF §2.1）；华为云源的 node:22-slim 是 **v22.18.0**，
# 而 verify-image/Dockerfile 明确记录过 v22.18.0 的基底会导致 sharp 加载失败。
# 本机唯一带正确 node（v22.23.2）+ dsh 0.2.0-rc.2 的镜像就是 nju-lab-verify ——
# 复用它作基座，顺带保证**工作台与复验跑同一个 dsh 运行时**，并让学生工作台
# 拿到与复验一致的**预装依赖集**（pandas/numpy/pytest 等，见 verify-image/Dockerfile）。
# 若要在有 docker.io 的机器上从零构建：把 FROM 换成 node:22.23.2-slim，并参照
# server/verify-image/Dockerfile 补 `npm ci`（本目录的 package.json / package-lock.json
# 就是为这条路径准备的，依赖与复验镜像完全相同）。
FROM nju-lab-verify:0.2.0-rc.2-pkg6

# 基座（verify-image）已装 python3 / pip 预装依赖集 / unzip / zstd / jq / ca-certificates，无需重装

WORKDIR /opt/workspace

# 1) 学生插件 nju-lab-client（本地包，必须先构建出 lib/）
COPY dsh/nju-lab-client/ ./nju-lab-client/
RUN cd ./nju-lab-client \
 && npm ci --no-audit --no-fund \
 && npm run build \
 && npm cache clean --force

# 2) DSH_HOME：profile 与插件解析（容器一次性，运行时不复制）
ENV DSH_HOME=/opt/workspace/dsh-home \
    DSH_TELEMETRY_DISABLED=1
COPY server/workspace-image/profile/ ${DSH_HOME}/profiles/
# profile 的 `file:../../nju-lab-client` 从 profile 目录出发解析到 ${DSH_HOME}/nju-lab-client；
# 而 bundle 名 `nju-lab-client` 还要在 profile 的 node_modules 里可见
RUN ln -s /opt/workspace/nju-lab-client ${DSH_HOME}/nju-lab-client \
 && mkdir -p ${DSH_HOME}/profiles/nju-lab-workspace/node_modules \
 && ln -s /opt/workspace/nju-lab-client ${DSH_HOME}/profiles/nju-lab-workspace/node_modules/nju-lab-client

# 3) 复用基座里已装好的 dsh 运行时（/opt/verify/node_modules，含 dsh-web-app）
RUN ln -s /opt/verify/node_modules /opt/workspace/node_modules
ENV PATH=/opt/workspace/node_modules/.bin:$PATH

# 4) 入口：容器内转发 + dsh web（+ 可选的 WS→HTTPS 桥，见 entrypoint.mjs / bridge.mjs）
COPY server/workspace-image/entrypoint.mjs server/workspace-image/bridge.mjs server/workspace-image/ws-bridge-client.js ./
EXPOSE 9090 9091
ENTRYPOINT ["node", "/opt/workspace/entrypoint.mjs"]
