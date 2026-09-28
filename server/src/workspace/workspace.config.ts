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

/** WS→HTTPS 桥的容器内端口（bridge.mjs 监听它；nginx 用它做 /wsbridge/ 的上游） */
export const WORKSPACE_BRIDGE_PORT = Number(
  process.env.WORKSPACE_BRIDGE_PORT || 9091,
);

/**
 * 是否启用「WS→HTTPS 桥」：校园网关（TLS 终止那层）不透传 WebSocket 升级时，
 * dsh 的实时通道必须改走普通 HTTPS（见 `workspace-image/bridge.mjs` 与设计文档 §4.6.1）。
 * 网关上开放 WS 之后，把它设为 `0` 即切回原生 WebSocket —— 页面适配脚本探测不到桥会
 * 自动退回原生实现，**不需要改前端或 nginx**。
 */
export const WORKSPACE_WS_BRIDGE = !/^(0|false|no|off)$/i.test(
  process.env.WORKSPACE_WS_BRIDGE ?? '1',
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
 * 反向代理模式的对外基址，**支持 `{key}` 占位符**（替换为该会话的 `wsKey`）。
 * 留空则只返回直连 URL（`http://127.0.0.1:<port>/?token=…`），供本机/内网验证。
 *
 * ⚠️ 必须是**每个会话独占的 authority**，即带上 `{key}` 子域：
 *     `https://{key}.ws.example.com`
 *
 * 为什么不能走 `/lab/ws/<key>/` 这种子路径（2026-09-28 实测，见设计文档 §4.5）：
 * 浏览器里的 dsh 把运行时路径全部锚定在 **origin 根**——
 * RPC `new URL("/api/…", location.origin)`、WebSocket `wss://<origin>/api/remote.mux`、
 * SSE `/plugins/events`、插件包 `/plugins/??…`（HTML 里的绝对路径）。
 * 这些都不随页面路径走，nginx 的 `sub_filter`/`proxy_redirect` 改不动运行时拼接；
 * 子路径方案下它们会打到宿主根的 `/api`（njuserver 上是 dify）而全废。
 *
 * 后端会把该 authority（`URL(...).host`，如 `abc123.ws.example.com`）作为
 * per-session `--trusted-host` 传给容器 —— 不传的话 WebSocket 会被 dsh 的
 * cross-origin 检查直接 403（`Origin` 与容器看到的 `Host` 不一致）。
 */
export const WORKSPACE_PUBLIC_BASE = process.env.WORKSPACE_PUBLIC_BASE || '';

/** `WORKSPACE_PUBLIC_BASE` 里的会话键占位符 */
export const WORKSPACE_PUBLIC_BASE_KEY_PLACEHOLDER = '{key}';


/**
 * 反代路径前缀（「cookie 分流」形态用）：必须与 nginx 的 location 前缀一致
 * （`lab-nginx-snippet.conf`）。入口 `/api/workspace/enter` 会把浏览器跳到这里。
 */
export const WORKSPACE_PROXY_PATH = process.env.WORKSPACE_PROXY_PATH || '/lab/ws';

/**
 * 会话 cookie 名。必须与 nginx 里的 `$cookie_<name>` 一致 ——
 * nginx 的变量名不允许 `-`，所以用下划线（`nju_ws` ↔ `$cookie_nju_ws`）。
 */
export const WORKSPACE_SESSION_COOKIE = 'nju_ws';

/**
 * 学生工作区的持久化根目录（**宿主**路径）。
 *
 * 挂两处进容器：`<根>/<userId>` → `/work`（dsh 的工作目录 —— 学生的文件就落在这里）、
 * `<根>/<userId>/dsh-sessions` → `$DSH_HOME/sessions`（dsh 的会话历史）。
 * 于是**容器被删/重建**（镜像升级、异常退出、重启后端）也不丢文件与历史。
 *
 * 留空 = 关闭持久化（退回"容器内数据随容器消失"）。
 * ⚠️ 目录不可写时（例如 `/data` 被内核以只读挂载）后端**只告警、不挂载**，不影响学生用。
 */
export const WORKSPACE_DATA_DIR = process.env.WORKSPACE_DATA_DIR ?? '/data/workspaces';

/**
 * 把会话键也写进容器 label（`nju-lab-workspace-key=<wsKey>`）。
 *
 * 用途：后端重启后**接管**容器时读回它，于是学生的 URL 与 cookie **继续有效** ——
 * 否则 wsKey 是内存里的随机值，重启就得让每个学生重新点一次「进入」。
 */
export const WORKSPACE_KEY_LABEL = 'nju-lab-workspace-key';

/**
 * 要**透传**给工作台容器的模型 API key（环境变量名，逗号分隔）。
 *
 * 兜底环境由平台统一提供模型额度 —— 学生本地 DSH 用自己的 key，兜底环境用平台的，
 * 语义清晰；否则学生在这个环境里连一句话都发不出去。
 *
 * ⚠️ 透传方式是 `docker run -e <NAME>`（**只写变量名、不写值**），所以 key 不会出现在
 * 宿主进程列表里；但容器内学生能看到它（那本来就是给他的环境）——部署时请知悉，
 * 并考虑对该 key 做额度限制。
 */
export const WORKSPACE_LLM_ENV = (
  process.env.WORKSPACE_LLM_ENV || 'DEEPSEEK_API_KEY,MOONSHOT_API_KEY'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
