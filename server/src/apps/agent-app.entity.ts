import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 应用可见性：只自己 / 教师可见 / 课程内可见 */
export enum AppVisibility {
  OWNER = 'owner',
  TEACHER = 'teacher',
  COURSE = 'course',
}

/** 应用状态：草稿 / 已发布 / 已下架 */
export enum AppStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

/**
 * 学生做的智能体应用（第 20 章）。
 *
 * 一个应用 = 一份打包好的产物（`app.json` + `harness/` + `web/`）+ 一个按需启动的运行容器。
 * 版本单独存（`agent_app_versions`），发布/下架只改状态，不删数据 —— 教师可以回滚。
 */
@Entity('agent_apps')
export class AgentApp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  studentId: string;

  /** 关联的课程（教师按课程管理应用）；可以留空 = 学生自建、暂不归属课程 */
  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  courseId: string | null;

  /** 关联的实验项目（可选，用于把应用挂在某次作业下） */
  @Column({ type: 'varchar', length: 36, nullable: true })
  projectId: string | null;

  @Column({ length: 120 })
  title: string;

  @Column({ type: 'text', nullable: true })
  scenario: string | null;

  /** 前端入口（一般是 `harness/api.py`；展示用） */
  @Column({ length: 200, default: 'harness/api.py' })
  entry: string;

  /** `app.json` 的 theme 原样存（前端预览按它渲染） */
  @Column({ type: 'json', nullable: true })
  theme: { mode?: string; accent?: string } | null;

  /** 支持的附件类型（pdf / docx / image …） */
  @Column({ type: 'json', nullable: true })
  attachments: string[] | null;

  @Column({ type: 'enum', enum: AppVisibility, default: AppVisibility.TEACHER })
  visibility: AppVisibility;

  @Column({ type: 'enum', enum: AppStatus, default: AppStatus.DRAFT })
  status: AppStatus;

  /** 当前生效的版本（`agent_app_versions.id`） */
  @Column({ type: 'varchar', length: 36, nullable: true })
  latestVersionId: string | null;

  /** 分享链接用的能力凭证（发布时生成；下架即失效） */
  @Column({ type: 'varchar', length: 40, nullable: true })
  @Index()
  shareKey: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** 应用版本：每次上传一个 zip 就是一条；只增不改（回滚 = 切 latestVersionId） */
@Entity('agent_app_versions')
export class AgentAppVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  appId: string;

  /** `stored_files.id`（上传的 zip） */
  @Column({ length: 36 })
  fileId: string;

  /** 解包后的产物根（宿主路径，运行时挂进容器） */
  @Column({ type: 'text' })
  bundlePath: string;

  @Column({ length: 64, default: '' })
  sha256: string;

  @Column({ type: 'int', default: 0 })
  size: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

/** 应用对话记录（教师可看；学生自己也能看） */
@Entity('agent_app_messages')
export class AgentAppMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  appId: string;

  @Column({ length: 40 })
  sessionId: string;

  /** `user` / `assistant` */
  @Column({ length: 16 })
  role: string;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn()
  createdAt: Date;
}

/** 教师对学生应用的一次评分（二期；一期只在设计文档里） */
@Entity('agent_app_reviews')
export class AgentAppReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  appId: string;

  @Column()
  teacherId: string;

  /** 总分（0~100） */
  @Column({ type: 'int', default: 0 })
  total: number;

  /** 各维度明细：[{ name, weight, score, comment? }] */
  @Column({ type: 'json', nullable: true })
  dimensions: { name: string; weight: number; score: number; comment?: string }[] | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
