import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Assignment } from '../projects/project.entity';
import { User } from '../users/user.entity';

export enum SubmissionStatus {
  SUBMITTED = 'submitted',
  VERIFYING = 'verifying',
  VERIFIED = 'verified',
  FAILED = 'failed',
  GRADED = 'graded',
}

@Entity('submissions')
@Index('IDX_submissions_assignment_version', ['assignmentId', 'version'])
export class Submission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  assignmentId: string;

  @ManyToOne(() => Assignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignmentId' })
  assignment: Assignment;

  @Index()
  @Column()
  studentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: User;

  @CreateDateColumn()
  submittedAt: Date;

  /** 同一任务下的提交版本号，从 1 起递增 */
  @Column({ type: 'int', default: 1 })
  version: number;

  /** 完整 Skill 目录包（存储引用 + 哈希，本阶段不接对象存储） */
  @Column()
  skillZipRef: string;

  @Column()
  skillZipSha256: string;

  /** .dshc 证据包（存储引用 + 完整性哈希） */
  @Column()
  capsuleRef: string;

  @Column()
  capsuleSha256: string;

  /** 会话审计事件（approval 对、permission/preset 提权日志） */
  @Column({ type: 'json', nullable: true })
  auditEvents: unknown[] | null;

  /** 提交时刻全部文件哈希登记（防篡改）：相对路径 -> sha256 */
  @Column({ type: 'json', nullable: true })
  fileHashes: Record<string, string> | null;

  @Column({ type: 'enum', enum: SubmissionStatus, default: SubmissionStatus.SUBMITTED })
  status: SubmissionStatus;

  @OneToOne(() => Evaluation, (evaluation) => evaluation.submission)
  evaluation: Evaluation | null;
}

/** 评估结果（由 EvaluationRunner 产生；当前为模拟复验，后续接一次性容器真实复验） */
@Entity('evaluations')
export class Evaluation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  submissionId: string;

  @OneToOne(() => Submission, (submission) => submission.evaluation, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'submissionId' })
  submission: Submission;

  /** baseline（不用 Skill）运行结果 */
  @Column({ type: 'json', nullable: true })
  baselineResult: Record<string, unknown> | null;

  /** treatment（用 Skill）运行结果 */
  @Column({ type: 'json', nullable: true })
  treatmentResult: Record<string, unknown> | null;

  @Column({ type: 'float', default: 0 })
  successRate: number;

  @Column({ type: 'int', default: 0 })
  tokenCost: number;

  /** dossier 快照（服务端复验时重新生成，与学生本地版对照） */
  @Column({ type: 'json', nullable: true })
  dossierSnapshot: Record<string, unknown> | null;

  /** 证据一致性检查（学生自报 vs 平台复验） */
  @Column({ type: 'json', nullable: true })
  integrityCheck: Record<string, unknown> | null;

  /** 平台基于客观数据生成的评分建议 */
  @Column({ type: 'float', nullable: true })
  autoScoreSuggestion: number | null;

  @Column({ type: 'float', nullable: true })
  teacherScore: number | null;

  @Column({ type: 'text', nullable: true })
  teacherComment: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
