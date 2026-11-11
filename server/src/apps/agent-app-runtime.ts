import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ContainerRuntime } from '../container-runtime/container-runtime';
import { WORKSPACE_PLATFORM_API } from '../workspace/workspace.config';
import {
  AGENT_APP_CPUS,
  AGENT_APP_DATA_DIR,
  AGENT_APP_IDLE_MS,
  AGENT_APP_IMAGE,
  AGENT_APP_LABEL,
  AGENT_APP_LABEL_ID,
  AGENT_APP_MAX_TOTAL,
  AGENT_APP_MEMORY,
  AGENT_APP_PORT,
  AGENT_APP_SWEEP_MS,
} from './agent-app.config';

interface AppSession {
  appId: string;
  containerName: string;
  containerIp: string;
  lastActiveAt: number;
}

/**
 * 应用运行容器（按需起、空闲回收）。
 *
 * 生命周期与 `WorkspaceService` 同一套思路，但**状态只在内存里**：
 * 应用产物在数据库 + 磁盘上，容器随时可以重建；后端重启后所有应用容器都会被
 * `adopt()` 收掉（按 label 扫描），不影响学生数据。
 *
 * ⚠️ 容器内**没有大模型 key**：题目给的 case 用 `plan_stub.json`；
 * 真模型调用要走平台代理（二期），见设计文档 §4.3。
 */
@Injectable()
export class AgentAppRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentAppRuntime.name);
  private readonly sessions = new Map<string, AppSession>();
  /** 容器用的平台代理凭证：token → appId（容器里不再放模型 key） */
  private readonly llmTokens = new Map<string, string>();
  private readonly appToken = new Map<string, string>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly runtime: ContainerRuntime) {}

  onModuleInit(): void {
    // 后端重启：收掉上一进程遗留的应用容器（产物不丢，随时可重建）
    for (const name of this.runtime.listByLabel(AGENT_APP_LABEL)) {
      this.runtime.stop(name);
      this.logger.log(`stale app container removed: ${name}`);
    }
    this.timer = setInterval(() => this.sweep(), AGENT_APP_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.stopAll();
  }

  /** 宿主机上的 zip 路径（`<根>/<appId>/<versionId>.zip`） */
  bundleZipPath(appId: string, versionId: string): string {
    return `${AGENT_APP_DATA_DIR}/${appId}/${versionId}.zip`;
  }

  /** 取（或起）应用容器，返回容器内 base（`http://<ip>:9200`） */
  async upstream(appId: string, versionId: string): Promise<string> {
    const existing = this.sessions.get(appId);
    if (existing && existing.containerIp && this.runtime.isRunning(existing.containerName)) {
      existing.lastActiveAt = Date.now();
      return `http://${existing.containerIp}:${AGENT_APP_PORT}`;
    }
    return this.start(appId, versionId);
  }

  /** 当前是否有会话（预览页用来显示「正在启动」） */
  status(appId: string): { running: boolean; since?: number } {
    const s = this.sessions.get(appId);
    return { running: !!s && this.runtime.isRunning(s.containerName), since: s?.lastActiveAt };
  }

  stop(appId: string): void {
    const token = this.appToken.get(appId);
    if (token) {
      this.llmTokens.delete(token);
      this.appToken.delete(appId);
    }
    const s = this.sessions.get(appId);
    if (!s) return;
    this.runtime.stop(s.containerName);
    this.sessions.delete(appId);
  }

  /** 平台代理用它反查是哪个应用在调模型（无效 token → null） */
  appIdForToken(token: string): string | null {
    return this.llmTokens.get(token) ?? null;
  }

  /** 平台代理的基址（容器内可达：宿主机名 + `/lab/api/apps/llm`） */
  llmProxyBase(): string | null {
    if (!WORKSPACE_PLATFORM_API) return null;
    return `${WORKSPACE_PLATFORM_API.replace(/\/+$/, '')}/apps/llm`;
  }

  /** 容器要能解析平台主机名（`--internal` 网络里 DNS 失败 → 钉到宿主网关） */
  private platformHosts(): string[] {
    if (!WORKSPACE_PLATFORM_API) return [];
    try {
      const { hostname } = new URL(WORKSPACE_PLATFORM_API);
      const gateway = this.runtime.egressGateway();
      return gateway ? [`${hostname}:${gateway}`] : [];
    } catch {
      return [];
    }
  }

  stopAll(): void {
    for (const appId of [...this.sessions.keys()]) this.stop(appId);
  }

  private async start(appId: string, versionId: string): Promise<string> {
    if (this.sessions.size >= AGENT_APP_MAX_TOTAL) {
      this.sweep();
      // 排队：先给正在用的容器一点时间被回收（最多等 15 秒），而不是立刻 503
      for (let i = 0; i < 30 && this.sessions.size >= AGENT_APP_MAX_TOTAL; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (i % 10 === 9) this.sweep();
      }
      if (this.sessions.size >= AGENT_APP_MAX_TOTAL) {
        throw new ServiceUnavailableException(
          `同时运行的应用已达上限（${AGENT_APP_MAX_TOTAL}），请稍后重试`,
        );
      }
    }
    this.stop(appId);

    const containerName = `nju-lab-app-${appId.slice(0, 8)}-${Date.now().toString(36)}`;
    const zip = this.bundleZipPath(appId, versionId);
    // 每次起容器发一个短期 token：容器只能在**平台代理**里换到模型能力，拿不到 key
    const llmToken = randomBytes(20).toString('hex');
    this.llmTokens.set(llmToken, appId);
    this.appToken.set(appId, llmToken);
    const llmBase = this.llmProxyBase();
    this.runtime.runDetached({
      name: containerName,
      image: AGENT_APP_IMAGE,
      memory: AGENT_APP_MEMORY,
      cpus: AGENT_APP_CPUS,
      labels: [`${AGENT_APP_LABEL}=1`, `${AGENT_APP_LABEL_ID}=${appId}`],
      // 出网：`--internal` 网络里 DNS 全失败，白名单域名（含 api.deepseek.com）要钉到 SNI 代理 IP，
      // 否则视觉抽取会报 `Temporary failure in name resolution`（2026-11-11 实测）。
      egressProxyIp: this.runtime.ensureEgressProxy(),
      extraHosts: this.platformHosts(),
      mounts: [`${zip}:/pkg/app.zip:ro`],
      env: [
        'APP_HOST=0.0.0.0',
        `APP_PORT=${AGENT_APP_PORT}`,
        'APP_DATA_DIR=/work/data',
        // 模型能力走**平台代理**：容器里只有一次性 token，没有 key（三期已完成）。
        ...(llmBase ? [`APP_LLM_BASE_URL=${llmBase}`, `APP_LLM_TOKEN=${llmToken}`] : []),
        // 回退通道：没配平台基址时仍用透传的 key（本地/离线演练）；配了就不注入 key。
        ...(llmBase ? [] : ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL']),
      ],
    });

    const ip = await this.waitForIp(containerName);
    this.sessions.set(appId, {
      appId,
      containerName,
      containerIp: ip,
      lastActiveAt: Date.now(),
    });
    this.logger.log(`app container started: ${containerName} (${ip})`);
    return `http://${ip}:${AGENT_APP_PORT}`;
  }

  /** 容器拿到 IP 需要几百毫秒；最多等 5 秒 */
  private async waitForIp(containerName: string): Promise<string> {
    for (let i = 0; i < 25; i += 1) {
      const ip = this.runtime.containerIp(containerName);
      if (ip) return ip;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    this.runtime.stop(containerName);
    throw new ServiceUnavailableException('应用容器没有拿到网络地址，请稍后重试');
  }

  private sweep(): void {
    const now = Date.now();
    for (const [appId, session] of this.sessions) {
      const idle = now - session.lastActiveAt;
      if (idle > AGENT_APP_IDLE_MS || !this.runtime.isRunning(session.containerName)) {
        this.runtime.stop(session.containerName);
        this.sessions.delete(appId);
        this.logger.log(`app container swept: ${session.containerName} (idle ${idle}ms)`);
      }
    }
  }
}
