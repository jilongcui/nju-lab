/**
 * 学生应用（第 20 章）托管配置。
 *
 * 与工作台（`workspace.config.ts`）同构：**不用宿主端口映射**（`--internal` 网络下 `-p` 静默失效），
 * 对外访问由后端反代容器 IP。区别是这里起的是**一次性的应用容器**而不是长驻工作台：
 * 空闲 15 分钟回收、全局并发上限更低（一期 10）。
 *
 * 完整的平台方案见 `docs/DESIGN-2026-11-agent-app-platform.md`。
 */

/** 应用运行时镜像（构建见 `server/apps-image/`） */
export const AGENT_APP_IMAGE =
  process.env.AGENT_APP_IMAGE || 'nju-lab-app-runtime:0.1.0';

/** 容器内 `app_host.py` 监听的端口 */
export const AGENT_APP_PORT = Number(process.env.AGENT_APP_PORT || 9200);

/** 每容器资源限额（应用比工作台轻：只跑一个 stdlib HTTP 服务） */
export const AGENT_APP_MEMORY = process.env.AGENT_APP_MEMORY || '512m';
export const AGENT_APP_CPUS = process.env.AGENT_APP_CPUS || '0.3';

/** 空闲多久回收（秒） */
export const AGENT_APP_IDLE_MS =
  Number(process.env.AGENT_APP_IDLE_SECONDS || 900) * 1000;

/** 回收扫描间隔（秒） */
export const AGENT_APP_SWEEP_MS =
  Number(process.env.AGENT_APP_SWEEP_SECONDS || 60) * 1000;

/** 同时运行的应用容器上限（一期防资源耗尽；超了排队交给前端重试） */
export const AGENT_APP_MAX_TOTAL = Number(process.env.AGENT_APP_MAX_TOTAL || 10);

/**
 * 应用产物的宿主目录：`<根>/<appId>/<versionId>.zip`。
 *
 * 默认放在 `workspaces` 底下而不是 `/data/agent-apps`：`/data` 属于 root（`nobody:nogroup`），
 * 建子目录要 sudo，而部署沙箱不允许；`/data/workspaces` 已经是可写的学生数据根。
 */
export const AGENT_APP_DATA_DIR =
  process.env.AGENT_APP_DATA_DIR || '/data/workspaces/agent-apps';

/** 上传 zip 的大小上限 */
export const AGENT_APP_ZIP_MAX = Number(process.env.AGENT_APP_ZIP_MAX || 30 * 1024 * 1024);

/** 容器 label（后端靠它识别"自己的"应用容器） */
export const AGENT_APP_LABEL = 'nju-lab-agent-app';
export const AGENT_APP_LABEL_ID = 'nju-lab-agent-app-id';
