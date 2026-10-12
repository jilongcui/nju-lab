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
import { CourseTeacher } from './course-teacher.entity';
import { ExperimentProject } from '../projects/project.entity';
import {
  CreateCourseDto,
  EnrollStudentsDto,
  UpdateCourseDto,
  UpsertChapterDto,
} from './dto/course.dto';
import { buildSlugBase } from './slug.util';
import { buildConflictError } from '../common/content-conflict';
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
    /** 授课教师名单（多教师协作）：可编辑这门课的人以它为准，见设计文档 §2 */
    @InjectRepository(CourseTeacher)
    private readonly courseTeacherRepo: Repository<CourseTeacher>,
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
    const saved = await this.courseRepo.save(course);
    // 建课人自动进授课教师名单（多教师协作下「谁能编辑」以名单为准，见设计文档 §2）
    await this.addCourseTeacher(saved.id, teacher.id);
    return saved;
  }

  /** 管理员看全部课程，教师看**自己参与授课**的课（主教师或协作教师），学生看自己被选入的课 */
  async listCourses(user: User) {
    const relations = ['teacher'];
    let courses: Course[];
    if (user.role === UserRole.ADMIN) {
      courses = await this.courseRepo.find({
        relations,
        order: { createdAt: 'DESC' },
      });
    } else if (user.role === UserRole.TEACHER) {
      // 多教师协作：以名单表为准（主教师也在名单里）→ 这里天然是「我参与的全部课程」
      const links = await this.courseTeacherRepo.find({
        where: { userId: user.id },
      });
      if (links.length === 0) {
        return [];
      }
      courses = await this.courseRepo.find({
        where: { id: In(links.map((link) => link.courseId)) },
        relations,
        order: { createdAt: 'DESC' },
      });
    } else {
      const enrollments = await this.enrollmentRepo.find({
        where: { studentId: user.id },
      });
      if (enrollments.length === 0) {
        return [];
      }
      courses = await this.courseRepo.find({
        where: { id: In(enrollments.map((e) => e.courseId)) },
        relations,
        order: { createdAt: 'DESC' },
      });
    }
    // 只暴露教师显示名；teacher 实体本身（含 passwordHash）不能随响应出去
    const namesByCourse = await this.buildTeacherNames(courses);
    return courses.map(({ teacher, ...course }) => ({
      ...course,
      teacherName: teacher?.nickname || teacher?.username || '',
      /** 多教师：主教师在前（见设计文档 §4） */
      teacherNames: namesByCourse.get(course.id) ?? [],
    }));
  }

  /**
   * 课程 → 授课教师显示名（**主教师排在最前**）。多教师展示的统一口径。
   * 名单表里没有主教师时（迁移前的历史数据）用 `courses.teacherId` 兜底。
   */
  async buildTeacherNames(courses: Course[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const courseIds = courses.map((course) => course.id);
    if (!courseIds.length) return result;
    const links = await this.courseTeacherRepo.find({
      where: { courseId: In(courseIds) },
    });
    const userIds = [...new Set(links.map((link) => link.userId))];
    const users = userIds.length
      ? await this.userRepo.find({ where: { id: In(userIds) } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.nickname || u.username]));
    for (const course of courses) {
      const members = links
        .filter((link) => link.courseId === course.id)
        .map((link) => link.userId);
      const ordered = [
        course.teacherId,
        ...members.filter((id) => id !== course.teacherId),
      ];
      result.set(
        course.id,
        ordered.map((id) => nameOf.get(id) ?? '').filter(Boolean),
      );
    }
    return result;
  }

  async getCourse(user: User, courseId: string) {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (user.role === UserRole.TEACHER || user.role === UserRole.ADMIN) {
      // 多教师：主教师或**协作教师**都能看（含草稿章节）；course 已加载，直接判名单即可
      if (
        user.role !== UserRole.ADMIN &&
        !(await this.isTeacherOfCourse(course, user.id))
      ) {
        throw new ForbiddenException('只有本课程的授课教师可以查看');
      }
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
    const teacherNames = (await this.buildTeacherNames([course])).get(course.id) ?? [];
    if (chapters.length === 0) {
      return { ...course, ...enrollmentState, teacherNames, chapters };
    }
    // 章节下挂的实验项目一并返回（课程详情页大纲用）
    const projects = await this.projectRepo.find({
      where: { chapterId: In(chapters.map((c) => c.id).concat([''])) },
      order: { createdAt: 'ASC' },
    });
    return {
      ...course,
      ...enrollmentState,
      teacherNames,
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
    if (dto.teacherId !== undefined && dto.teacherId !== course.teacherId) {
      // 转让 = 换**主教师**：主教师本人或管理员（原先只允许管理员，见设计文档 §3）
      if (user.role !== UserRole.ADMIN && course.teacherId !== user.id) {
        throw new ForbiddenException('只有主教师或管理员可以转让课程');
      }
      const target = await this.userRepo.findOne({
        where: { id: dto.teacherId },
      });
      if (
        !target ||
        (target.role !== UserRole.TEACHER && target.role !== UserRole.ADMIN)
      ) {
        throw new BadRequestException('目标用户不存在或不是教师');
      }
      // 新主教师进名单；**原主教师保留为协作教师**（转让不该夺走他的编辑权）
      await this.addCourseTeacher(course.id, dto.teacherId);
      course.teacherId = dto.teacherId;
    }
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
    // 删课是矩阵里保留给「主教师 + 管理员」的操作（协作教师不能删课，见设计文档 §3）
    const course = await this.assertPrimaryTeacher(user, courseId);
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
      // 乐观锁：客户端持有的版本与库中不一致 = 期间有人保存过 → 409，别静默覆盖
      if (dto.version !== undefined && dto.version !== chapter.version) {
        await this.throwContentConflict(chapter);
      }
      Object.assign(chapter, {
        title: dto.title,
        order: dto.order ?? chapter.order,
        content: dto.content ?? chapter.content,
        exampleSkills: dto.exampleSkills ?? chapter.exampleSkills,
        status: dto.status ?? chapter.status,
        updatedBy: user.id,
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
    // 多教师：主教师或协作教师都能看到全部章节（含草稿）
    const isOwner =
      user.role === UserRole.ADMIN ||
      (await this.isTeacherOfCourse(course, user.id));
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
      (user.role !== UserRole.ADMIN &&
        !(await this.isTeacherOfCourse(course, user.id)))
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
    const namesByCourse = await this.buildTeacherNames(courses);
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
        /** 多教师：主教师在前（学生端「我的课程」展示用） */
        teacherNames: namesByCourse.get(course.id) ?? [],
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

  // ---------- 授课教师（多教师协作，见 docs/DESIGN-2026-10-11-course-co-teachers.md） ----------

  /**
   * 该用户是否算这门课的**授课教师**（主教师或协作教师，不含管理员的直通判定）。
   * 权限判定只留这一处实现，其它模块不要自己比 `courses.teacherId`。
   */
  async isTeacherOfCourse(course: Course, userId: string): Promise<boolean> {
    if (course.teacherId === userId) return true;
    const link = await this.courseTeacherRepo.findOne({
      where: { courseId: course.id, userId },
    });
    return !!link;
  }

  /** 任意授课教师（含协作教师）或管理员；否则 403。返回课程，便于调用方继续用。 */
  async assertTeacherOfCourse(user: User, courseId: string): Promise<Course> {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (user.role === UserRole.ADMIN) return course;
    if (await this.isTeacherOfCourse(course, user.id)) return course;
    throw new ForbiddenException('只有本课程的授课教师可以执行该操作');
  }

  /** 仅**主教师**或管理员：删除课程、转让主教师、改协作者名单（见设计文档 §3 权限矩阵）。 */
  async assertPrimaryTeacher(user: User, courseId: string): Promise<Course> {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (user.role === UserRole.ADMIN) return course;
    if (course.teacherId !== user.id) {
      throw new ForbiddenException('只有主教师或管理员可以执行该操作');
    }
    return course;
  }

  /**
   * @deprecated 名字是历史遗留（原意「课程归属者」）。语义已改为**任意授课教师或管理员**，
   * 因此编辑章节 / 幻灯片 / 批改 / 审批等 19 处调用点自动支持协作教师。
   * 需要「仅主教师」的场合请显式用 `assertPrimaryTeacher`。
   */
  async getOwnedCourse(user: User, courseId: string): Promise<Course> {
    return this.assertTeacherOfCourse(user, courseId);
  }

  /** 把某教师加入课程名单（幂等：已在名单里就不动，靠 `uq_course_teacher` 兜底并发） */
  private async addCourseTeacher(courseId: string, userId: string): Promise<void> {
    const exists = await this.courseTeacherRepo.findOne({
      where: { courseId, userId },
    });
    if (!exists) {
      await this.courseTeacherRepo.save(
        this.courseTeacherRepo.create({ courseId, userId }),
      );
    }
  }

  /** 授课教师名单：`owner` 标记主教师。课程任一教师可读（前端要展示），管理员可读。 */
  async listCourseTeachers(user: User, courseId: string) {
    const course = await this.assertTeacherOfCourse(user, courseId);
    const links = await this.courseTeacherRepo.find({ where: { courseId } });
    const userIds = [...new Set([course.teacherId, ...links.map((l) => l.userId)])];
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      ownerId: course.teacherId,
      teachers: userIds.map((id) => ({
        id,
        nickname: byId.get(id)?.nickname ?? '',
        username: byId.get(id)?.username ?? '',
        role: id === course.teacherId ? ('owner' as const) : ('co_teacher' as const),
      })),
    };
  }

  /**
   * 全量设置**协作教师**名单（主教师由「转让」改，这里自动剔除，保证主教师始终在名单里）。
   * 仅主教师或管理员。
   */
  async setCourseTeachers(user: User, courseId: string, userIds: string[]) {
    const course = await this.assertPrimaryTeacher(user, courseId);
    const wanted = [...new Set(userIds)];
    const targets = wanted.length
      ? await this.userRepo.find({ where: { id: In(wanted) } })
      : [];
    const invalid = wanted.filter(
      (id) =>
        !targets.some(
          (t) =>
            t.id === id &&
            (t.role === UserRole.TEACHER || t.role === UserRole.ADMIN),
        ),
    );
    if (invalid.length) {
      throw new BadRequestException('名单里有用户不存在或不是教师');
    }
    await this.courseTeacherRepo.delete({ courseId });
    // 主教师始终在名单里；其余按传入选人（顺序无关，靠 UNIQUE 索引兜底）
    await this.courseTeacherRepo.save(
      [...new Set([course.teacherId, ...wanted])].map((id) =>
        this.courseTeacherRepo.create({ courseId, userId: id }),
      ),
    );
    return this.listCourseTeachers(user, courseId);
  }

  /**
   * 章节保存撞上并发编辑：抛 409（带当前版本与最后修改者）。
   * 走统一的 `buildConflictError`，与幻灯片保存的错误结构保持一致。
   */
  private async throwContentConflict(chapter: Chapter): Promise<never> {
    const editor = chapter.updatedBy
      ? await this.userRepo.findOne({ where: { id: chapter.updatedBy } })
      : null;
    throw buildConflictError(chapter.version, editor);
  }

  /** 某教师**参与授课**的课程 id 列表（含协作课程）—— 工作台/实验项目列表按「我参与的课」过滤用 */
  async listCourseIdsForTeacher(userId: string): Promise<string[]> {
    const links = await this.courseTeacherRepo.find({ where: { userId } });
    return links.map((link) => link.courseId);
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
