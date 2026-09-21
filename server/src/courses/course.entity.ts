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
