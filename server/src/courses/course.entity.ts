import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum CourseStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

@Entity('courses')
export class Course {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Index()
  @Column()
  teacherId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacherId' })
  teacher: User;

  @Column({ default: '' })
  term: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: CourseStatus, default: CourseStatus.DRAFT })
  status: CourseStatus;

  // ---------- 公开目录与申请审批（见 docs/DESIGN-course-application-2026-09-24.md） ----------

  /**
   * 公开链接标识（/lab/course/<slug>）。
   * 发布后锁定，不再允许修改，保证已分享的链接不失效。
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  slug: string | null;

  /** 名额上限；null = 不限。判定口径是「已批准数」（count(enrollments)） */
  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  /**
   * 申请开放时间：null = 不开放申请（纯展示）；未来 = 待开放；过去 = 开放中。
   * 与 status 解耦——published 只表示「别人能看到」。
   */
  @Column({ type: 'datetime', nullable: true })
  applicationOpenAt: Date | null;

  /** 申请截止时间；null = 不设截止 */
  @Column({ type: 'datetime', nullable: true })
  applicationCloseAt: Date | null;

  @OneToMany(() => Chapter, (chapter) => chapter.course)
  chapters: Chapter[];

  @CreateDateColumn()
  createdAt: Date;
}

export enum ChapterStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

@Entity('chapters')
export class Chapter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  courseId: string;

  @ManyToOne(() => Course, (course) => course.chapters, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'courseId' })
  course: Course;

  @Column({ type: 'int' })
  order: number;

  @Column()
  title: string;

  /** 教学内容：Markdown 图文 + 附件/视频链接 */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  /** 关联的示例 Skill（引用参考技能库） */
  @Column({ type: 'json', nullable: true })
  exampleSkills: string[] | null;

  @Column({ type: 'enum', enum: ChapterStatus, default: ChapterStatus.DRAFT })
  status: ChapterStatus;

  @CreateDateColumn()
  createdAt: Date;
}
