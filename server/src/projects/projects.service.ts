import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Chapter, ChapterStatus, Course } from '../courses/course.entity';
import {
  ChapterProgress,
  Enrollment,
  ProgressStatus,
} from '../courses/enrollment.entity';
import { FilesService } from '../files/files.service';
import { Submission } from '../submissions/submission.entity';
import { User, UserRole } from '../users/user.entity';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import {
  Assignment,
  AssignmentStatus,
  ExperimentProject,
  ProjectStatus,
  UnlockRule,
} from './project.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ExperimentProject)
    private readonly projectRepo: Repository<ExperimentProject>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Course)
    private readonly courseRepo: Repository<Course>,
    @InjectRepository(Chapter)
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(ChapterProgress)
    private readonly progressRepo: Repository<ChapterProgress>,
    @InjectRepository(Submission)
    private readonly submissionRepo: Repository<Submission>,
    private readonly filesService: FilesService,
  ) {}

  // ---------- 项目 CRUD（教师） ----------

  /** GET /api/projects —— 当前教师全部实验项目（admin 见全部），附课程/章节与提交进度 */
  async listProjects(user: User) {
    const qb = this.projectRepo
      .createQueryBuilder('project')
      .leftJoinAndSelect('project.course', 'course')
      .leftJoinAndSelect('project.chapter', 'chapter')
      .orderBy('project.createdAt', 'DESC');
    if (user.role !== UserRole.ADMIN) {
      qb.where('course.teacherId = :teacherId', { teacherId: user.id });
    }
    const projects = await qb.getMany();
    const result = [];
    for (const project of projects) {
      const assignmentCount = await this.assignmentRepo.count({
        where: { projectId: project.id },
      });
      const submittedCount = await this.assignmentRepo.count({
        where: { projectId: project.id, status: AssignmentStatus.SUBMITTED },
      });
      result.push({
        id: project.id,
        title: project.title,
        status: project.status,
        deadline: project.deadline,
        createdAt: project.createdAt,
        courseId: project.courseId,
        courseTitle: project.course?.title ?? null,
        chapterId: project.chapterId,
        chapterTitle: project.chapter?.title ?? null,
        assignmentCount,
        submittedCount,
      });
    }
    return result;
  }

  async createProject(teacher: User, dto: CreateProjectDto) {
    const chapter = await this.chapterRepo.findOne({
      where: { id: dto.chapterId },
    });
    if (!chapter) {
      throw new NotFoundException('章节不存在');
    }
    await this.assertCourseOwner(teacher, chapter.courseId);
    await this.assertFileExists(dto.skillTemplateFileId, 'Skill 模板');
    await this.assertFileExists(dto.testDatasetFileId, '测试数据集');
    const project = this.projectRepo.create({
      courseId: chapter.courseId,
      chapterId: chapter.id,
      title: dto.title,
      objectives: dto.objectives ?? null,
      background: dto.background ?? null,
      description: dto.description ?? null,
      skillTemplateFileId: dto.skillTemplateFileId ?? null,
      testDatasetFileId: dto.testDatasetFileId ?? null,
      evalConfig: dto.evalConfig ?? null,
      rubric: dto.rubric ?? null,
      references: dto.references ?? null,
      faq: dto.faq ?? null,
      unlockRule: dto.unlockRule ?? null,
      deadline: dto.deadline ? new Date(dto.deadline) : null,
    });
    return this.projectRepo.save(project);
  }

  async getProject(user: User, projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('实验项目不存在');
    }
    if (user.role === UserRole.TEACHER || user.role === UserRole.ADMIN) {
      await this.assertCourseOwner(user, project.courseId);
      return this.withFileInfos(project);
    }
    if (project.status !== ProjectStatus.PUBLISHED) {
      throw new ForbiddenException('实验项目尚未发布');
    }
    await this.assertEnrolled(project.courseId, user.id);
    const unlocked = await this.checkUnlock(user.id, project);
    // 模板与数据集仅对已领取的学生下发（未领取只能看实验说明）
    const assignment = await this.assignmentRepo.findOne({
      where: { projectId, studentId: user.id },
    });
    const claimed =
      !!assignment && assignment.status !== AssignmentStatus.PENDING;
    if (!claimed) {
      return { ...project, unlocked };
    }
    return { ...(await this.withFileInfos(project)), unlocked };
  }

  async updateProject(teacher: User, projectId: string, dto: UpdateProjectDto) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('实验项目不存在');
    }
    await this.assertCourseOwner(teacher, project.courseId);
    const { deadline, ...rest } = dto;
    await this.assertFileExists(rest.skillTemplateFileId, 'Skill 模板');
    await this.assertFileExists(rest.testDatasetFileId, '测试数据集');
    // class-transformer 会把 DTO 未提交的字段补成 undefined，须剔除，
    // 否则部分字段的 PATCH 会把实体其他字段在内存中抹成 undefined（DB 无恙但响应缺字段）
    for (const key of Object.keys(rest) as (keyof typeof rest)[]) {
      if (rest[key] === undefined) {
        delete rest[key];
      }
    }
    Object.assign(project, rest);
    if (deadline !== undefined) {
      project.deadline = new Date(deadline);
    }
    return this.withFileInfos(await this.projectRepo.save(project));
  }

  /** 发布：状态置为 published，并为本课程全部学生生成 Assignment */
  async publishProject(teacher: User, projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('实验项目不存在');
    }
    await this.assertCourseOwner(teacher, project.courseId);
    if (project.status === ProjectStatus.CLOSED) {
      throw new BadRequestException('项目已关闭，不能重新发布');
    }
    project.status = ProjectStatus.PUBLISHED;
    await this.projectRepo.save(project);

    const enrollments = await this.enrollmentRepo.find({
      where: { courseId: project.courseId },
    });
    let created = 0;
    for (const enrollment of enrollments) {
      const exists = await this.assignmentRepo.findOne({
        where: { projectId: project.id, studentId: enrollment.studentId },
      });
      if (!exists) {
        await this.assignmentRepo.save(
          this.assignmentRepo.create({
            projectId: project.id,
            studentId: enrollment.studentId,
          }),
        );
        created += 1;
      }
    }
    return { ...project, assignmentsCreated: created };
  }

  /** GET /api/projects/:id/submissions —— 该项目下全部提交（教师） */
  async listProjectSubmissions(teacher: User, projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('实验项目不存在');
    }
    await this.assertCourseOwner(teacher, project.courseId);
    const assignments = await this.assignmentRepo.find({
      where: { projectId },
      relations: ['student'],
    });
    const submissions = await this.submissionRepo.find({
      where: {
        assignmentId: In(assignments.map((a) => a.id).concat([''])),
      },
      relations: ['student', 'evaluation'],
      order: { submittedAt: 'DESC' },
    });
    const byAssignment = new Map(submissions.map((s) => [s.assignmentId, s]));
    return assignments.map((assignment) => ({
      assignmentId: assignment.id,
      student: {
        id: assignment.student.id,
        username: assignment.student.username,
        nickname: assignment.student.nickname,
      },
      assignmentStatus: assignment.status,
      submission: byAssignment.get(assignment.id) ?? null,
    }));
  }

  /** GET /api/projects/:id/grades.csv —— 成绩导出（BOM + RFC4180 转义，Excel 友好） */
  async exportGradesCsv(teacher: User, projectId: string) {
    const rows = await this.listProjectSubmissions(teacher, projectId);
    const header = [
      '学号', '姓名', '任务状态', '提交时间', '提交状态',
      '复验成功率', 'Token成本', '建议分', '教师评分', '教师评语',
    ];
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.map(escape).join(',')];
    for (const row of rows) {
      const sub = row.submission;
      const evaluation = sub?.evaluation;
      lines.push(
        [
          row.student.username,
          row.student.nickname,
          row.assignmentStatus,
          sub?.submittedAt
            ? new Date(sub.submittedAt).toISOString().slice(0, 16).replace('T', ' ')
            : '',
          sub?.status ?? '',
          evaluation ? evaluation.successRate : '',
          evaluation ? evaluation.tokenCost : '',
          evaluation?.autoScoreSuggestion ?? '',
          evaluation?.teacherScore ?? '',
          evaluation?.teacherComment ?? '',
        ]
          .map(escape)
          .join(','),
      );
    }
    // BOM 让 Excel 按 UTF-8 打开
    return new StreamableFile(Buffer.from('﻿' + lines.join('\r\n'), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="grades-${projectId}.csv"`,
    });
  }

  // ---------- 学生侧 ----------

  /** GET /api/me/assignments —— 任务列表（含解锁状态） */
  async getMyAssignments(student: User) {
    const assignments = await this.assignmentRepo.find({
      where: { studentId: student.id },
      relations: ['project'],
      order: { createdAt: 'DESC' },
    });
    // 每个任务的最新一条提交，供学生端"查看反馈"直接跳转
    const submissions = assignments.length
      ? await this.submissionRepo.find({
          where: { assignmentId: In(assignments.map((a) => a.id).concat([''])) },
          order: { submittedAt: 'DESC' },
        })
      : [];
    const latestByAssignment = new Map<string, Submission>();
    for (const s of submissions) {
      if (!latestByAssignment.has(s.assignmentId)) {
        latestByAssignment.set(s.assignmentId, s);
      }
    }
    const result = [];
    for (const assignment of assignments) {
      const project = assignment.project;
      if (!project || project.status !== ProjectStatus.PUBLISHED) {
        continue;
      }
      const chapter = await this.chapterRepo.findOne({
        where: { id: project.chapterId },
      });
      const unlocked = await this.checkUnlock(student.id, project);
      const submission = latestByAssignment.get(assignment.id);
      result.push({
        id: assignment.id,
        status: assignment.status,
        claimedAt: assignment.claimedAt,
        unlocked,
        project: {
          id: project.id,
          title: project.title,
          deadline: project.deadline,
          chapterTitle: chapter?.title ?? null,
        },
        submission: submission
          ? {
              id: submission.id,
              status: submission.status,
              submittedAt: submission.submittedAt,
            }
          : null,
      });
    }
    return result;
  }

  /** POST /api/assignments/:id/claim —— 校验 unlockRule 后开放领取 */
  async claimAssignment(student: User, assignmentId: string) {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['project'],
    });
    if (!assignment || assignment.studentId !== student.id) {
      throw new NotFoundException('任务不存在');
    }
    const project = assignment.project;
    if (project.status !== ProjectStatus.PUBLISHED) {
      throw new BadRequestException('实验项目未发布或已关闭');
    }
    if (assignment.status === AssignmentStatus.SUBMITTED) {
      throw new BadRequestException('该任务已提交，无需重复领取');
    }
    if (assignment.status === AssignmentStatus.PENDING) {
      const unlocked = await this.checkUnlock(student.id, project);
      if (!unlocked) {
        throw new ForbiddenException(
          '尚未满足解锁条件：请先完成该实验所属章节之前的全部已发布章节',
        );
      }
      assignment.status = AssignmentStatus.CLAIMED;
      assignment.claimedAt = new Date();
      await this.assignmentRepo.save(assignment);
    }
    // 领取成功后下发模板、测试数据集（真实下载地址 + 服务端 sha256）与评估条件
    return {
      assignment,
      skillTemplate: await this.filesService.infoOrNull(
        project.skillTemplateFileId,
      ),
      testDataset: await this.filesService.infoOrNull(
        project.testDatasetFileId,
      ),
      evalConfig: project.evalConfig,
    };
  }

  // ---------- 解锁规则 ----------

  /**
   * 判定学生是否可领取项目：
   * - type=none：无前置条件
   * - type=chapters：需完成指定章节
   * - 默认：完成该实验所属章节之前的全部已发布章节
   */
  async checkUnlock(
    studentId: string,
    project: ExperimentProject,
  ): Promise<boolean> {
    const rule: UnlockRule = project.unlockRule ?? { type: 'default' };
    if (rule.type === 'none') {
      return true;
    }

    let requiredChapterIds: string[];
    if (rule.type === 'chapters' && rule.chapterIds?.length) {
      requiredChapterIds = rule.chapterIds;
    } else {
      const ownChapter = await this.chapterRepo.findOne({
        where: { id: project.chapterId },
      });
      if (!ownChapter) {
        return false;
      }
      const previousChapters = await this.chapterRepo
        .createQueryBuilder('chapter')
        .where('chapter.courseId = :courseId', { courseId: project.courseId })
        .andWhere('chapter.status = :status', {
          status: ChapterStatus.PUBLISHED,
        })
        .andWhere('chapter.order < :order', { order: ownChapter.order })
        .getMany();
      requiredChapterIds = previousChapters.map((c) => c.id);
    }

    if (requiredChapterIds.length === 0) {
      return true;
    }
    const completed = await this.progressRepo.count({
      where: {
        studentId,
        chapterId: In(requiredChapterIds),
        status: ProgressStatus.COMPLETED,
      },
    });
    return completed === requiredChapterIds.length;
  }

  /** 删除实验项目（级联删除 Assignment 与提交，FK 已配置 CASCADE） */
  async removeProject(user: User, projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('实验项目不存在');
    }
    await this.assertCourseOwner(user, project.courseId);
    await this.projectRepo.remove(project);
    return { deleted: true, id: projectId };
  }

  // ---------- 内部工具 ----------

  /** 项目详情附带模板/数据集文件信息（下载地址 + sha256） */
  private async withFileInfos(project: ExperimentProject) {
    return {
      ...project,
      skillTemplate: await this.filesService.infoOrNull(
        project.skillTemplateFileId,
      ),
      testDataset: await this.filesService.infoOrNull(
        project.testDatasetFileId,
      ),
    };
  }

  private async assertFileExists(
    fileId: string | null | undefined,
    label: string,
  ) {
    if (fileId == null) {
      return;
    }
    await this.filesService.getFile(fileId).catch(() => {
      throw new BadRequestException(`${label}文件不存在（fileId: ${fileId}）`);
    });
  }

  private async assertCourseOwner(user: User, courseId: string) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
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
