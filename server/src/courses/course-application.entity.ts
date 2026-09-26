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
import { Course } from './course.entity';
import { User } from '../users/user.entity';

export enum ApplicationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * 课程申请：学生报名 → 教师逐个审批。
 *
 * 设计要点（见 docs/DESIGN-course-application-2026-09-24.md §3）：
 * - **不**给 Enrollment 加状态：Enrollment 的语义保持「已批准入册」，
 *   可见性/内容授权/任务分发三处依赖它的代码因此零改动。
 * - 允许重复申请（驳回后可再申请、不限频），但同一课程同一学生
 *   同时只能有一条 pending —— 由生成列 pendingFlag + 唯一索引保证。
 * - 容量口径是「已批准数」（count(enrollments)），所以多余的 rejected
 *   记录不影响名额。
 */
@Entity('course_applications')
@Unique('uq_course_application_pending', ['courseId', 'studentId', 'pendingFlag'])
export class CourseApplication {
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
  studentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: User;

  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.PENDING,
  })
  status: ApplicationStatus;

  /** 审批意见 / 驳回理由（可选） */
  @Column({ type: 'text', nullable: true })
  decisionNote: string | null;

  /** 审批人（教师或管理员）userId */
  @Column({ type: 'varchar', length: 36, nullable: true })
  decidedBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  decidedAt: Date | null;

  /**
   * 生成列：仅 pending 时为 1，其余为 NULL。
   *
   * 借助 MySQL「唯一索引允许多个 NULL」的特性，实现
   * 「允许重复申请，但同一课程 + 同一学生同时只有一条 pending」：
   *   两条 pending  → 1, 1    → 冲突 ✓
   *   pending+rejected → 1, NULL → 放行 ✓
   *   两条 rejected → NULL, NULL → 放行 ✓
   */
  @Column({
    type: 'tinyint',
    nullable: true,
    select: false,
    asExpression: "IF(`status` = 'pending', 1, NULL)",
    generatedType: 'STORED',
  })
  pendingFlag: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
