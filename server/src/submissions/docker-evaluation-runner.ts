import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdtemp, mkdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContainerRuntime } from '../container-runtime/container-runtime';
import { FilesService } from '../files/files.service';
import { ExperimentProject } from '../projects/project.entity';
import { EvaluationRunner, EvaluationRunResult } from './evaluation-runner';
import { Submission } from './submission.entity';

/** 复验容器镜像（构建见 server/verify-image/Dockerfile） */
const VERIFY_IMAGE = process.env.VERIFY_IMAGE || 'nju-lab-verify:0.2.0-rc.2-pkg6';
/** 整体时长限额兜底（毫秒）；project.evalConfig.timeoutSeconds 优先 */
const VERIFY_TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS || 600_000);
/**
 * 成本控制：最多跑几个 case。**未配置（undefined）时不下发 CLI 参数** ——
 * 由题目包 manifest.maxCases / 驱动内置默认决定；evalConfig.maxCases 优先级最高。
 */
const VERIFY_MAX_CASES = process.env.VERIFY_MAX_CASES
  ? Number(process.env.VERIFY_MAX_CASES)
  : undefined;
/** 判分模式：同上，未配置则交给题目包 manifest.judgeMode（再回落 llm）。 */
const VERIFY_JUDGE_MODE = process.env.VERIFY_JUDGE_MODE || undefined;

interface JudgeVerdict {
  pass: boolean;
  score: number;
  rationale: string;
}

interface RoundResult {
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
  /** 题目包声明摘要（包驱动：输出文件名 / 题干与细则来源 / 依赖），可追溯本次评测口径 */
  package?: DriverPackage | null;
  dependencyCheck?: { ok: boolean; missing: string[]; declared: Record<string, string[]> } | null;
  skillFileHashes: Record<string, string> | null;
  skillInfo?: { boundariesDocumented: boolean; pitfallsRecorded: number } | null;
  /** 单轮复验（baseline 轮已取消）：每个 case 一条记录，无 rounds 嵌套 */
  cases: ({ case: string } & RoundResult)[];
  summary: DriverSummary;
}

/** 题目包（实验材料）的声明摘要，由驱动 inspectPackage() 产出 */
interface DriverPackage {
  source: 'builtin' | 'manifest';
  name: string | null;
  title: string | null;
  outputFile: string;
  inputs: string[] | null;
  judgeMode: string | null;
  maxCases: number;
  requires: Record<string, string[]>;
  taskPromptSource: string;
  judgeRulesSource: string;
  cases: { name: string; inputs: string[]; expected: string }[];
}

/**
 * 真实复验执行器：每个提交起一个一次性 Docker 容器
 * （dsh headless + approval=never + workspace-write 沙箱 + 资源限额 + 出栈白名单），
 * 跑一轮（学生的 Skill）+ LLM judge 逐 case 评分，回填真实数据。
 *
 * 容器编排（资源限额 / 出栈隔离 / 一次性）已抽到 ContainerRuntime，
 * 与将来的实验工作台共用同一份隔离策略；本类只保留复验特有的业务：
 * 解析上传、组织输入输出挂载、映射结果与证据一致性检查。
 */
@Injectable()
export class DockerEvaluationRunner implements EvaluationRunner {
  readonly name = 'docker';
  private readonly logger = new Logger(DockerEvaluationRunner.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly runtime: ContainerRuntime,
  ) {}

  async run(
    submission: Submission,
    project: ExperimentProject,
  ): Promise<EvaluationRunResult> {
    const skillPath = await this.resolveUpload(
      submission.skillZipRef,
      '提交物不是已上传文件（skillZipRef 须为 file:<id>，旧 s3:// 数据不支持复验）',
    );
    if (!project.problemFileId) {
      throw new BadRequestException('项目未绑定题目包，无法复验');
    }
    const problemPath = await this.resolveUpload(
      `file:${project.problemFileId}`,
      '项目未绑定题目包',
    );
    const capsuleHashVerified = await this.verifyCapsuleHash(submission);
    // 出栈白名单代理：幂等确保 internal 网络与双宿主代理容器存在，取其内部 IP
    const egressProxyIp = this.runtime.ensureEgressProxy();

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

    const driver = await this.runtime.runOneShot({
      name: containerName,
      image: VERIFY_IMAGE,
      egressProxyIp,
      // key 由服务端环境透传，不进镜像、不落盘（DEEPSEEK 优先，MOONSHOT 回退）
      env: [
        'DEEPSEEK_API_KEY',
        'MOONSHOT_API_KEY',
        'DSH_TELEMETRY_DISABLED=1',
        // 逐项目模型映射：容器内驱动据此改写 profile（缺省用镜像 profile 钉死的值）
        ...(project.evalConfig?.model
          ? [`VERIFY_MODEL=${project.evalConfig.model}`]
          : []),
        ...(project.evalConfig?.reasoningEffort
          ? [`VERIFY_REASONING_EFFORT=${project.evalConfig.reasoningEffort}`]
          : []),
      ],
      // 提交物与题目包只读挂载；结果写到独立输出目录
      mounts: [
        `${skillPath}:/inputs/skill.zip:ro`,
        `${problemPath}:/inputs/problem.zip:ro`,
        `${outDir}:/outputs`,
      ],
      args: [
        '--skill', '/inputs/skill.zip',
        '--problem', '/inputs/problem.zip',
        '--out', '/outputs/result.json',
        // 未显式配置判分模式时不传：让题目包的 manifest.judgeMode 生效（包驱动）
        ...(judgeMode ? ['--judge-mode', judgeMode] : []),
        '--timeout-ms', String(Math.min(300_000, timeoutMs)),
        ...(maxCases && maxCases > 0 ? ['--max-cases', String(maxCases)] : []),
      ],
      timeoutMs,
    });

    try {
      const result = await this.readResult(outDir, driver);
      return this.mapResult(result, submission, capsuleHashVerified, project);
    } finally {
      await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    }
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
    const summary = result.summary;
    if (!summary) {
      throw new InternalServerErrorException('复验结果缺少汇总');
    }
    const caseDetail = result.cases.map((c) => ({
      case: c.case,
      pass: c.judge.pass,
      score: c.judge.score,
      rationale: c.judge.rationale,
      exitCode: c.exitCode,
      timedOut: c.timedOut,
      tokens: c.tokens,
      durationMs: c.durationMs,
      sessionId: c.sessionId,
    }));

    const successRate = summary.successRate;
    const tokenCost = Math.round(summary.tokens.input + summary.tokens.output);

    const integrity = this.integrityCheck(submission, result, capsuleHashVerified);
    const boundariesDocumented = result.skillInfo?.boundariesDocumented ?? false;

    // 与 Mock 相同的评分建议公式（craft 第九节权重），但输入全部是实测值。
    // baseline 轮已取消 → 原 lift 项（15 分）并入成功率（40 → 55）；
    // tokenCost 也从「两轮之和」变成「单轮」，阈值按比例减半（30000 → 15000）。
    const autoScoreSuggestion = Math.min(100, round2(
      successRate * 55 +
      (boundariesDocumented ? 20 : 10) +
      (integrity.selfReportVsRerun !== 'suspicious' ? 10 : 5) +
      (tokenCost < 15_000 ? 10 : 6),
    ));

    return {
      treatmentResult: {
        runner: `evaluation-runner:${this.name}`,
        problem: project.problemFileId,
        evalConfig: project.evalConfig,
        package: result.package ?? null,
        model: result.model,
        judge: result.judge,
        cases: caseDetail,
        summary,
      },
      successRate,
      tokenCost,
      dossierSnapshot: {
        generatedBy: `evaluation-runner:${this.name}`,
        dshVersion: result.dshVersion,
        profile: result.profile,
        startedAt: result.startedAt,
        /** 本次复验用的实验包声明与依赖自检（包驱动的可追溯口径） */
        experimentPackage: result.package ?? null,
        dependencyCheck: result.dependencyCheck ?? null,
        invocationCount: result.cases.length,
        measuredOutcomes: {
          success: summary.passCount,
          failure: summary.runs - summary.passCount,
        },
        boundariesDocumented,
        pitfallsRecorded: result.skillInfo?.pitfallsRecorded ?? 0,
        successRate: summary.successRate,
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
