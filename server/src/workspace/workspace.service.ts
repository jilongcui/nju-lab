import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AuthService } from '../auth/auth.service';
import { ContainerRuntime } from '../container-runtime/container-runtime';
import { User } from '../users/user.entity';
import {
  WORKSPACE_CONTAINER_PORT,
  WORKSPACE_CPUS,
  WORKSPACE_DATA_DIR,
  WORKSPACE_IDLE_TIMEOUT_MS,
  WORKSPACE_KEY_LABEL,
  WORKSPACE_IMAGE,
  WORKSPACE_LABEL_KEY,
  WORKSPACE_MAX_TOTAL,
  WORKSPACE_MEMORY,
  WORKSPACE_BRIDGE_PORT,
  WORKSPACE_PLATFORM_API,
  WORKSPACE_PUBLIC_BASE,
  WORKSPACE_PUBLIC_BASE_KEY_PLACEHOLDER,
  WORKSPACE_SWEEP_INTERVAL_MS,
  WORKSPACE_TRUSTED_HOSTS,
  WORKSPACE_WS_BRIDGE,
} from './workspace.config';

export type WorkspaceStatus = 'starting' | 'running' | 'failed';

export interface WorkspaceInfo {
  status: WorkspaceStatus;
  /** 容器内 dsh 就绪后才非 null —— 学生用它拼工作台 URL */
  wsKey: string | null;
  /** dsh 的 launch token；`?token=` 不可省（否则 browser-trust fence 一律 401） */
  token: string | null;
  /** 容器在隔离网络里的 `ip:port`（nginx 反代的目标）；就绪前为 null */
  upstream: string | null;
  /** 直连 URL（本机/内网验证用） */
  directUrl: string | null;
  /** 反代基址（配置了 `WORKSPACE_PUBLIC_BASE` 时非空） */
  publicBase: string | null;
  /**
   * 前端「进入实验环境」应该导航到的**入口**（相对 API 路径，前端用 `apiUrl()` 转成带部署前缀）。
   * 就绪前为 null。
   *
   * ⚠️ 不要直接打开 `publicBase`/`directUrl`：反代形态（尤其形态 B 的 cookie 分流）需要先经过
   * 入口把会话 cookie 种下，否则 dsh 写死的根路径请求（`/api/**` 等）路由不到容器。
   * 见 `docs/DESIGN-2026-09-28-platform-workspace.md` §4.5.2。
   */
  enterUrl: string | null;
  startedAt: number;
  lastSeenAt: number;
  error?: string;
}

interface Session {
  userId: string;
  /**
   * URL 里的不透明键（16 字节 hex＝32 字符）。
   *
   * ⚠️ 必须是**大小写安全**的编码（hex）：它会作为**子域**出现（`<key>.<域>`），
   * 而 URL 规范与浏览器都会把 hostname 小写化（`new URL(...).host` 同样如此），
   * 大小写敏感编码（base64url）会在这里被改写 → `auth_request` 拿小写 key
   * 查不到会话 → 一律 403（2026-09-28 实测踩过）。
   * **不要拿 userId 当 URL 参数**。
   */
  wsKey: string;
  containerName: string;
  status: WorkspaceStatus;
  token: string | null;
  containerIp: string | null;
  startedAt: number;
  lastSeenAt: number;
  error?: string;
}

/**
 * 平台侧实验工作台的生命周期管理。
 *
 * 设计要点（详见 `docs/DESIGN-2026-09-28-platform-workspace.md`）：
 * - **状态只存在于内存**：容器靠 label 识别，后端启动时把上一个进程遗留的容器全部回收。
 *   token 只活在内存里、无法跨进程恢复，所以"重启即重置"是刻意的简化。
 * - **一人一容器**，容器内是单用户单会话的 dsh —— 不在服务端引入任何多租户状态。
 * - **对外访问走容器 IP，不用宿主端口映射**：`--internal` 网络下 `-p` 会静默失效，
 *   而宿主对该网段有直连路由（`br-xxxx` 的 `172.18.0.1/16`），nginx 直接反代 `ip:port`。
 * - 就绪是**惰性探测**的：`start` 立即返回 `starting`，前端轮询 `status` 时才去读
 *   容器日志取 launch token（dsh web 启动要 20-30s，不适合放在请求里阻塞）。
 */
@Injectable()
export class WorkspaceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly sessions = new Map<string, Session>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly auth: AuthService,
  ) {}

  onModuleInit(): void {
    this.adoptOrReclaim();
    this.sweepTimer = setInterval(
      () => this.sweep(),
      WORKSPACE_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer?.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** 启动（或复用）当前用户的工作台。立即返回，就绪状态由 `status` 惰性推进。 */
  start(user: User): WorkspaceInfo {
    const existing = this.sessions.get(user.id);
    if (existing && existing.status !== 'failed') {
      if (this.runtime.isRunning(existing.containerName)) {
        existing.lastSeenAt = Date.now();
        return this.advance(existing);
      }
      // 容器已不在（崩溃或被外部清理）：丢掉旧状态，走重建
      this.sessions.delete(user.id);
    }

    const live = [...this.sessions.values()].filter(
      (s) => s.status !== 'failed',
    ).length;
    if (live >= WORKSPACE_MAX_TOTAL) {
      throw new ServiceUnavailableException(
        `工作台实例数已达上限（${WORKSPACE_MAX_TOTAL}），请稍后再试`,
      );
    }

    const containerName = this.containerName(user.id);
    this.runtime.stop(containerName); // 清掉可能存在的同名残留

    const session: Session = {
      userId: user.id,
      wsKey: randomBytes(16).toString('hex'),
      containerName,
      status: 'starting',
      token: null,
      containerIp: null,
      startedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    this.sessions.set(user.id, session);

    const trustedHosts = this.trustedHosts(session.wsKey);
    const mounts = this.studentMounts(user.id);
    // 兜底环境里**不该让学生自己填 token**：后端替他签发一个短时效 token 注入容器，
    // 插件（nju-lab-client）读 NJU_LAB_TOKEN / NJU_LAB_SERVER_URL 即可领任务、提交。
    const apiToken = this.auth.issueWorkspaceToken(user).accessToken;
    try {
      this.runtime.runDetached({
        name: containerName,
        image: WORKSPACE_IMAGE,
        memory: WORKSPACE_MEMORY,
        cpus: WORKSPACE_CPUS,
        // 与复验共用同一套出栈隔离：internal 网络 + 白名单域名钉到 SNI 代理
        egressProxyIp: this.runtime.ensureEgressProxy(),
        extraHosts: this.platformHosts(),
        labels: [
          `${WORKSPACE_LABEL_KEY}=${user.id}`,
          // 会话键也落到 label：后端重启后接管时读回来，学生的 URL/cookie 才能继续有效
          `${WORKSPACE_KEY_LABEL}=${session.wsKey}`,
        ],
        // 持久卷：学生的文件与会话历史（容器重建也不丢；目录不可写时为空数组）
        mounts,
        env: [
          // **必须**带上本次会话的对外 authority（`<wsKey>.<域>`）：
          // dsh 的 WebSocket（`/api/remote.mux`）会校验 `Origin` 与它看到的 `Host`
          // 是否一致/是否受信任，而浏览器的 Origin 正是这个外部 authority。
          // 容器只会自动信任自己的 `IP:port`，所以外部域名必须显式传进去，
          // 否则 HTTP 能通、**WebSocket 一律 403**（2026-09-28 实测）。
          ...(trustedHosts.length
            ? [`WORKSPACE_TRUSTED_HOSTS=${trustedHosts.join(',')}`]
            : []),
          `WORKSPACE_PROXY_PORT=${WORKSPACE_CONTAINER_PORT}`,
          // 是否在容器内启动 WS→HTTPS 桥（网关不透传 WS 时的替代通道）
          `WORKSPACE_WS_BRIDGE=${WORKSPACE_WS_BRIDGE ? '1' : '0'}`,
          ...(WORKSPACE_PLATFORM_API
            ? [`NJU_LAB_SERVER_URL=${WORKSPACE_PLATFORM_API}`]
            : []),
          `NJU_LAB_TOKEN=${apiToken}`,
        ],
      });
      this.logger.log(
        `workspace started: user=${user.id} container=${containerName}`,
      );
    } catch (e) {
      session.status = 'failed';
      session.error = e instanceof Error ? e.message : String(e);
      throw e;
    }
    return this.advance(session);
  }

  /** 查询状态（顺带推进"启动中 → 就绪"的惰性探测） */
  status(userId: string): WorkspaceInfo | null {
    const s = this.sessions.get(userId);
    return s ? this.advance(s) : null;
  }

  /** 结束工作台（幂等） */
  stop(userId: string): void {
    const s = this.sessions.get(userId);
    this.runtime.stop(s?.containerName ?? this.containerName(userId));
    this.sessions.delete(userId);
    this.logger.log(`workspace stopped: user=${userId}`);
  }

  /**
   * 供 nginx `auth_request` 调用：用不透明 `wsKey` 换容器 `ip:port`。
   *
   * ⚠️ 这是**能力凭证**语义（`wsKey` 为 16 字节 hex、仅在会话存活期内有效）。
   * 之所以不在这里校验平台 JWT：浏览器是**直接导航**到工作台 URL 的，
   * 带不上 `Authorization` 头。取舍详见设计文档 §4.6。
   *
   * **严格语义**（页面入口用）：查不到/未就绪一律 403 —— 伪造 key 必须被拒。
   */
  resolveUpstream(wsKey: string): string {
    const upstream = this.resolveUpstreamOrNull(wsKey);
    if (upstream) return upstream;
    for (const s of this.sessions.values()) {
      if (s.wsKey !== wsKey) continue;
      throw new ForbiddenException(
        s.status === 'failed' ? '工作台启动失败' : '工作台尚未就绪',
      );
    }
    throw new ForbiddenException('工作台会话不存在或已回收');
  }

  /**
   * 同 `resolveUpstream`，但**查不到会话时返回 `null` 而不是抛错**。
   *
   * 用途：nginx 把 dsh 写死的**根路径前缀**（`/api/**`、`/plugins/**`、`/open-in-app/**`）
   * 按 cookie 分流到工作台容器 —— 但同一个 server 上还跑着 FoxCMS/dify，
   * 它们自己的请求（没有工作台 cookie，或 cookie 已过期）必须能**原样回落**到原来的
   * location。所以这种场景下"无会话"是正常结果，不是错误（→ 204 + 无 header）。
   */
  resolveUpstreamOrNull(wsKey: string): string | null {
    if (!wsKey) return null;
    for (const s of this.sessions.values()) {
      if (s.wsKey !== wsKey) continue;
      if (s.status !== 'running' || !s.containerIp) return null;
      s.lastSeenAt = Date.now();
      return `${s.containerIp}:${WORKSPACE_CONTAINER_PORT}`;
    }
    return null;
  }

  /**
   * 反代入口（「cookie 分流」形态）：校验会话并返回 dsh 的 launch token。
   *
   * 调用方（`WorkspaceController.enter`）据此种下会话 cookie 并 302 到工作台首页。
   * 之所以要这一步，而不是让浏览器直接打开 `?token=…`：dsh 写死的根路径请求
   * （`/api/**`、`/plugins/**`、`/open-in-app/**`）里没有会话标识，nginx 只能按
   * cookie 认领容器 —— 首次进入必须先有 cookie。详见设计文档 §4.5.2。
   */
  enter(wsKey: string): { token: string } | null {
    if (!wsKey) return null;
    for (const s of this.sessions.values()) {
      if (s.wsKey !== wsKey) continue;
      if (s.status !== 'running' || !s.token) return null;
      s.lastSeenAt = Date.now();
      return { token: s.token };
    }
    return null;
  }

  // ---------- 内部 ----------

  /**
   * 推进一次状态：`starting` 时读容器日志找 launch token，并记下容器 IP。
   * 惰性（由前端轮询驱动）而非阻塞 `start`，因为 dsh web 启动要 20-30s。
   */
  private advance(s: Session): WorkspaceInfo {
    if (s.status === 'starting') {
      if (!this.runtime.isRunning(s.containerName)) {
        s.status = 'failed';
        s.error = `容器已退出：${this.runtime.logs(s.containerName).slice(-300)}`;
      } else {
        const token = this.readToken(s.containerName);
        if (token) {
          s.token = token;
          s.containerIp = this.runtime.containerIp(s.containerName);
          s.status = 'running';
          this.logger.log(
            `workspace ready: user=${s.userId} upstream=${s.containerIp}:${WORKSPACE_CONTAINER_PORT}`,
          );
        }
      }
    }
    return this.toInfo(s);
  }

  /** 从容器日志里取 entrypoint 打的 `WORKSPACE_TOKEN=` */
  private readToken(containerName: string): string | null {
    const m = /WORKSPACE_TOKEN=([A-Za-z0-9_-]+)/.exec(
      this.runtime.logs(containerName),
    );
    return m ? m[1] : null;
  }

  private toInfo(s: Session): WorkspaceInfo {
    const ready = s.status === 'running' && s.token !== null;
    const upstream = ready && s.containerIp
      ? `${s.containerIp}:${WORKSPACE_CONTAINER_PORT}`
      : null;
    return {
      status: s.status,
      wsKey: ready ? s.wsKey : null,
      token: ready ? s.token : null,
      upstream,
      directUrl: ready && upstream
        ? `http://${upstream}/?token=${s.token}`
        : null,
      publicBase: ready ? this.publicBase(s.wsKey) : null,
      enterUrl: ready ? `/api/workspace/enter?k=${s.wsKey}` : null,
      startedAt: s.startedAt,
      lastSeenAt: s.lastSeenAt,
      error: s.error,
    };
  }

  /**
   * 对外基址：把 `{key}` 替换成该会话的 `wsKey`。未配置 `WORKSPACE_PUBLIC_BASE` 时为 null。
   *
   * ⚠️ 基址必须**带上 `{key}`**（每会话一个子域）：dsh 的运行时路径锚定 origin 根，
   * 无法在子路径下工作（见 `workspace.config.ts` 与设计文档 §4.5）。
   */
  private publicBase(wsKey: string): string | null {
    if (!WORKSPACE_PUBLIC_BASE) return null;
    return WORKSPACE_PUBLIC_BASE.split(WORKSPACE_PUBLIC_BASE_KEY_PLACEHOLDER).join(
      wsKey,
    );
  }

  /**
   * 要传给容器内 dsh 的 `--trusted-host` authority 列表：
   * 本次会话的**对外 authority**（`{key}` 展开后的 host，含端口）＋ 全局补充项。
   *
   * 为什么必须传：dsh 只信任显式声明的 authority，容器自动加的只有它自己的
   * `IP:port`。nginx 反代若把 `Host` 传成外部域名（WebSocket 必须如此，否则
   * `Origin` 与 `Host` 不一致 → 403），这个域名就得先在信任列表里。
   */
  private trustedHosts(wsKey: string): string[] {
    const hosts = [...WORKSPACE_TRUSTED_HOSTS];
    const base = this.publicBase(wsKey);
    if (base) {
      try {
        hosts.push(new URL(base).host);
      } catch {
        this.logger.warn(
          `WORKSPACE_PUBLIC_BASE 不是合法 URL，容器将不信任外部 authority：${base}`,
        );
      }
    }
    return [...new Set(hosts.filter(Boolean))];
  }

  /**
   * 后端重启后的处置：**能接回来的就接回来，其余回收**。
   *
   * 为什么可以接：容器还在跑，dsh 的 launch token 一直留在它的日志里（`readToken`），
   * 容器 IP 也能查到 —— 于是"重启后端"不再等于"学生的环境被清空"（2026-09-29 之前的行为）。
   *
   * 什么时候必须回收：
   *   · 容器已不在运行（dsh 崩溃时 entrypoint 会让容器退出）；
   *   · 容器所用的**镜像与当前配置不一致**（说明镜像升级过，接回来的仍是旧环境）；
   *   · 读不到 token / 拿不到 IP（状态不完整，学生进去也是坏的）。
   *
   * ⚠️ 唯一无法恢复的是 `wsKey`（内存里的随机值）→ 接管时**重新生成**：
   *    学生回「实验环境」页会看到"已就绪"，点一次「进入」即可（**仍是同一个容器**，文件与历史都在）。
   */
  private adoptOrReclaim(): void {
    const wantedImage = this.runtime.imageId(WORKSPACE_IMAGE);
    for (const name of this.runtime.listByLabel(WORKSPACE_LABEL_KEY)) {
      const userId = this.runtime.labelValue(name, WORKSPACE_LABEL_KEY);
      const drop = (why: string) => {
        this.logger.warn(`reclaiming workspace container ${name}: ${why}`);
        this.runtime.stop(name);
      };
      if (!userId) { drop('缺少 label'); continue; }
      if (!this.runtime.isRunning(name)) { drop('容器未运行'); continue; }
      const image = this.runtime.containerImageId(name);
      if (wantedImage && image && image !== wantedImage) {
        drop(`镜像已升级（容器 ${image.slice(7, 19)} ≠ 当前 ${wantedImage.slice(7, 19)}）`);
        continue;
      }
      const token = this.readToken(name);
      const ip = this.runtime.containerIp(name);
      if (!token || !ip) { drop('读不到 launch token 或容器 IP'); continue; }

      // 会话键从 label 读回 —— 于是"接管"对学生是无感的（URL 与 cookie 都不用换）；
      // 只有拿不到 label（更早版本的容器）才退回"新生成一个"
      const adoptedKey = this.runtime.labelValue(name, WORKSPACE_KEY_LABEL)
        ?? randomBytes(16).toString('hex');
      this.sessions.set(userId, {
        userId,
        wsKey: adoptedKey,
        containerName: name,
        status: 'running',
        token,
        containerIp: ip,
        startedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      this.logger.log(`workspace adopted: user=${userId} container=${name}`);
    }
  }

  /**
   * 学生的持久化挂载：`<WORKSPACE_DATA_DIR>/<userId>` → `/work`（dsh 的工作目录）
   * 与其中的 `dsh-sessions` → `$DSH_HOME/sessions`（会话历史）。
   * 目录不可写（例如 `/data` 被只读挂载）时只告警并返回空 —— **不能因此让学生起不了容器**。
   */
  private studentMounts(userId: string): string[] {
    if (!WORKSPACE_DATA_DIR) return [];
    const dir = join(WORKSPACE_DATA_DIR, userId);
    const sessions = join(dir, 'dsh-sessions');
    try {
      mkdirSync(sessions, { recursive: true });
    } catch (e) {
      this.logger.warn(
        `工作区目录不可写，本次不挂载持久卷（学生的文件将随容器消失）：${dir} —— ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return [];
    }
    return [`${dir}:/work`, `${sessions}:/opt/workspace/dsh-home/sessions`];
  }

  private sweep(): void {
    const now = Date.now();
    for (const [userId, s] of this.sessions) {
      if (now - s.lastSeenAt <= WORKSPACE_IDLE_TIMEOUT_MS) continue;
      this.logger.log(`workspace idle-reclaimed: user=${userId}`);
      this.runtime.stop(s.containerName);
      this.sessions.delete(userId);
    }
  }

  private containerName(userId: string): string {
    return `nju-ws-${userId.slice(0, 8)}`;
  }

  /**
   * 让容器能访问平台 API：容器在 internal 网络（无外网路由）里，
   * 把平台域名指到宿主网关（`host-gateway`，需 Docker 20.10+）。
   * 不做这一步，`nju-lab-client` 的 claim/submit 连不出去。
   */
  private platformHosts(): string[] {
    if (!WORKSPACE_PLATFORM_API) return [];
    let hostname: string;
    try {
      hostname = new URL(WORKSPACE_PLATFORM_API).hostname;
    } catch {
      this.logger.warn(
        `WORKSPACE_PLATFORM_API 不是合法 URL，容器将无法访问平台：${WORKSPACE_PLATFORM_API}`,
      );
      return [];
    }
    // ⚠️ 必须是宿主在**出栈隔离网络**里的地址，不是 `host-gateway`（那是默认 bridge 的
    //    172.17.0.1，隔离容器没有到它的路由 → ENETUNREACH，实测踩过）。
    const gateway = this.runtime.egressGateway();
    if (!gateway) {
      this.logger.warn(
        `取不到出栈网络网关，容器将无法访问平台 API：${WORKSPACE_PLATFORM_API}`,
      );
      return [];
    }
    return [`${hostname}:${gateway}`];
  }
}
