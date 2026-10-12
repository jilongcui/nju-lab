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

/**
 * 课程的**授课教师名单**（多教师协作，见 docs/DESIGN-2026-10-11-course-co-teachers.md）。
 *
 * 设计要点：
 *   · 「谁能编辑这门课」以**这张表**为唯一真源 —— 权限判定收敛在 `CoursesService.isTeacherOfCourse()`，
 *     各模块不要自己比 `courses.teacherId`（那是散落 11 处的老写法）。
 *   · **主教师也在表里**：`courses.teacherId` 只表示「主教师/负责人」（展示、转让、发布用它），
 *     成员资格一律看这张表，这样「我参与的全部课程」是一条 JOIN 就能查出来。
 *   · 转让主教师**不**移除原主教师的成员资格（他退为协作者，不夺走编辑权）。
 */
@Entity('course_teachers')
@Unique(['courseId', 'userId'])
export class CourseTeacher {
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
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}
