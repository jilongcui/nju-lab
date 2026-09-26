import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Like, Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import { Chapter, ChapterStatus, Course, CourseStatus } from './course.entity';
import { Enrollment } from './enrollment.entity';
import {
  ApplicationStatus,
  CourseApplication,
} from './course-application.entity';
import {
  Assignment,
  ExperimentProject,
  ProjectStatus,
} from '../projects/project.entity';
import {
  ApplicationState,
  resolveApplicationState,
  seatsLeft,
} from './application-state.util';

export type { ApplicationState };

export interface CatalogCourseQuery {
  keyword?: string;
  term?: string;
}

/**
 * 课程目录（选课用）+ 申请审批（见 docs/DESIGN-course-application-2026-09-24.md）。
 *
 * 与 CoursesService 的分工：CoursesService 管课程自身的增删改（含章节、名单），
 * 本服务管「对外可见性 + 报名审批」。两者都不碰对方的语义。
 *
 * 注意：课程目录/详情接口是**需登录**的（平台内容登录后可见，2026-09-24 决策）。
 */
@Injectable()
export class CourseApplicationsService {
  constructor(
    @InjectRepository(Course)
    private readonly courseRepo: Repository<Course>,
    @InjectRepository(Chapter)
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(CourseApplication)
    private readonly applicationRepo: Repository<CourseApplication>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- 课程目录与详情（需登录） ----------

  /** GET /api/browse/courses —— 已发布课程目录 + 检索 */
  async listCatalogCourses(query: CatalogCourseQuery) {
    const where: Record<string, unknown>[] = [];
    const base = { status: CourseStatus.PUBLISHED };
    if (query.keyword) {
      const kw = Like(`%${query.keyword}%`);
      where.push({ ...base, title: kw }, { ...base, description: kw });
    } else {
      where.push(base);
    }
    if (query.term) {
      where.forEach((w) => {
        w.term = Like(`%${query.term}%`);
      });
    }

    const courses = await this.courseRepo.find({
      where,
      relations: ['teacher'],
      order: { createdAt: 'DESC' },
    });
    if (courses.length === 0) {
      return [];
    }

    const approvedCounts = await this.countApprovedByCourse(
      courses.map((c) => c.id),
    );
    const chapterCounts = await this.chapterRepo
      .createQueryBuilder('ch')
      .select('ch.courseId', 'courseId')
      .addSelect('COUNT(*)', 'cnt')
      .where('ch.courseId IN (:...ids)', { ids: courses.map((c) => c.id) })
      .andWhere('ch.status = :st', { st: ChapterStatus.PUBLISHED })
      .groupBy('ch.courseId')
      .getRawMany<{ courseId: string; cnt: string }>();
    const chapterMap = new Map(
      chapterCounts.map((r) => [r.courseId, Number(r.cnt)]),
    );

    const now = new Date();
    return courses.map((course) => {
      const approvedCount = approvedCounts.get(course.id) ?? 0;
      return {
        id: course.id,
        slug: course.slug,
        title: course.title,
        term: course.term,
        description: course.description,
        teacherName: course.teacher?.nickname || course.teacher?.username || '',
        chapterCount: chapterMap.get(course.id) ?? 0,
        capacity: course.capacity,
        approvedCount,
        seatsLeft: seatsLeft(course.capacity, approvedCount),
        applicationOpenAt: course.applicationOpenAt,
        applicationCloseAt: course.applicationCloseAt,
        applicationState: resolveApplicationState(course, approvedCount, now),
      };
    });
  }

  /**
   * GET /api/browse/courses/:slug —— 课程详情（需登录）。
   * 章节只给标题（大纲），教学内容需入册后在私域区看。
   */
  async getCatalogCourse(user: User, slug: string) {
    const course = await this.courseRepo.findOne({
      where: { slug },
      relations: ['teacher'],
    });
    if (!course || course.status !== CourseStatus.PUBLISHED) {
      throw new NotFoundException('课程不存在或未公开');
    }

    const chapters = await this.chapterRepo.find({
      where: { courseId: course.id, status: ChapterStatus.PUBLISHED },
      order: { order: 'ASC' },
    });
    const approvedCount = await this.enrollmentRepo.count({
      where: { courseId: course.id },
    });

    let myApplication: {
      id: string;
      status: ApplicationStatus;
      createdAt: Date;
      decidedAt: Date | null;
      decisionNote: string | null;
    } | null = null;
    const mine = await this.applicationRepo.findOne({
      where: { courseId: course.id, studentId: user.id },
      order: { createdAt: 'DESC' },
    });
    if (mine) {
      myApplication = {
        id: mine.id,
        status: mine.status,
        createdAt: mine.createdAt,
        decidedAt: mine.decidedAt,
        decisionNote: mine.decisionNote,
      };
    }
    const myEnrollment = !!(await this.enrollmentRepo.findOne({
      where: { courseId: course.id, studentId: user.id },
    }));

    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      term: course.term,
      description: course.description,
      teacherName: course.teacher?.nickname || course.teacher?.username || '',
      capacity: course.capacity,
      approvedCount,
      seatsLeft: seatsLeft(course.capacity, approvedCount),
      applicationOpenAt: course.applicationOpenAt,
      applicationCloseAt: course.applicationCloseAt,
      applicationState: resolveApplicationState(course, approvedCount),
      chapters: chapters.map((c) => ({
        id: c.id,
        order: c.order,
        title: c.title,
      })),
      myApplication,
      myEnrollment,
    };
  }

  // ---------- 学生：申请 ----------

  /** POST /api/courses/:courseId/applications */
  async apply(student: User, courseId: string) {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const enrolled = await this.enrollmentRepo.findOne({
      where: { courseId, studentId: student.id },
    });
    if (enrolled) {
      throw new BadRequestException('你已是该课程的学生');
    }
    const approvedCount = await this.enrollmentRepo.count({
      where: { courseId },
    });
    this.assertApplicable(
      resolveApplicationState(course, approvedCount),
      course,
    );

    try {
      return await this.applicationRepo.save(
        this.applicationRepo.create({
          courseId,
          studentId: student.id,
          status: ApplicationStatus.PENDING,
        }),
      );
    } catch (e) {
      // 唯一索引 uq_course_application_pending 兜底：同一课程同一学生只允许一条 pending
      if (this.isDuplicateKey(e)) {
        throw new BadRequestException('你已提交过申请，请等待教师审批');
      }
      throw e;
    }
  }

  /** DELETE /api/courses/:courseId/applications/:id —— 学生撤销自己的待审批申请 */
  async withdraw(student: User, courseId: string, applicationId: string) {
    const application = await this.applicationRepo.findOne({
      where: { id: applicationId, courseId, studentId: student.id },
    });
    if (!application) {
      throw new NotFoundException('申请不存在');
    }
    if (application.status !== ApplicationStatus.PENDING) {
      throw new BadRequestException('只能撤销待审批的申请');
    }
    await this.applicationRepo.remove(application);
    return { deleted: true, id: applicationId };
  }

  /** GET /api/me/applications —— 我的申请列表 */
  async listMyApplications(student: User) {
    const applications = await this.applicationRepo.find({
      where: { studentId: student.id },
      relations: ['course'],
      order: { createdAt: 'DESC' },
    });
    if (applications.length === 0) {
      return [];
    }
    const approvedCounts = await this.countApprovedByCourse(
      applications.map((a) => a.courseId),
    );
    const enrolledCourseIds = new Set(
      (
        await this.enrollmentRepo.find({
          where: {
            studentId: student.id,
            courseId: In(applications.map((a) => a.courseId)),
          },
        })
      ).map((e) => e.courseId),
    );
    const now = new Date();
    return applications.map((a) => {
      const approvedCount = approvedCounts.get(a.courseId) ?? 0;
      return {
        id: a.id,
        status: a.status,
        createdAt: a.createdAt,
        decidedAt: a.decidedAt,
        decisionNote: a.decisionNote,
        course: a.course
          ? {
              id: a.course.id,
              slug: a.course.slug,
              title: a.course.title,
              term: a.course.term,
            }
          : null,
        applicationState: a.course
          ? resolveApplicationState(a.course, approvedCount, now)
          : 'not_published',
        enrolled: enrolledCourseIds.has(a.courseId),
      };
    });
  }

  // ---------- 教师：审批 ----------

  /** GET /api/courses/:courseId/applications —— 申请列表（按申请时间升序＝先到先得） */
  async listApplications(user: User, courseId: string) {
    const course = await this.getOwnedCourse(user, courseId);
    const applications = await this.applicationRepo.find({
      where: { courseId },
      relations: ['student'],
      order: { createdAt: 'ASC' },
    });
    const approvedCount = await this.enrollmentRepo.count({
      where: { courseId },
    });
    return {
      courseId,
      capacity: course.capacity,
      approvedCount,
      seatsLeft: seatsLeft(course.capacity, approvedCount),
      applicationState: resolveApplicationState(course, approvedCount),
      pendingCount: applications.filter(
        (a) => a.status === ApplicationStatus.PENDING,
      ).length,
      applications: applications.map((a) => ({
        id: a.id,
        studentId: a.studentId,
        username: a.student?.username ?? '',
        nickname: a.student?.nickname ?? '',
        status: a.status,
        createdAt: a.createdAt,
        decidedAt: a.decidedAt,
        decidedBy: a.decidedBy,
        decisionNote: a.decisionNote,
      })),
    };
  }

  /**
   * POST /api/courses/:courseId/applications/:id/approve
   *
   * 批准 = 建 Enrollment（成为正式学员）+ 补发该课程全部已发布项目的 Assignment。
   * 全程在事务里，并锁课程行——逐个批准时两个标签页同时批最后两个名额也不会超额。
   */
  async approve(user: User, courseId: string, applicationId: string) {
    await this.assertCourseOwner(user, courseId);
    return this.dataSource.transaction(async (manager) => {
      // 锁课程行，串行化「容量校验 + 建入册」这一段
      const course = await manager.findOne(Course, {
        where: { id: courseId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!course) {
        throw new NotFoundException('课程不存在');
      }
      const application = await manager.findOne(CourseApplication, {
        where: { id: applicationId, courseId },
      });
      if (!application) {
        throw new NotFoundException('申请不存在');
      }
      if (application.status !== ApplicationStatus.PENDING) {
        throw new BadRequestException('该申请已处理');
      }

      // 容量口径：已批准数（= enrollments 行数）
      const approvedCount = await manager.count(Enrollment, {
        where: { courseId },
      });
      if (course.capacity != null && approvedCount >= course.capacity) {
        throw new BadRequestException('名额已满，无法再批准');
      }

      const exists = await manager.findOne(Enrollment, {
        where: { courseId, studentId: application.studentId },
      });
      if (!exists) {
        await manager.save(
          manager.create(Enrollment, {
            courseId,
            studentId: application.studentId,
          }),
        );
      }

      application.status = ApplicationStatus.APPROVED;
      application.decidedBy = user.id;
      application.decidedAt = new Date();
      await manager.save(application);

      // 补发任务：项目发布时只发给「当时在册」的学生，后来入册的必须补
      const assignmentsCreated = await this.backfillAssignments(
        manager,
        courseId,
        application.studentId,
      );

      return { ...application, assignmentsCreated };
    });
  }

  /** POST /api/courses/:courseId/applications/:id/reject */
  async reject(
    user: User,
    courseId: string,
    applicationId: string,
    note?: string,
  ) {
    await this.assertCourseOwner(user, courseId);
    const application = await this.applicationRepo.findOne({
      where: { id: applicationId, courseId },
    });
    if (!application) {
      throw new NotFoundException('申请不存在');
    }
    if (application.status !== ApplicationStatus.PENDING) {
      throw new BadRequestException('该申请已处理');
    }
    application.status = ApplicationStatus.REJECTED;
    application.decisionNote = note ?? null;
    application.decidedBy = user.id;
    application.decidedAt = new Date();
    return this.applicationRepo.save(application);
  }

  // ---------- 内部工具 ----------

  /**
   * 为指定学生补发本课程「全部已发布项目」的任务。
   *
   * 刻意不用 ProjectsService.publishProject()：
   *  - 它开头会把 project.status 改回 PUBLISHED（对已发布项目等于重新发布）
   *  - 它不校验当前是否为 draft，误传草稿项目会把它直接发布出去
   *  - ProjectStatus.CLOSED 目前从未被设置（纯预留），一旦将来启用「截止后关闭项目」，
   *    那里的检查会让补发直接抛错
   */
  private async backfillAssignments(
    manager: EntityManager,
    courseId: string,
    studentId: string,
  ): Promise<number> {
    const projects = await manager.find(ExperimentProject, {
      where: { courseId, status: ProjectStatus.PUBLISHED },
    });
    let created = 0;
    for (const project of projects) {
      const exists = await manager.findOne(Assignment, {
        where: { projectId: project.id, studentId },
      });
      if (!exists) {
        await manager.save(
          manager.create(Assignment, { projectId: project.id, studentId }),
        );
        created += 1;
      }
    }
    return created;
  }

  private assertApplicable(state: ApplicationState, course: Course) {
    if (state === 'open') {
      return;
    }
    if (state === 'not_open_yet' && course.applicationOpenAt) {
      throw new BadRequestException(
        `申请将于 ${course.applicationOpenAt.toLocaleString('zh-CN')} 开放`,
      );
    }
    const messages: Record<Exclude<ApplicationState, 'open'>, string> = {
      not_published: '课程未公开，无法申请',
      not_open_yet: '申请尚未开放',
      full: '名额已满',
      closed: '申请未开放或已截止',
    };
    throw new BadRequestException(messages[state]);
  }

  private async countApprovedByCourse(
    courseIds: string[],
  ): Promise<Map<string, number>> {
    if (courseIds.length === 0) {
      return new Map();
    }
    const rows = await this.enrollmentRepo
      .createQueryBuilder('e')
      .select('e.courseId', 'courseId')
      .addSelect('COUNT(*)', 'cnt')
      .where('e.courseId IN (:...ids)', { ids: courseIds })
      .groupBy('e.courseId')
      .getRawMany<{ courseId: string; cnt: string }>();
    return new Map(rows.map((r) => [r.courseId, Number(r.cnt)]));
  }

  private isDuplicateKey(e: unknown): boolean {
    const err = e as { code?: string; message?: string };
    return (
      err?.code === 'ER_DUP_ENTRY' ||
      (typeof err?.message === 'string' &&
        err.message.includes('Duplicate entry'))
    );
  }

  private async getOwnedCourse(user: User, courseId: string): Promise<Course> {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    this.assertOwner(course, user);
    return course;
  }

  private async assertCourseOwner(user: User, courseId: string): Promise<void> {
    await this.getOwnedCourse(user, courseId);
  }

  private assertOwner(course: Course, user: User) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
    if (course.teacherId !== user.id) {
      throw new ForbiddenException('只有课程所属教师可以执行该操作');
    }
  }
}
