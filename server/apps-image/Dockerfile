# 学生应用运行时（第 20 章）—— 只跑一个 stdlib HTTP 服务（app_host.py）+ 学生的 core。
#
# 构建（在 server/apps-image/ 下）：
#   docker build -t nju-lab-app-runtime:0.1.0 .
#
# 为什么基于 nju-lab-verify：它已经带了 python3 + 预装依赖集（matplotlib 等）与 unzip，
# 并且**与学生工作台、复验容器同一个运行时** —— 学生自测能看到什么，平台上就是什么。
# 无外网：容器跑在出栈隔离网络（`ContainerRuntime` 默认 `--network nju-verify-egress(--internal)`）。
FROM nju-lab-verify:0.2.0-rc.2-pkg8

# 普通用户跑（uid 1000 是基底自带的 node，直接复用，不改名：这里不需要交互式 shell）
RUN mkdir -p /work/app /work/data && chown -R 1000:1000 /work

COPY entrypoint.sh /opt/app/entrypoint.sh
RUN chmod +x /opt/app/entrypoint.sh

USER 1000
WORKDIR /work/app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=9200 \
    APP_DATA_DIR=/work/data

ENTRYPOINT ["/opt/app/entrypoint.sh"]
