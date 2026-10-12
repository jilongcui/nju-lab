import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 内容操作记录（谁在什么时候改了什么）—— 多教师协作的配套能力，
 * 见 docs/DESIGN-2026-10-11-course-co-teachers.md（§8 追记）。
 *
 * 为什么要有它：乐观锁只告诉「这份内容刚被别人改过」（`updatedBy` 是**最后一个人**），
 * 但两位老师协作时经常需要回看**历史**——「刚才那版是谁改的」「幻灯片是谁重生成的」。
 * 这里记的是**写操作的流水**，不记读操作，也不存内容快照（体积可控）。
 *
 * 与 `submissions.auditEvents` 的区别：那是**学生提交**随包上行的 DSH 会话证据；
 * 这张表是**教师侧内容改动**的服务端记录。
 */
@Entity('content_audits')
export class ContentAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  courseId: string;

  /**
   * 操作类型（用 varchar 而不是 enum：以后加类型不必再动 schema）：
   *   chapter_create / chapter_save / chapter_delete / course_update / course_transfer /
   *   course_delete / teachers_update / deck_save / deck_generate
   */
  @Column({ type: 'varchar', length: 32 })
  action: string;

  /** 作用对象：course / chapter / deck / teachers */
  @Column({ type: 'varchar', length: 16 })
  targetType: string;

  /** 对象 id（章节/幻灯片/课程）；actions 类操作可为空 */
  @Column({ type: 'varchar', length: 36, nullable: true })
  targetId: string | null;

  /** 人可读的一句话（如「保存了章节「向量数据库」」），列表直接展示 */
  @Column({ type: 'varchar', length: 255 })
  summary: string;

  /** 操作人 */
  @Index()
  @Column({ type: 'varchar', length: 36 })
  actorId: string;

  @CreateDateColumn()
  createdAt: Date;
}
