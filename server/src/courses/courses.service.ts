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
import { buildSlugBase } from './slug.util';
import { resolveApplicationState, seatsLeft } from './application-state.util';

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

  async createCourse(teacher: User, dto: CreateCourseDto) {
    const course = await this.courseRepo.save(
      this.courseRepo.create({
        title: dto.title,
        term: dto.term ?? '',
        description: dto.description ?? null,
        teacherId: teacher.id,
      }),
    );
    // 公开链接标识：建课时即生成，发布时若为空再兜底（见 publishCourse）
    course.slug = await this.uniqueSlug(buildSlugBase(dto.title, course.id));
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
    // 报名状态：教师端「公开报名」页签要用（与公开目录共用同一套判定）
    const approvedCount = await this.enrollmentRepo.count({
      where: { courseId },
    });
    const enrollmentState = {
      applicationState: resolveApplicationState(course, approvedCount),
      approvedCount,
      seatsLeft: seatsLeft(course.capacity, approvedCount),
    };
    if (chapters.length === 0) {
      return { ...course, ...enrollmentState, chapters };
    }
    // 章节下挂的实验项目一并返回（课程详情页大纲用）
    const projects = await this.projectRepo.find({
      where: { chapterId: In(chapters.map((c) => c.id).concat([''])) },
      order: { createdAt: 'ASC' },
    });
    return {
      ...course,
      ...enrollmentState,
      chapters: chapters.map((ch) => ({
        ...ch,
        projects: projects
          .filter((p) => p.chapterId === ch.id)
          .map((p) => ({ id: p.id, title: p.title, status: p.status })),
      })),
    };
  }

  /**
   * 编辑课程。**显式逐字段赋值**而不是 Object.assign(course, dto)——
   * class-transformer 会把 DTO 未提交的可选字段补成 undefined，
   * 整体赋值会把实体上已有的值在内存里抹掉（HANDOFF 第 3.10 条踩过同类坑）。
   */
  async updateCourse(user: User, courseId: string, dto: UpdateCourseDto) {
    const course = await this.getOwnedCourse(user, courseId);

    if (dto.slug !== undefined) {
      if (course.status === CourseStatus.PUBLISHED && dto.slug !== course.slug) {
        throw new BadRequestException('课程已发布，公开链接标识不可再修改');
      }
      if (dto.slug) {
        const normalized = dto.slug.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
          throw new BadRequestException(
            '链接标识只能包含小写字母、数字和连字符',
          );
        }
        course.slug = await this.uniqueSlug(normalized, course.id);
      }
    }

    if (dto.title !== undefined) course.title = dto.title;
    if (dto.term !== undefined) course.term = dto.term;
    if (dto.description !== undefined) course.description = dto.description;
    if (dto.capacity !== undefined) course.capacity = dto.capacity ?? null;
    if (dto.applicationOpenAt !== undefined) {
      course.applicationOpenAt = dto.applicationOpenAt
        ? new Date(dto.applicationOpenAt)
        : null;
    }
    if (dto.applicationCloseAt !== undefined) {
      course.applicationCloseAt = dto.applicationCloseAt
        ? new Date(dto.applicationCloseAt)
        : null;
    }

    return this.courseRepo.save(course);
  }

  async publishCourse(user: User, courseId: string) {
    const course = await this.getOwnedCourse(user, courseId);
    course.status = CourseStatus.PUBLISHED;
    // 兜底：老数据/迁移遗漏时确保公开页可访问
    if (!course.slug) {
      course.slug = await this.uniqueSlug(buildSlugBase(course.title, course.id));
    }
    return this.courseRepo.save(course);
  }

  /** 生成唯一公开链接标识；冲突时追加 -2、-3… */
  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    const root = base || 'course';
    let candidate = root;
    let n = 1;
    for (;;) {
      const exists = await this.courseRepo.findOne({
        where: { slug: candidate },
      });
      if (!exists || exists.id === excludeId) {
        return candidate;
      }
      n += 1;
      candidate = `${root}-${n}`;
    }
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
    // 用 max(order) + 1 而不是 count + 1：删过章节后 count 会小于现有最大 order，
    // 再按 count 加一就会与已有章节**撞号**（曾导致同一课程出现两个 order=3，
    // 而解锁规则用 order 比较前置章节 → 两章互为"之后"，学生领取条件算错）
    const maxRow = await this.chapterRepo
      .createQueryBuilder('chapter')
      .select('MAX(chapter.order)', 'max')
      .where('chapter.courseId = :courseId', { courseId })
      .getRawOne<{ max: number | null }>();
    const nextOrder = Number(maxRow?.max ?? 0) + 1;
    const chapter = this.chapterRepo.create({
      courseId,
      title: dto.title,
      order: dto.order ?? nextOrder,
      content: dto.content ?? null,
      exampleSkills: dto.exampleSkills ?? null,
      status: dto.status ?? ChapterStatus.DRAFT,
    });
    return this.chapterRepo.save(chapter);
  }

  /**
   * 重排章节顺序：按传入 id 的顺序把 `order` 重写为 `1..N`（顺带把重复/跳号的 order 规范化）。
   * 必须传该课程的**全部**章节 id —— 漏传 / 重复 / 不属于本课程都会被拒，
   * 避免"静默把某章挤到末尾"这种悄悄改序。
   */
  async reorderChapters(user: User, courseId: string, chapterIds: string[]) {
    await this.getOwnedCourse(user, courseId);
    const chapters = await this.chapterRepo.find({ where: { courseId } });
    const byId = new Map(chapters.map((c) => [c.id, c]));
    if (chapterIds.length !== chapters.length) {
      throw new BadRequestException(
        `章节列表不完整：本课程有 ${chapters.length} 个章节，收到 ${chapterIds.length} 个`,
      );
    }
    const seen = new Set<string>();
    chapterIds.forEach((id) => {
      if (!byId.has(id)) {
        throw new BadRequestException(`章节不属于该课程：${id}`);
      }
      if (seen.has(id)) {
        throw new BadRequestException(`章节 id 重复：${id}`);
      }
      seen.add(id);
    });
    const ordered = chapterIds.map((id, index) => {
      const chapter = byId.get(id)!;
      chapter.order = index + 1;
      return chapter;
    });
    await this.chapterRepo.save(ordered);
    return ordered.map((c) => ({
      id: c.id,
      title: c.title,
      order: c.order,
      status: c.status,
    }));
  }

  async listChapters(user: User, courseId: string) {    const course = await this.courseRepo.findOne({ where: { id: courseId } });
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
      relations: ['teacher'],
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
        description: course.description,
        teacherName: course.teacher?.nickname || course.teacher?.username || '',
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

  /** 学生是否在课程名单里。公开给其他模块复用 —— 权限口径只留一份实现，避免各处漂移 */
  async assertEnrolled(courseId: string, studentId: string) {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { courseId, studentId },
    });
    if (!enrollment) {
      throw new ForbiddenException('你不在该课程的学生名单中');
    }
  }
}
