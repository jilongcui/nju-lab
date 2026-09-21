import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Chapter, Course } from '../courses/course.entity';
import { User } from '../users/user.entity';

export enum ProjectStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CLOSED = 'closed',
}

/** 评估条件：模型、推理档位、工具集白名单、超时——学生自测与平台复验两处一致 */
export interface EvalConfig {
  model?: string;
  reasoningEffort?: string;
  tools?: string[];
  timeoutSeconds?: number;
  /** 复验评判模式：llm = LLM judge（默认）；exact = 与 expected 逐字节比对 */
  judgeMode?: 'llm' | 'exact';
  /** 成本控制：复验最多跑数据集前 N 个 case；缺省全部 */
  maxCases?: number;
}

/** 评分要求：维度权重（见设计文档第九节） */
export interface RubricDimension {
  name: string;
  weight: number;
  description?: string;
}

/** 解锁规则。默认（null 或 type=default）：完成所属章节之前的全部已发布章节 */
export interface UnlockRule {
  type: 'default' | 'none' | 'chapters';
  /** type=chapters 时：需完成的章节 id 列表 */
  chapterIds?: string[];
}

@Entity('experiment_projects')
export class ExperimentProject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  courseId: string;

  @ManyToOne(() => Course, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'courseId' })
  course: Course;

  @Index()
  @Column()
  chapterId: string;

  @ManyToOne(() => Chapter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chapterId' })
  chapter: Chapter;

  @Column()
  title: string;

  /** 实验目标 */
  @Column({ type: 'text', nullable: true })
  objectives: string | null;

  /** 背景知识 */
  @Column({ type: 'text', nullable: true })
  background: string | null;

  /** 任务要求（步骤、交付物说明） */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Skill 模板（ZIP）对应的存储文件 id，见 files 模块 */
  @Column({ type: 'varchar', length: 36, nullable: true })
  skillTemplateFileId: string | null;

  /** 标准测试数据集对应的存储文件 id，见 files 模块 */
  @Column({ type: 'varchar', length: 36, nullable: true })
  testDatasetFileId: string | null;

  @Column({ type: 'json', nullable: true })
  evalConfig: EvalConfig | null;

  @Column({ type: 'json', nullable: true })
  rubric: RubricDimension[] | null;

  /** 参考资料 */
  @Column({ type: 'text', nullable: true })
  references: string | null;

  /** 常见问题 */
  @Column({ type: 'text', nullable: true })
  faq: string | null;

  @Column({ type: 'json', nullable: true })
  unlockRule: UnlockRule | null;

  @Column({ type: 'datetime', nullable: true })
  deadline: Date | null;

  @Column({ type: 'enum', enum: ProjectStatus, default: ProjectStatus.DRAFT })
  status: ProjectStatus;

  @CreateDateColumn()
  createdAt: Date;
}

export enum AssignmentStatus {
  /** 已分发，未领取 */
  PENDING = 'pending',
  /** 已领取 */
  CLAIMED = 'claimed',
  /** 已提交 */
  SUBMITTED = 'submitted',
}

@Entity('assignments')
@Unique(['projectId', 'studentId'])
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  projectId: string;

  @ManyToOne(() => ExperimentProject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: ExperimentProject;

  @Index()
  @Column()
  studentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: User;

  @Column({ type: 'enum', enum: AssignmentStatus, default: AssignmentStatus.PENDING })
  status: AssignmentStatus;

  @Column({ type: 'datetime', nullable: true })
  claimedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
