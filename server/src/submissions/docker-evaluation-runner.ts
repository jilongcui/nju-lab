import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { spawn } from 'child_process';
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

  // ---------- 容器执行 ----------

  private runContainer(opts: {
    containerName: string;
    skillPath: string;
    datasetPath: string;
    outDir: string;
    timeoutMs: number;
    maxCases: number;
    judgeMode: string;
    model?: string;
    reasoningEffort?: string;
  }): Promise<{ code: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number }> {
    const args = [
      'run', '--rm', '--name', opts.containerName,
      '--memory', VERIFY_DOCKER_MEMORY,
      '--cpus', VERIFY_DOCKER_CPUS,
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
