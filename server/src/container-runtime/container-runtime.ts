import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { spawn, spawnSync } from 'child_process';
import { join } from 'path';

/**
 * 通用容器运行时：把"起一个受隔离约束的容器"从具体业务里抽出来，
 * 供复验（DockerEvaluationRunner）与将来的实验工作台共用。
 *
 * 隔离三件套——**调用方不得各自实现一份**，否则策略会在两处漂移：
 *   1. 资源限额   `--memory` / `--cpus`
 *   2. 出栈白名单 `--network <internal>` + 白名单域名钉到 SNI 代理（fail-closed）
 *   3. 一次性     `--rm`
 *
 * 环境变量名沿用 `VERIFY_*`：既有部署的 `.env`、`HANDOFF.md` 与运维文档均按此名配置，
 * 改名会静默改变生产行为。语义上它们描述的是"出栈隔离设施"，不再仅属于复验。
 */

// ---- 出栈白名单（SNI 代理隔离，配置见 server/verify-image/egress-proxy/nginx.conf）----
// internal 网络：无外网路由（DNS 黑洞 + 直连 IP 都堵死）；容器只能到达代理容器。
const EGRESS_NETWORK = process.env.VERIFY_EGRESS_NETWORK || 'nju-verify-egress';
const EGRESS_PROXY = process.env.VERIFY_EGRESS_PROXY || 'nju-verify-egress-proxy';
const EGRESS_PROXY_IMAGE = process.env.VERIFY_EGRESS_PROXY_IMAGE || 'nginx:alpine';
const EGRESS_PROXY_CONF =
  process.env.VERIFY_EGRESS_PROXY_CONF ||
  join(process.cwd(), 'verify-image', 'egress-proxy', 'nginx.conf');
/** 钉到代理 IP 的白名单域名（须与 nginx.conf 的 map 及驱动 BASE_URL 主机一致） */
const EGRESS_DOMAINS = (
  process.env.VERIFY_EGRESS_DOMAINS || 'api.deepseek.com,api.moonshot.cn'
).split(',');

/** 资源限额默认值；调用方不传时使用 */
export const DEFAULT_CONTAINER_MEMORY = process.env.VERIFY_DOCKER_MEMORY || '1g';
export const DEFAULT_CONTAINER_CPUS = process.env.VERIFY_DOCKER_CPUS || '1';

export interface ContainerRunSpec {
  /** 容器名（超时后按此名强制清理） */
  name: string;
  image: string;
  /** 默认 `DEFAULT_CONTAINER_MEMORY` */
  memory?: string;
  /** 默认 `DEFAULT_CONTAINER_CPUS` */
  cpus?: string;
  /** 出栈代理 IP（由 `ensureEgressProxy()` 取得）；给了才加白名单 `--add-host` */
  egressProxyIp?: string;
  /** 额外的 `--add-host` 条目，形如 `host:ip` */
  extraHosts?: string[];
  /** `-e` 条目：`NAME` 表示透传宿主环境变量，`NAME=VALUE` 表示赋值 */
  env?: string[];
  /** `-v` 条目，原样透传 */
  mounts?: string[];
  /** `--label` 条目，形如 `k=v`（**长驻容器靠它被识别与回收**） */
  labels?: string[];
  /** `-p` 条目，形如 `127.0.0.1:20001:9090` */
  ports?: string[];
  /** 镜像之后的容器命令参数 */
  args?: string[];
  /** 执行上限（毫秒），`runOneShot` 用；缺省 600000 */
  timeoutMs?: number;
  /** 一次性执行默认 `true`（`--rm`）；长驻容器默认 `false`（保留容器以便诊断） */
  removeOnExit?: boolean;
}

export interface ContainerRunResult {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

@Injectable()
export class ContainerRuntime {
  private readonly logger = new Logger(ContainerRuntime.name);

  /** docker CLI 包装：同步执行，120s 上限 */
  docker(args: string[]): { ok: boolean; out: string } {
    const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
    return {
      ok: r.status === 0,
      out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
    };
  }

  /**
   * 幂等确保出栈隔离设施存在并返回代理容器在 internal 网络里的 IP：
   * - `docker network create --internal <net>`（无外网路由）
   * - 双宿主代理容器（默认 bridge + internal 网络，挂只读 nginx.conf）
   * 代理不可用时必须失败（fail-closed），不能回退到开放网络。
   */
  ensureEgressProxy(): string {
    if (!this.docker(['network', 'inspect', EGRESS_NETWORK]).ok) {
      const created = this.docker([
        'network', 'create', '--internal', EGRESS_NETWORK,
      ]);
      if (!created.ok) {
        throw new InternalServerErrorException(
          `出栈网络创建失败: ${created.out.slice(0, 300)}`,
        );
      }
      this.logger.log(`egress network created: ${EGRESS_NETWORK} (--internal)`);
    }

    if (!this.docker(['inspect', EGRESS_PROXY]).ok) {
      if (!this.docker(['image', 'inspect', EGRESS_PROXY_IMAGE]).ok) {
        const pull = this.docker(['pull', EGRESS_PROXY_IMAGE]);
        if (!pull.ok) {
          throw new InternalServerErrorException(
            `出栈代理镜像拉取失败: ${pull.out.slice(0, 300)}`,
          );
        }
      }
      const run = this.docker([
        'run', '-d', '--name', EGRESS_PROXY,
        '--restart', 'unless-stopped',
        '-v', `${EGRESS_PROXY_CONF}:/etc/nginx/nginx.conf:ro`,
        EGRESS_PROXY_IMAGE,
      ]);
      if (!run.ok) {
        throw new InternalServerErrorException(
          `出栈代理容器创建失败: ${run.out.slice(0, 300)}`,
        );
      }
      this.logger.log(`egress proxy container created: ${EGRESS_PROXY}`);
    }
    const state = this.docker([
      'inspect', '-f', '{{.State.Running}}', EGRESS_PROXY,
    ]);
    if (state.out !== 'true') {
      const started = this.docker(['start', EGRESS_PROXY]);
      if (!started.ok) {
        throw new InternalServerErrorException(
          `出栈代理容器启动失败: ${started.out.slice(0, 300)}`,
        );
      }
    }

    const queryIp = () => {
      // with 模式：未接入该网络时输出空串而不是报 template 错（报错文本曾被误当 IP）
      const r = this.docker([
        'inspect', '-f',
        `{{with (index .NetworkSettings.Networks "${EGRESS_NETWORK}")}}{{.IPAddress}}{{end}}`,
        EGRESS_PROXY,
      ]);
      return r.ok ? r.out : '';
    };
    let ip = queryIp();
    if (!ip) {
      // 已有容器可能是在网络创建之前建的，补挂 internal 网络
      const connected = this.docker([
        'network', 'connect', EGRESS_NETWORK, EGRESS_PROXY,
      ]);
      if (!connected.ok) {
        throw new InternalServerErrorException(
          `出栈代理接入 ${EGRESS_NETWORK} 失败: ${connected.out.slice(0, 300)}`,
        );
      }
      ip = queryIp();
    }
    if (!ip) {
      throw new InternalServerErrorException(
        '出栈代理在 internal 网络中没有 IP（fail-closed，拒绝在开放网络下运行容器）',
      );
    }
    return ip;
  }

  /**
   * 宿主在**出栈隔离网络**里的网关地址（容器够得着的那一个）。
   *
   * ⚠️ 不要用 docker 的 `host-gateway`：它解析成宿主在**默认 bridge** 上的 IP（172.17.0.1），
   * 而隔离容器只在 internal 网络里（172.18.0.0/16），没有到那个网段的路由 → `ENETUNREACH`
   * （2026-09-29 实测：容器回调平台 API 全部失败，就是这个原因）。
   * 宿主 nginx 监听 0.0.0.0:80，所以这个网关地址是可达的。
   */
  egressGateway(): string | null {
    const r = this.docker([
      'network', 'inspect', EGRESS_NETWORK, '-f',
      '{{(index .IPAM.Config 0).Gateway}}',
    ]);
    return r.ok && r.out ? r.out : null;
  }

  /**
   * 前台执行一个一次性容器并等待结束。
   * 参数顺序与抽取前保持一致（`run --rm --name … IMAGE ARGS`）。
   */
  runOneShot(spec: ContainerRunSpec): Promise<ContainerRunResult> {
    const timeoutMs = spec.timeoutMs ?? 600_000;
    const args = this.buildRunArgs(spec, {
      detach: false,
      remove: spec.removeOnExit !== false,
    });

    this.logger.log(
      `container start: ${spec.name} (image ${spec.image}, timeout ${timeoutMs}ms)`,
    );
    const startedAt = Date.now();
    return new Promise((resolvePromise, reject) => {
      const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout = (stdout + d).slice(-64_000); });
      proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-64_000); });
      const killer = setTimeout(() => {
        proc.kill('SIGKILL');
        // --rm 的客户端被杀后容器可能残留，按名字强制清理
        spawn('docker', ['kill', spec.name]).on('error', () => undefined);
      }, timeoutMs);
      proc.on('error', (e) => {
        clearTimeout(killer);
        reject(new InternalServerErrorException(`无法启动 docker: ${e.message}`));
      });
      proc.on('close', (code, signal) => {
        clearTimeout(killer);
        resolvePromise({
          code,
          timedOut: signal === 'SIGKILL',
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }

  // ---------- 长驻容器（实验工作台用） ----------

  /**
   * 后台启动一个长驻容器，立即返回容器名。
   *
   * **生命周期由调用方负责**：必须能通过 `stop()` 或按 label 扫描回收——
   * 长驻容器默认**不加** `--rm`（保留容器便于事后诊断），所以泄露风险由调用方承担。
   */
  runDetached(spec: ContainerRunSpec): string {
    const args = this.buildRunArgs(spec, {
      detach: true,
      remove: spec.removeOnExit === true,
    });
    this.logger.log(
      `container start (detached): ${spec.name} (image ${spec.image})`,
    );
    const r = this.docker(args);
    if (!r.ok) {
      throw new InternalServerErrorException(
        `长驻容器启动失败 (${spec.name}): ${r.out.slice(0, 300)}`,
      );
    }
    return spec.name;
  }

  /** 强制停止并移除容器；容器不存在时静默成功（幂等） */
  stop(name: string): void {
    this.docker(['rm', '-f', name]);
  }

  /**
   * 按 label 列出容器名（**含已退出的**）。
   * 用途：后端重启/崩溃后扫描孤儿容器，以及查某用户是否已有实例。
   */
  listByLabel(key: string, value?: string): string[] {
    const filter =
      value === undefined ? `label=${key}` : `label=${key}=${value}`;
    const r = this.docker([
      'ps', '-a', '--filter', filter, '--format', '{{.Names}}',
    ]);
    return r.ok && r.out
      ? r.out.split('\n').map((x) => x.trim()).filter(Boolean)
      : [];
  }

  /** 读容器某个 label 的值（没有则返回 null） */
  labelValue(name: string, key: string): string | null {
    const r = this.docker([
      'inspect', '-f', `{{index .Config.Labels "${key}"}}`, name,
    ]);
    return r.ok && r.out ? r.out : null;
  }

  /** 镜像 ID（判断"容器是否基于当前配置的镜像"时用；镜像或标签不存在返回 null） */
  imageId(ref: string): string | null {
    const r = this.docker(['image', 'inspect', '-f', '{{.Id}}', ref]);
    return r.ok && r.out ? r.out : null;
  }

  /** 容器所用的镜像 ID */
  containerImageId(name: string): string | null {
    const r = this.docker(['inspect', '-f', '{{.Image}}', name]);
    return r.ok && r.out ? r.out : null;
  }

  /** 容器当前是否在运行 */
  isRunning(name: string): boolean {
    return (
      this.docker(['inspect', '-f', '{{.State.Running}}', name]).out === 'true'
    );
  }

  /** 读取容器日志（stdout + stderr 合并）。容器不存在/不可读时返回空串。 */
  logs(name: string): string {
    const r = this.docker(['logs', name]);
    return r.ok ? r.out : '';
  }

  /**
   * 取容器在**出栈隔离网络**里的 IP（没有则返回 null）。
   *
   * ⚠️ `--internal` 网络的容器**不会建立端口发布**（`docker port` 为空、`-p` 静默失效，
   * 2026-09-28 实测），所以对外暴露只能走容器 IP —— 宿主对该网段有直连路由
   * （`br-xxxx` 上的 `172.18.0.1/16`），nginx 反代到 `ip:port` 即可。
   */
  containerIp(name: string): string | null {
    const r = this.docker([
      'inspect', '-f',
      `{{with (index .NetworkSettings.Networks "${EGRESS_NETWORK}")}}{{.IPAddress}}{{end}}`,
      name,
    ]);
    return r.ok && r.out ? r.out : null;
  }

  /**
   * 组装 `docker run` 参数。**一次性与长驻共用同一份隔离策略**——
   * 限额、出栈白名单、挂载顺序都只在这里定义一次。
   */
  private buildRunArgs(
    spec: ContainerRunSpec,
    mode: { detach: boolean; remove: boolean },
  ): string[] {
    return [
      'run',
      ...(mode.remove ? ['--rm'] : []),
      ...(mode.detach ? ['-d'] : []),
      '--name', spec.name,
      '--memory', spec.memory ?? DEFAULT_CONTAINER_MEMORY,
      '--cpus', spec.cpus ?? DEFAULT_CONTAINER_CPUS,
      // 出栈隔离：internal 网络（无外网路由），白名单域名钉到 SNI 代理 IP；
      // 非白名单域名 DNS 失败、直连 IP 无路由
      '--network', EGRESS_NETWORK,
      ...(spec.egressProxyIp
        ? EGRESS_DOMAINS.flatMap((d) => [
            '--add-host', `${d}:${spec.egressProxyIp}`,
          ])
        : []),
      ...(spec.extraHosts ?? []).flatMap((h) => ['--add-host', h]),
      ...(spec.labels ?? []).flatMap((l) => ['--label', l]),
      ...(spec.ports ?? []).flatMap((p) => ['-p', p]),
      ...(spec.env ?? []).flatMap((e) => ['-e', e]),
      ...(spec.mounts ?? []).flatMap((m) => ['-v', m]),
      spec.image,
      ...(spec.args ?? []),
    ];
  }
}
