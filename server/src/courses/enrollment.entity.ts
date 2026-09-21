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
import { Chapter } from './course.entity';
import { User } from '../users/user.entity';

@Entity('enrollments')
@Unique(['courseId', 'studentId'])
export class Enrollment {
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

  @CreateDateColumn()
  createdAt: Date;
}

export enum ProgressStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

@Entity('chapter_progress')
@Unique(['chapterId', 'studentId'])
export class ChapterProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  chapterId: string;

  @ManyToOne(() => Chapter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chapterId' })
  chapter: Chapter;

  @Index()
  @Column()
  studentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: User;

  @Column({ type: 'enum', enum: ProgressStatus, default: ProgressStatus.NOT_STARTED })
  status: ProgressStatus;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
