/**
 * 平台侧实验工作台的配置。
 *
 * 环境变量命名与既有模块一致（见 `server/.env.example`）；未配置时取安全默认值。
 * 与镜像侧的约定见 `server/workspace-image/`（尤其 `entrypoint.mjs` 的变量名）。
 */

/** 工作台镜像（构建见 `server/workspace-image/`） */
export const WORKSPACE_IMAGE =
  process.env.WORKSPACE_IMAGE || 'nju-lab-workspace:0.1.5-rc.2';

/** 每容器资源限额（实测 web 空闲约 233MB，1g 余量充足） */
export const WORKSPACE_MEMORY = process.env.WORKSPACE_MEMORY || '1g';
export const WORKSPACE_CPUS = process.env.WORKSPACE_CPUS || '0.5';

/** 容器内转发监听端口（与 workspace-image 的 entrypoint 约定一致） */
export const WORKSPACE_CONTAINER_PORT = Number(
  process.env.WORKSPACE_CONTAINER_PORT || 9090,
);

/**
 * 同时在线的实例上限（防端口/内存耗尽）。
 *
 * 注意：**不用宿主端口映射**——`--internal` 网络下 `-p` 会静默失效（2026-09-28 实测），
 * 对外访问走容器 IP（见 `ContainerRuntime.containerIp`）。
 */
export const WORKSPACE_MAX_TOTAL = Number(process.env.WORKSPACE_MAX_TOTAL || 60);

/**
 * 额外信任的访问 authority（逗号分隔），透传给容器内 dsh 的 `--trusted-host`。
 * 容器会**自动**把自己的 `IP:port` 加进信任列表；只有当 nginx 会改写 `Host`
 * 为其它值（如对外域名）时，才需要在这里补上。
 */
export const WORKSPACE_TRUSTED_HOSTS = (
  process.env.WORKSPACE_TRUSTED_HOSTS || ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** 空闲多久回收（秒） */
export const WORKSPACE_IDLE_TIMEOUT_MS =
  Number(process.env.WORKSPACE_IDLE_TIMEOUT_SECONDS || 1800) * 1000;

/** 回收扫描间隔（秒） */
export const WORKSPACE_SWEEP_INTERVAL_MS =
  Number(process.env.WORKSPACE_SWEEP_INTERVAL_SECONDS || 60) * 1000;

/**
 * 容器 label 键。后端靠它识别"自己的"容器并在重启后回收孤儿。
 * ⚠️ **改名会让旧容器全部变成孤儿**（回收不到，一直占端口/内存）。
 */
export const WORKSPACE_LABEL_KEY = 'nju-lab-workspace';

/**
 * 学生容器要访问的平台 API 基址（如 `http://medai.nju.edu.cn/lab/api`）。
 * 容器跑在出栈隔离网络（无外网路由）里，后端会把这个地址的**主机名**指到宿主网关，
 * 否则 `nju-lab-client` 的 claim/submit 会连不出去。
 */
export const WORKSPACE_PLATFORM_API = process.env.WORKSPACE_PLATFORM_API || '';

/**
 * 反向代理模式的对外基址（如 `http://medai.nju.edu.cn/lab/ws`）。
 * 留空则只返回直连 URL（`http://127.0.0.1:<port>/?token=…`），供本机/内网验证。
 */
export const WORKSPACE_PUBLIC_BASE = process.env.WORKSPACE_PUBLIC_BASE || '';

