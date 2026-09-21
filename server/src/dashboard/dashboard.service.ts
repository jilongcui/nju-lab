import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Course } from '../courses/course.entity';
import { Enrollment } from '../courses/enrollment.entity';
import {
  Assignment,
  AssignmentStatus,
  ExperimentProject,
} from '../projects/project.entity';
import { ProjectsService } from '../projects/projects.service';
import {
  Evaluation,
  Submission,
  SubmissionStatus,
} from '../submissions/submission.entity';
import { User, UserRole } from '../users/user.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(ExperimentProject)
    private readonly projectRepo: Repository<ExperimentProject>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Submission)
    private readonly submissionRepo: Repository<Submission>,
    @InjectRepository(Evaluation)
    private readonly evaluationRepo: Repository<Evaluation>,
    @InjectRepository(Course)
    private readonly courseRepo: Repository<Course>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly projectsService: ProjectsService,
  ) {}

  /** GET /api/dashboard/teacher-summary —— 课程数、学生总数、待批改提交 */
  async getTeacherSummary(user: User) {
    const courses =
      user.role === UserRole.ADMIN
        ? await this.courseRepo.find()
        : await this.courseRepo.find({ where: { teacherId: user.id } });
    const courseIds = courses.map((c) => c.id);
    if (courseIds.length === 0) {
      return {
        courseCount: 0,
        studentCount: 0,
        pendingGradingCount: 0,
        pendingGrading: [],
      };
    }
    const enrollments = await this.enrollmentRepo.find({
      where: { courseId: In(courseIds) },
    });
    const studentCount = new Set(enrollments.map((e) => e.studentId)).size;

    const projects = await this.projectRepo.find({
      where: { courseId: In(courseIds) },
    });
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const assignments = projects.length
      ? await this.assignmentRepo.find({
          where: { projectId: In(projects.map((p) => p.id)) },
        })
      : [];
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));
    const submissions = assignments.length
      ? await this.submissionRepo.find({
          where: { assignmentId: In(assignments.map((a) => a.id).concat([''])) },
          order: { submittedAt: 'DESC' },
        })
      : [];

    // 待批改 = 已提交但未评分（submitted/verifying/verified）
    const pendingStatuses: SubmissionStatus[] = [
      SubmissionStatus.SUBMITTED,
      SubmissionStatus.VERIFYING,
      SubmissionStatus.VERIFIED,
    ];
    const pending = submissions.filter((s) =>
      pendingStatuses.includes(s.status),
    );
    const students = pending.length
      ? await this.userRepo.find({
          where: { id: In(pending.map((s) => s.studentId).concat([''])) },
        })
      : [];
    const studentById = new Map(students.map((u) => [u.id, u]));

    return {
      courseCount: courses.length,
      studentCount,
      pendingGradingCount: pending.length,
      pendingGrading: pending.slice(0, 10).map((s) => {
        const assignment = assignmentById.get(s.assignmentId);
        const project = assignment ? projectById.get(assignment.projectId) : null;
        const student = studentById.get(s.studentId);
        return {
          submissionId: s.id,
          status: s.status,
          submittedAt: s.submittedAt,
          projectId: project?.id ?? null,
          projectTitle: project?.title ?? '',
          courseId: project?.courseId ?? null,
          studentUsername: student?.username ?? '',
          studentNickname: student?.nickname ?? '',
        };
      }),
    };
  }

  /** GET /api/projects/:id/dashboard —— 提交进度、成功率分布、token 成本分布 */
  async getProjectDashboard(teacher: User, projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('实验项目不存在');
    }
    // 复用 ProjectsService 的 owner 校验（getProject 教师侧会做校验）
    await this.projectsService.getProject(teacher, projectId);

    const assignments = await this.assignmentRepo.find({
      where: { projectId },
    });
    const assignmentIds = assignments.map((a) => a.id);
    const submissions = assignmentIds.length
      ? await this.submissionRepo.find({
          where: { assignmentId: In(assignmentIds) },
        })
      : [];
    const evaluations = submissions.length
      ? await this.evaluationRepo.find({
          where: { submissionId: In(submissions.map((s) => s.id)) },
        })
      : [];

    const countBy = <T extends string>(items: T[]) =>
      items.reduce<Record<string, number>>((acc, item) => {
        acc[item] = (acc[item] ?? 0) + 1;
        return acc;
      }, {});

    const successRates = evaluations.map((e) => e.successRate);
    const tokenCosts = evaluations.map((e) => e.tokenCost);

    return {
      projectId,
      title: project.title,
      submissionProgress: {
        totalAssignments: assignments.length,
        assignmentStatus: countBy(
          assignments.map((a) => a.status as AssignmentStatus),
        ),
        submissionStatus: countBy(
          submissions.map((s) => s.status as SubmissionStatus),
        ),
        submittedCount: submissions.length,
      },
      successRateDistribution: bucketize(successRates, [0, 0.5, 0.7, 0.9, 1.01], [
        '<50%',
        '50%-70%',
        '70%-90%',
        '>=90%',
      ]),
      tokenCostDistribution: {
        count: tokenCosts.length,
        avg: tokenCosts.length
          ? Math.round(tokenCosts.reduce((a, b) => a + b, 0) / tokenCosts.length)
          : 0,
        min: tokenCosts.length ? Math.min(...tokenCosts) : 0,
        max: tokenCosts.length ? Math.max(...tokenCosts) : 0,
        buckets: bucketize(
          tokenCosts,
          [0, 15000, 30000, 45000, Number.MAX_SAFE_INTEGER],
          ['<15k', '15k-30k', '30k-45k', '>=45k'],
        ),
      },
      evaluatedCount: evaluations.length,
    };
  }
}

function bucketize(
  values: number[],
  edges: number[],
  labels: string[],
): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const label of labels) {
    buckets[label] = 0;
  }
  for (const value of values) {
    for (let i = 0; i < labels.length; i += 1) {
      if (value >= edges[i] && value < edges[i + 1]) {
        buckets[labels[i]] += 1;
        break;
      }
    }
  }
  return buckets;
}
