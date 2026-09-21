import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtemp, mkdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FilesService } from '../files/files.service';
import { ExperimentProject } from '../projects/project.entity';
import { EvaluationRunner, EvaluationRunResult } from './evaluation-runner';
import { Submission } from './submission.entity';

/** 复验容器镜像（构建见 server/verify-image/Dockerfile） */
const VERIFY_IMAGE = process.env.VERIFY_IMAGE || 'nju-lab-verify:0.1.5-rc.2';
/** 整体时长限额兜底（毫秒）；project.evalConfig.timeoutSeconds 优先 */
const VERIFY_TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS || 600_000);
/** 成本控制：最多跑几个 case；0 = 全部。evalConfig.maxCases 优先 */
const VERIFY_MAX_CASES = Number(process.env.VERIFY_MAX_CASES || 0);
const VERIFY_JUDGE_MODE = process.env.VERIFY_JUDGE_MODE || 'llm';
const VERIFY_DOCKER_MEMORY = process.env.VERIFY_DOCKER_MEMORY || '1g';
const VERIFY_DOCKER_CPUS = process.env.VERIFY_DOCKER_CPUS || '1';

// ---- 出栈白名单（SNI 代理隔离，配置见 server/verify-image/egress-proxy/nginx.conf）----
// internal 网络：无外网路由（DNS 黑洞 + 直连 IP 都堵死）；复验容器只能到达代理容器。
const VERIFY_EGRESS_NETWORK = process.env.VERIFY_EGRESS_NETWORK || 'nju-verify-egress';
const VERIFY_EGRESS_PROXY = process.env.VERIFY_EGRESS_PROXY || 'nju-verify-egress-proxy';
const VERIFY_EGRESS_PROXY_IMAGE = process.env.VERIFY_EGRESS_PROXY_IMAGE || 'nginx:alpine';
const VERIFY_EGRESS_PROXY_CONF =
  process.env.VERIFY_EGRESS_PROXY_CONF ||
  join(process.cwd(), 'verify-image', 'egress-proxy', 'nginx.conf');
/** 钉到代理 IP 的白名单域名（须与 nginx.conf 的 map 及驱动 BASE_URL 主机一致） */
const VERIFY_EGRESS_DOMAINS = (
  process.env.VERIFY_EGRESS_DOMAINS || 'api.deepseek.com,api.moonshot.cn'
).split(',');

interface JudgeVerdict {
  pass: boolean;
  score: number;
  rationale: string;
}

interface RoundResult {
  round: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  tokens: { input: number; output: number; reasoning: number };
  sessionId: string | null;
  finalText: string;
  error: string | null;
  judge: JudgeVerdict;
}

interface DriverSummary {
  passCount: number;
  runs: number;
  successRate: number;
  avgScore: number;
  tokens: { input: number; output: number };
  durationMs: number;
}

/** server/verify-image/run-eval.mjs 产出的结果 JSON */
interface DriverResult {
  evalVersion: string;
  startedAt: string;
  dshVersion: string;
  profile: string;
  model: Record<string, unknown>;
  judge: { mode: string; model: string | null };
  skillFileHashes: Record<string, string> | null;
  skillInfo?: { boundariesDocumented: boolean; pitfallsRecorded: number } | null;
  cases: { case: string; rounds: Record<string, RoundResult> }[];
  summary: { baseline: DriverSummary; treatment?: DriverSummary };
}

/**
 * 真实复验执行器：每个提交起一个一次性 Docker 容器
 * （dsh headless + approval=never + workspace-write 沙箱 + 资源限额），
 * 跑 baseline/treatment 两轮对比 + LLM judge 评分，回填真实数据。
 *
 * 遗留（生产化）：网络白名单代理——当前容器走默认 bridge 网络，
 * 模型 API 出站与学生 Skill 出站未隔离（镜像与本文档均已标注）。
 */
@Injectable()
export class DockerEvaluationRunner implements EvaluationRunner {
  readonly name = 'docker';
  private readonly logger = new Logger(DockerEvaluationRunner.name);

  constructor(private readonly filesService: FilesService) {}

  async run(
    submission: Submission,
    project: ExperimentProject,
  ): Promise<EvaluationRunResult> {
    const skillPath = await this.resolveUpload(
      submission.skillZipRef,
      '提交物不是已上传文件（skillZipRef 须为 file:<id>，旧 s3:// 数据不支持复验）',
    );
    if (!project.testDatasetFileId) {
      throw new BadRequestException('项目未绑定标准测试数据集，无法复验');
    }
    const datasetPath = await this.resolveUpload(
      `file:${project.testDatasetFileId}`,
      '项目数据集文件不存在',
    );
    const capsuleHashVerified = await this.verifyCapsuleHash(submission);
    // 出栈白名单代理：幂等确保 internal 网络与双宿主代理容器存在，取其内部 IP
    const egressProxyIp = this.ensureEgressProxy();

    const workRoot = await mkdtemp(join(tmpdir(), `nju-verify-${submission.id.slice(0, 8)}-`));
    const outDir = join(workRoot, 'out');
    await mkdir(outDir, { recursive: true });
    const containerName = `nju-verify-${submission.id.slice(0, 8)}-${Date.now()}`;

    const timeoutMs =
      (project.evalConfig?.timeoutSeconds
        ? project.evalConfig.timeoutSeconds * 1000
        : 0) || VERIFY_TIMEOUT_MS;
    const maxCases = project.evalConfig?.maxCases ?? VERIFY_MAX_CASES;
    const judgeMode = project.evalConfig?.judgeMode ?? VERIFY_JUDGE_MODE;

    const driver = await this.runContainer({
      containerName,
      skillPath,
      datasetPath,
      outDir,
      timeoutMs,
      maxCases,
      judgeMode,
      egressProxyIp,
      model: project.evalConfig?.model,
      reasoningEffort: project.evalConfig?.reasoningEffort,
    });

    try {
      const result = await this.readResult(outDir, driver);
      return this.mapResult(result, submission, capsuleHashVerified, project);
    } finally {
      await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ---------- 出栈白名单代理 ----------

  private docker(args: string[]): { ok: boolean; out: string } {
    const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
    return {
      ok: r.status === 0,
      out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
    };
  }

  /**
   * 幂等确保出栈隔离设施存在并返回代理容器在 internal 网络里的 IP：
   * - `docker network create --internal nju-verify-egress`（无外网路由）
   * - 双宿主代理容器（默认 bridge + internal 网络，挂只读 nginx.conf）
   * 代理不可用时复验必须失败（fail-closed），不能回退到开放网络。
   */
  private ensureEgressProxy(): string {
    if (!this.docker(['network', 'inspect', VERIFY_EGRESS_NETWORK]).ok) {
      const created = this.docker([
        'network', 'create', '--internal', VERIFY_EGRESS_NETWORK,
      ]);
      if (!created.ok) {
        throw new InternalServerErrorException(
          `复验出栈网络创建失败: ${created.out.slice(0, 300)}`,
        );
      }
      this.logger.log(`egress network created: ${VERIFY_EGRESS_NETWORK} (--internal)`);
    }

    if (!this.docker(['inspect', VERIFY_EGRESS_PROXY]).ok) {
      if (!this.docker(['image', 'inspect', VERIFY_EGRESS_PROXY_IMAGE]).ok) {
        const pull = this.docker(['pull', VERIFY_EGRESS_PROXY_IMAGE]);
        if (!pull.ok) {
          throw new InternalServerErrorException(
            `复验出栈代理镜像拉取失败: ${pull.out.slice(0, 300)}`,
          );
        }
      }
      const run = this.docker([
        'run', '-d', '--name', VERIFY_EGRESS_PROXY,
        '--restart', 'unless-stopped',
        '-v', `${VERIFY_EGRESS_PROXY_CONF}:/etc/nginx/nginx.conf:ro`,
        VERIFY_EGRESS_PROXY_IMAGE,
      ]);
      if (!run.ok) {
        throw new InternalServerErrorException(
          `复验出栈代理容器创建失败: ${run.out.slice(0, 300)}`,
        );
      }
      this.logger.log(`egress proxy container created: ${VERIFY_EGRESS_PROXY}`);
    }
    const state = this.docker([
      'inspect', '-f', '{{.State.Running}}', VERIFY_EGRESS_PROXY,
    ]);
    if (state.out !== 'true') {
      const started = this.docker(['start', VERIFY_EGRESS_PROXY]);
      if (!started.ok) {
        throw new InternalServerErrorException(
          `复验出栈代理容器启动失败: ${started.out.slice(0, 300)}`,
        );
      }
    }

    const queryIp = () => {
      // with 模式：未接入该网络时输出空串而不是报 template 错（报错文本曾被误当 IP）
      const r = this.docker([
        'inspect', '-f',
        `{{with (index .NetworkSettings.Networks "${VERIFY_EGRESS_NETWORK}")}}{{.IPAddress}}{{end}}`,
        VERIFY_EGRESS_PROXY,
      ]);
      return r.ok ? r.out : '';
    };
    let ip = queryIp();
    if (!ip) {
      // 已有容器可能是在网络创建之前建的，补挂 internal 网络
      const connected = this.docker([
        'network', 'connect', VERIFY_EGRESS_NETWORK, VERIFY_EGRESS_PROXY,
      ]);
      if (!connected.ok) {
        throw new InternalServerErrorException(
          `复验出栈代理接入 ${VERIFY_EGRESS_NETWORK} 失败: ${connected.out.slice(0, 300)}`,
        );
      }
      ip = queryIp();
    }
    if (!ip) {
      throw new InternalServerErrorException(
        '复验出栈代理在 internal 网络中没有 IP（fail-closed，拒绝在开放网络下复验）',
      );
    }
    return ip;
  }

  // ---------- 容器执行 ----------

  private runContainer(opts: {
    containerName: string;
    skillPath: string;
    datasetPath: string;
    outDir: string;
    timeoutMs: number;
    maxCases: number;
    judgeMode: string;
    egressProxyIp: string;
    model?: string;
    reasoningEffort?: string;
  }): Promise<{ code: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number }> {
    const args = [
      'run', '--rm', '--name', opts.containerName,
      '--memory', VERIFY_DOCKER_MEMORY,
      '--cpus', VERIFY_DOCKER_CPUS,
      // 出栈隔离：internal 网络（无外网路由），白名单域名钉到 SNI 代理 IP；
      // 非白名单域名 DNS 失败、直连 IP 无路由
      '--network', VERIFY_EGRESS_NETWORK,
      ...VERIFY_EGRESS_DOMAINS.flatMap((d) => [
        '--add-host', `${d}:${opts.egressProxyIp}`,
      ]),
      // key 由服务端环境透传，不进镜像、不落盘（DEEPSEEK 优先，MOONSHOT 回退）
      '-e', 'DEEPSEEK_API_KEY',
      '-e', 'MOONSHOT_API_KEY',
      '-e', 'DSH_TELEMETRY_DISABLED=1',
    ];
    // 逐项目模型映射：容器内驱动据此改写 profile（缺省用镜像 profile 钉死的值）
    if (opts.model) {
      args.push('-e', `VERIFY_MODEL=${opts.model}`);
    }
    if (opts.reasoningEffort) {
      args.push('-e', `VERIFY_REASONING_EFFORT=${opts.reasoningEffort}`);
    }
    args.push(
      // 提交物与数据集只读挂载；结果写到独立输出目录
      '-v', `${opts.skillPath}:/inputs/skill.zip:ro`,
      '-v', `${opts.datasetPath}:/inputs/dataset.zip:ro`,
      '-v', `${opts.outDir}:/outputs`,
      VERIFY_IMAGE,
      '--skill', '/inputs/skill.zip',
      '--dataset', '/inputs/dataset.zip',
      '--out', '/outputs/result.json',
      '--judge-mode', opts.judgeMode,
      '--timeout-ms', String(Math.min(300_000, opts.timeoutMs)),
    );
    if (opts.maxCases > 0) {
      args.push('--max-cases', String(opts.maxCases));
    }

    this.logger.log(`verify container start: ${opts.containerName} (image ${VERIFY_IMAGE}, timeout ${opts.timeoutMs}ms)`);
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
        spawn('docker', ['kill', opts.containerName]).on('error', () => undefined);
      }, opts.timeoutMs);
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

  private async readResult(
    outDir: string,
    driver: { code: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number },
  ): Promise<DriverResult> {
    let raw: string;
    try {
      raw = await readFile(join(outDir, 'result.json'), 'utf8');
    } catch {
      throw new InternalServerErrorException(
        `复验容器未产出结果（${this.diagnose(driver)}）`,
      );
    }
    try {
      return JSON.parse(raw) as DriverResult;
    } catch (e) {
      throw new InternalServerErrorException(
        `复验结果 JSON 解析失败: ${e instanceof Error ? e.message : e}（${this.diagnose(driver)}）`,
      );
    }
  }

  private diagnose(driver: { code: number | null; timedOut: boolean; stderr: string; durationMs: number }): string {
    const tail = driver.stderr.trim().split('\n').slice(-5).join(' | ').slice(0, 500);
    if (driver.timedOut) return `容器超时被杀，stderr 末尾: ${tail}`;
    return `容器退出码 ${driver.code}，stderr 末尾: ${tail}`;
  }

  // ---------- 结果映射 ----------

  private mapResult(
    result: DriverResult,
    submission: Submission,
    capsuleHashVerified: boolean,
    project: ExperimentProject,
  ): EvaluationRunResult {
    const treatment = result.summary.treatment;
    if (!treatment) {
      throw new InternalServerErrorException('复验结果缺少 treatment 汇总');
    }
    const roundsOf = (r: string) =>
      result.cases.map((c) => ({ case: c.case, ...c.rounds[r] })).filter((x) => x.judge);
    const roundDetail = (r: string) =>
      roundsOf(r).map((x) => ({
        case: x.case,
        pass: x.judge.pass,
        score: x.judge.score,
        rationale: x.judge.rationale,
        exitCode: x.exitCode,
        timedOut: x.timedOut,
        tokens: x.tokens,
        durationMs: x.durationMs,
        sessionId: x.sessionId,
      }));

    const successRate = treatment.successRate;
    const lift = round2(treatment.successRate - result.summary.baseline.successRate);
    const tokenCost = Math.round(
      treatment.tokens.input + treatment.tokens.output +
      result.summary.baseline.tokens.input + result.summary.baseline.tokens.output,
    );

    const integrity = this.integrityCheck(submission, result, capsuleHashVerified);
    const boundariesDocumented = result.skillInfo?.boundariesDocumented ?? false;

    // 与 Mock 相同的评分建议公式（craft 第九节权重），但输入全部是实测值
    const autoScoreSuggestion = Math.min(100, round2(
      successRate * 40 +
      Math.max(0, lift) * 100 * 0.15 +
      (boundariesDocumented ? 20 : 10) +
      (integrity.selfReportVsRerun !== 'suspicious' ? 10 : 5) +
      (tokenCost < 30_000 ? 10 : 6),
    ));

    return {
      baselineResult: {
        runner: `evaluation-runner:${this.name}`,
        dataset: project.testDatasetFileId,
        evalConfig: project.evalConfig,
        model: result.model,
        judge: result.judge,
        cases: roundDetail('baseline'),
        summary: result.summary.baseline,
      },
      treatmentResult: {
        runner: `evaluation-runner:${this.name}`,
        dataset: project.testDatasetFileId,
        evalConfig: project.evalConfig,
        model: result.model,
        judge: result.judge,
        cases: roundDetail('treatment'),
        summary: treatment,
      },
      successRate,
      tokenCost,
      dossierSnapshot: {
        generatedBy: `evaluation-runner:${this.name}`,
        dshVersion: result.dshVersion,
        profile: result.profile,
        startedAt: result.startedAt,
        invocationCount: result.cases.length * 2,
        measuredOutcomes: {
          success: treatment.passCount,
          failure: treatment.runs - treatment.passCount,
        },
        boundariesDocumented,
        pitfallsRecorded: result.skillInfo?.pitfallsRecorded ?? 0,
        baselineSuccessRate: result.summary.baseline.successRate,
        treatmentSuccessRate: treatment.successRate,
        lift,
      },
      integrityCheck: integrity,
      autoScoreSuggestion,
    };
  }

  /**
   * 证据一致性（真实但弱于完整设计）：
   * - capsuleHashVerified：提交登记的 capsule sha256 与存储文件权威值对照
   * - selfReportVsRerun：学生自报 fileHashes 与容器内实测的 skill 文件哈希逐条对照
   */
  private integrityCheck(
    submission: Submission,
    result: DriverResult,
    capsuleHashVerified: boolean,
  ): Record<string, unknown> {
    const actual = result.skillFileHashes ?? {};
    const reported = submission.fileHashes ?? null;
    let matched = 0;
    const mismatched: string[] = [];
    const missing: string[] = [];
    if (reported) {
      for (const [path, hash] of Object.entries(reported)) {
        const key = actual[path] !== undefined
          ? path
          : Object.keys(actual).find((k) => k === path || k.endsWith(`/${path}`));
        if (!key) missing.push(path);
        else if (actual[key].toLowerCase() === String(hash).toLowerCase()) matched++;
        else mismatched.push(path);
      }
    }
    const selfReportVsRerun = !reported
      ? 'no-self-report'
      : mismatched.length > 0 || (matched === 0 && missing.length > 0)
        ? 'suspicious'
        : 'consistent';
    return {
      capsuleHashVerified,
      selfReportVsRerun,
      filesMatched: matched,
      filesMismatched: mismatched,
      filesMissing: missing,
      auditEventsReceived: Array.isArray(submission.auditEvents)
        ? submission.auditEvents.length
        : 0,
      note:
        selfReportVsRerun === 'suspicious'
          ? '学生自报文件哈希与复验实测不一致，建议人工复核'
          : selfReportVsRerun === 'no-self-report'
            ? '学生未自报文件哈希，仅校验证据包哈希'
            : '学生自报文件哈希与复验实测一致',
    };
  }

  // ---------- 文件解析 ----------

  private async resolveUpload(ref: string, notFileMessage: string): Promise<string> {
    if (!ref.startsWith('file:')) {
      throw new BadRequestException(notFileMessage);
    }
    const file = await this.filesService.getFile(ref.slice('file:'.length));
    return join(this.filesService.uploadDir, file.storagePath);
  }

  /** 提交登记的 capsule 哈希 vs 服务端存储权威值（直填模式的旧数据无从对照，记 false） */
  private async verifyCapsuleHash(submission: Submission): Promise<boolean> {
    if (!submission.capsuleRef.startsWith('file:')) return false;
    try {
      const file = await this.filesService.getFile(submission.capsuleRef.slice(5));
      return file.sha256 === submission.capsuleSha256.toLowerCase();
    } catch {
      return false;
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
