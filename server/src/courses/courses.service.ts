import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import {
  Chapter,
  ChapterStatus,
  Course,
  CourseStatus,
} from './course.entity';
import { ChapterProgress, Enrollment, ProgressStatus } from './enrollment.entity';
import { ExperimentProject } from '../projects/project.entity';
import {
  CreateCourseDto,
  EnrollStudentsDto,
  UpdateCourseDto,
  UpsertChapterDto,
} from './dto/course.dto';

@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course)
    private readonly courseRepo: Repository<Course>,
    @InjectRepository(Chapter)
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(ChapterProgress)
    private readonly progressRepo: Repository<ChapterProgress>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ExperimentProject)
    private readonly projectRepo: Repository<ExperimentProject>,
  ) {}

  // ---------- 课程 CRUD ----------

  createCourse(teacher: User, dto: CreateCourseDto) {
    const course = this.courseRepo.create({
      title: dto.title,
      term: dto.term ?? '',
      description: dto.description ?? null,
      teacherId: teacher.id,
    });
    return this.courseRepo.save(course);
  }

  /** 管理员看全部课程，教师看自己开的课，学生看自己被选入的课 */
  async listCourses(user: User) {
    if (user.role === UserRole.ADMIN) {
      return this.courseRepo.find({ order: { createdAt: 'DESC' } });
    }
    if (user.role === UserRole.TEACHER) {
      return this.courseRepo.find({
        where: { teacherId: user.id },
        order: { createdAt: 'DESC' },
      });
    }
    const enrollments = await this.enrollmentRepo.find({
      where: { studentId: user.id },
    });
    if (enrollments.length === 0) {
      return [];
    }
    return this.courseRepo.find({
      where: { id: In(enrollments.map((e) => e.courseId)) },
      order: { createdAt: 'DESC' },
    });
  }

  async getCourse(user: User, courseId: string) {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (user.role === UserRole.TEACHER || user.role === UserRole.ADMIN) {
      this.assertOwner(course, user);
    } else {
      await this.assertEnrolled(courseId, user.id);
      if (course.status !== CourseStatus.PUBLISHED) {
        throw new ForbiddenException('课程尚未发布');
      }
    }
    const chapters = await this.chapterRepo.find({
      where:
        user.role === UserRole.TEACHER || user.role === UserRole.ADMIN
          ? { courseId }
          : { courseId, status: ChapterStatus.PUBLISHED },
      order: { order: 'ASC' },
    });
    if (chapters.length === 0) {
      return { ...course, chapters };
    }
    // 章节下挂的实验项目一并返回（课程详情页大纲用）
    const projects = await this.projectRepo.find({
      where: { chapterId: In(chapters.map((c) => c.id).concat([''])) },
      order: { createdAt: 'ASC' },
    });
    return {
      ...course,
      chapters: chapters.map((ch) => ({
        ...ch,
        projects: projects
          .filter((p) => p.chapterId === ch.id)
          .map((p) => ({ id: p.id, title: p.title, status: p.status })),
      })),
    };
  }

  async updateCourse(user: User, courseId: string, dto: UpdateCourseDto) {
    const course = await this.getOwnedCourse(user, courseId);
    Object.assign(course, dto);
    return this.courseRepo.save(course);
  }

  async publishCourse(user: User, courseId: string) {
    const course = await this.getOwnedCourse(user, courseId);
    course.status = CourseStatus.PUBLISHED;
    return this.courseRepo.save(course);
  }

  /** 删除课程（级联删除章节、实验、选课、提交等，FK 已配置 CASCADE） */
  async removeCourse(user: User, courseId: string) {
    const course = await this.getOwnedCourse(user, courseId);
    await this.courseRepo.remove(course);
    return { deleted: true, id: courseId };
  }

  /** 删除章节（级联删除其下实验项目） */
  async removeChapter(user: User, chapterId: string) {
    const chapter = await this.chapterRepo.findOne({
      where: { id: chapterId },
    });
    if (!chapter) {
      throw new NotFoundException('章节不存在');
    }
    await this.getOwnedCourse(user, chapter.courseId);
    await this.chapterRepo.remove(chapter);
    return { deleted: true, id: chapterId };
  }

  // ---------- 章节 ----------

  async upsertChapter(user: User, courseId: string, dto: UpsertChapterDto) {
    await this.getOwnedCourse(user, courseId);
    if (dto.id) {
      const chapter = await this.chapterRepo.findOne({
        where: { id: dto.id, courseId },
      });
      if (!chapter) {
        throw new NotFoundException('章节不存在');
      }
      Object.assign(chapter, {
        title: dto.title,
        order: dto.order ?? chapter.order,
        content: dto.content ?? chapter.content,
        exampleSkills: dto.exampleSkills ?? chapter.exampleSkills,
        status: dto.status ?? chapter.status,
      });
      return this.chapterRepo.save(chapter);
    }
    const count = await this.chapterRepo.count({ where: { courseId } });
    const chapter = this.chapterRepo.create({
      courseId,
      title: dto.title,
      order: dto.order ?? count + 1,
      content: dto.content ?? null,
      exampleSkills: dto.exampleSkills ?? null,
      status: dto.status ?? ChapterStatus.DRAFT,
    });
    return this.chapterRepo.save(chapter);
  }

  async listChapters(user: User, courseId: string) {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const isOwner = course.teacherId === user.id || user.role === UserRole.ADMIN;
    if (!isOwner) {
      await this.assertEnrolled(courseId, user.id);
    }
    return this.chapterRepo.find({
      where: isOwner
        ? { courseId }
        : { courseId, status: ChapterStatus.PUBLISHED },
      order: { order: 'ASC' },
    });
  }

  /** 学生阅读章节：自动把进度从"未开始"推进到"学习中" */
  async readChapter(user: User, chapterId: string) {
    const chapter = await this.chapterRepo.findOne({
      where: { id: chapterId },
    });
    if (!chapter) {
      throw new NotFoundException('章节不存在');
    }
    if (user.role === UserRole.STUDENT) {
      if (chapter.status !== ChapterStatus.PUBLISHED) {
        throw new ForbiddenException('章节尚未发布');
      }
      await this.assertEnrolled(chapter.courseId, user.id);
      // 仅在"未开始"时推进为"学习中"，不回退"已完成"
      let progress = await this.progressRepo.findOne({
        where: { chapterId, studentId: user.id },
      });
      if (!progress) {
        progress = await this.progressRepo.save(
          this.progressRepo.create({
            chapterId,
            studentId: user.id,
            status: ProgressStatus.IN_PROGRESS,
          }),
        );
      } else if (progress.status === ProgressStatus.NOT_STARTED) {
        progress.status = ProgressStatus.IN_PROGRESS;
        progress = await this.progressRepo.save(progress);
      }
      return { ...chapter, myProgress: progress.status };
    }
    const course = await this.courseRepo.findOne({
      where: { id: chapter.courseId },
    });
    if (
      !course ||
      (course.teacherId !== user.id && user.role !== UserRole.ADMIN)
    ) {
      throw new ForbiddenException('没有权限查看该章节');
    }
    return chapter;
  }

  /** 学生标记章节完成 */
  async completeChapter(user: User, chapterId: string) {
    const chapter = await this.chapterRepo.findOne({
      where: { id: chapterId },
    });
    if (!chapter) {
      throw new NotFoundException('章节不存在');
    }
    if (chapter.status !== ChapterStatus.PUBLISHED) {
      throw new ForbiddenException('章节尚未发布');
    }
    await this.assertEnrolled(chapter.courseId, user.id);
    let progress = await this.progressRepo.findOne({
      where: { chapterId, studentId: user.id },
    });
    if (!progress) {
      progress = this.progressRepo.create({ chapterId, studentId: user.id });
    }
    progress.status = ProgressStatus.COMPLETED;
    progress.completedAt = new Date();
    return this.progressRepo.save(progress);
  }

  // ---------- 选课名单 ----------

  /** 已选学生名单 */
  async listEnrollments(user: User, courseId: string) {
    await this.getOwnedCourse(user, courseId);
    const enrollments = await this.enrollmentRepo.find({
      where: { courseId },
      order: { createdAt: 'ASC' },
    });
    if (enrollments.length === 0) {
      return [];
    }
    const students = await this.userRepo.find({
      where: { id: In(enrollments.map((e) => e.studentId).concat([''])) },
    });
    return enrollments.map((e) => {
      const s = students.find((u) => u.id === e.studentId);
      return {
        id: e.id,
        studentId: e.studentId,
        username: s?.username ?? '',
        nickname: s?.nickname ?? '',
        enrolledAt: e.createdAt,
      };
    });
  }

  /** 移出学生（同时清理其章节进度） */
  async unenroll(user: User, courseId: string, studentId: string) {
    await this.getOwnedCourse(user, courseId);
    await this.enrollmentRepo.delete({ courseId, studentId });
    const chapters = await this.chapterRepo.find({ where: { courseId } });
    if (chapters.length > 0) {
      await this.progressRepo.delete({
        chapterId: In(chapters.map((c) => c.id)),
        studentId,
      });
    }
    return { deleted: true, studentId };
  }

  async enrollStudents(user: User, courseId: string, dto: EnrollStudentsDto) {
    await this.getOwnedCourse(user, courseId);
    const students = await this.userRepo.find({
      where: { id: In(dto.studentIds), role: UserRole.STUDENT },
    });
    if (students.length !== dto.studentIds.length) {
      throw new BadRequestException('存在无效或非学生角色的 studentId');
    }
    const results: Enrollment[] = [];
    for (const student of students) {
      const exists = await this.enrollmentRepo.findOne({
        where: { courseId, studentId: student.id },
      });
      if (!exists) {
        results.push(
          await this.enrollmentRepo.save(
            this.enrollmentRepo.create({ courseId, studentId: student.id }),
          ),
        );
      }
    }
    return { enrolled: results.length, total: students.length };
  }

  // ---------- 班级学习进度 ----------

  /** GET /api/courses/:id/progress —— 每个学生的逐章进度 */
  async getCourseProgress(user: User, courseId: string) {
    await this.getOwnedCourse(user, courseId);
    const chapters = await this.chapterRepo.find({
      where: { courseId, status: ChapterStatus.PUBLISHED },
      order: { order: 'ASC' },
    });
    const enrollments = await this.enrollmentRepo.find({
      where: { courseId },
      relations: ['student'],
    });
    const progressList = await this.progressRepo.find({
      where: { chapterId: In(chapters.map((c) => c.id).concat([''])) },
    });
    const progressMap = new Map(
      progressList.map((p) => [`${p.studentId}:${p.chapterId}`, p]),
    );
    const students = enrollments.map((enrollment) => {
      const chapterProgress = chapters.map((chapter) => ({
        chapterId: chapter.id,
        title: chapter.title,
        order: chapter.order,
        status:
          progressMap.get(`${enrollment.studentId}:${chapter.id}`)?.status ??
          ProgressStatus.NOT_STARTED,
        completedAt:
          progressMap.get(`${enrollment.studentId}:${chapter.id}`)
            ?.completedAt ?? null,
      }));
      const completedCount = chapterProgress.filter(
        (p) => p.status === ProgressStatus.COMPLETED,
      ).length;
      return {
        studentId: enrollment.studentId,
        username: enrollment.student.username,
        nickname: enrollment.student.nickname,
        completedCount,
        totalChapters: chapters.length,
        chapters: chapterProgress,
      };
    });
    return {
      courseId,
      chapterCount: chapters.length,
      studentCount: students.length,
      students,
    };
  }

  /** GET /api/courses/:id/dashboard —— 章节完成率 */
  async getCourseDashboard(user: User, courseId: string) {
    await this.getOwnedCourse(user, courseId);
    const chapters = await this.chapterRepo.find({
      where: { courseId, status: ChapterStatus.PUBLISHED },
      order: { order: 'ASC' },
    });
    const studentCount = await this.enrollmentRepo.count({
      where: { courseId },
    });
    const chapterStats = await Promise.all(
      chapters.map(async (chapter) => {
        const completedCount = await this.progressRepo.count({
          where: { chapterId: chapter.id, status: ProgressStatus.COMPLETED },
        });
        const inProgressCount = await this.progressRepo.count({
          where: { chapterId: chapter.id, status: ProgressStatus.IN_PROGRESS },
        });
        return {
          chapterId: chapter.id,
          title: chapter.title,
          order: chapter.order,
          studentCount,
          completedCount,
          inProgressCount,
          completionRate:
            studentCount === 0 ? 0 : completedCount / studentCount,
        };
      }),
    );
    return { courseId, studentCount, chapters: chapterStats };
  }

  /** GET /api/me/courses —— 学生：我的课程 + 逐章进度 */
  async getMyCourses(student: User) {
    const enrollments = await this.enrollmentRepo.find({
      where: { studentId: student.id },
    });
    if (enrollments.length === 0) {
      return [];
    }
    const courses = await this.courseRepo.find({
      where: { id: In(enrollments.map((e) => e.courseId)) },
    });
    const result = [];
    for (const course of courses) {
      const chapters = await this.chapterRepo.find({
        where: { courseId: course.id, status: ChapterStatus.PUBLISHED },
        order: { order: 'ASC' },
      });
      const progressList = await this.progressRepo.find({
        where: {
          studentId: student.id,
          chapterId: In(chapters.map((c) => c.id).concat([''])),
        },
      });
      const progressMap = new Map(progressList.map((p) => [p.chapterId, p]));
      const chapterViews = chapters.map((chapter) => ({
        id: chapter.id,
        order: chapter.order,
        title: chapter.title,
        status:
          progressMap.get(chapter.id)?.status ?? ProgressStatus.NOT_STARTED,
        completedAt: progressMap.get(chapter.id)?.completedAt ?? null,
      }));
      result.push({
        id: course.id,
        title: course.title,
        term: course.term,
        courseStatus: course.status,
        completedCount: chapterViews.filter(
          (c) => c.status === ProgressStatus.COMPLETED,
        ).length,
        chapters: chapterViews,
      });
    }
    return result;
  }

  // ---------- 内部工具 ----------

  async getOwnedCourse(user: User, courseId: string): Promise<Course> {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    this.assertOwner(course, user);
    return course;
  }

  private assertOwner(course: Course, user: User) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
    if (course.teacherId !== user.id) {
      throw new ForbiddenException('只有课程所属教师可以执行该操作');
    }
  }

  private async assertEnrolled(courseId: string, studentId: string) {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { courseId, studentId },
    });
    if (!enrollment) {
      throw new ForbiddenException('你不在该课程的学生名单中');
    }
  }
}
