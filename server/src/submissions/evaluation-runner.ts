import { createHash } from 'crypto';
import { ExperimentProject } from '../projects/project.entity';
import { Submission } from './submission.entity';

export interface EvaluationRunResult {
  /** 「使用 Skill」那一轮的运行结果（baseline 轮已于 2026-10-06 取消） */
  treatmentResult: Record<string, unknown>;
  successRate: number;
  tokenCost: number;
  dossierSnapshot: Record<string, unknown>;
  integrityCheck: Record<string, unknown>;
  autoScoreSuggestion: number;
}

/**
 * 复验执行器抽象：SubmissionsService 只依赖本接口，不感知复验如何执行。
 *
 * 当前实现：MockEvaluationRunner——基于提交哈希生成确定性的模拟评估数据，
 * 用于打通"提交 → 复验 → 评分"链路。
 * 后续接入真实复验时，新增实现：对每个提交起一个一次性容器
 * （dsh headless + approval=never + 断网 + 资源限额），跑一轮（学生的 Skill）
 * + judge 评分并回填 dossier 快照，然后在 SubmissionsModule 中替换 EVALUATION_RUNNER
 * 的 useClass 即可。
 */
export interface EvaluationRunner {
  readonly name: string;
  run(
    submission: Submission,
    project: ExperimentProject,
  ): Promise<EvaluationRunResult>;
}

export const EVALUATION_RUNNER = Symbol('EVALUATION_RUNNER');

/** 模拟复验：用提交哈希做种子，生成确定性假数据（同一提交多次复验结果一致） */
export class MockEvaluationRunner implements EvaluationRunner {
  readonly name = 'mock';

  async run(
    submission: Submission,
    project: ExperimentProject,
  ): Promise<EvaluationRunResult> {
    const rand = seededRandom(
      `${submission.id}:${submission.skillZipSha256}:${submission.capsuleSha256}`,
    );

    const datasetSize = 20;
    // 单轮复验（baseline 轮已取消）：直接生成「使用 Skill」那一轮的成功率。
    const successRate = Math.min(0.98, 0.55 + rand() * 0.4); // 单轮成功率 55%~95%
    const tokenCost = Math.floor(4000 + rand() * 21000); // 单轮（两轮时代的约一半）

    const treatmentResult = {
      dataset: project.testDatasetFileId,
      evalConfig: project.evalConfig,
      runs: datasetSize,
      successRate: round2(successRate),
      avgTokensPerRun: Math.floor(tokenCost / datasetSize),
    };

    const dossierSnapshot = {
      generatedBy: `evaluation-runner:${this.name}`,
      direction: ['engineering', 'data-processing'][Math.floor(rand() * 2)],
      invocationCount: datasetSize,
      measuredOutcomes: {
        success: Math.round(successRate * datasetSize),
        failure: datasetSize - Math.round(successRate * datasetSize),
      },
      boundariesDocumented: rand() > 0.3,
      pitfallsRecorded: Math.floor(rand() * 5),
    };

    const consistent = rand() > 0.15;
    const integrityCheck = {
      capsuleHashVerified: true,
      selfReportVsRerun: consistent ? 'consistent' : 'suspicious',
      deviation: round2(rand() * 0.1),
      note: consistent
        ? '学生自报结果与平台复验一致'
        : '自报与复验偏差偏大，建议教师人工复核',
    };

    // 按第九节评分维度生成建议分（实测有效性为主导；lift 项已并入成功率）
    const autoScoreSuggestion = round2(
      successRate * 55 +
        (dossierSnapshot.boundariesDocumented ? 20 : 10) +
        (consistent ? 10 : 5) +
        (tokenCost < 15000 ? 10 : 6),
    );

    return {
      treatmentResult,
      successRate: round2(successRate),
      tokenCost,
      dossierSnapshot,
      integrityCheck,
      autoScoreSuggestion: Math.min(100, autoScoreSuggestion),
    };
  }
}

function seededRandom(seed: string): () => number {
  let state = parseInt(
    createHash('sha256').update(seed).digest('hex').slice(0, 8),
    16,
  );
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
