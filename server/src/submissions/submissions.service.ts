import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../courses/course.entity';
import { FilesService } from '../files/files.service';
import {
  Assignment,
  AssignmentStatus,
} from '../projects/project.entity';
import { User, UserRole } from '../users/user.entity';
import { GradeDto, SubmitDto } from './dto/submission.dto';
import {
  EVALUATION_RUNNER,
  EvaluationRunner,
} from './evaluation-runner';
import {
  Evaluation,
  Submission,
  SubmissionStatus,
} from './submission.entity';

@Injectable()
export class SubmissionsService {
  constructor(
    @InjectRepository(Submission)
    private readonly submissionRepo: Repository<Submission>,
    @InjectRepository(Evaluation)
    private readonly evaluationRepo: Repository<Evaluation>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Course)
    private readonly courseRepo: Repository<Course>,
    @Inject(EVALUATION_RUNNER)
    private readonly evaluationRunner: EvaluationRunner,
    private readonly filesService: FilesService,
  ) {}

  /** POST /api/assignments/:id/submit —— 学生提交 Skill 包 + 证据包 + 审计事件 */
  async submit(student: User, assignmentId: string, dto: SubmitDto) {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['project'],
    });
    if (!assignment || assignment.studentId !== student.id) {
      throw new NotFoundException('任务不存在');
    }
    if (assignment.status === AssignmentStatus.PENDING) {
      throw new BadRequestException('请先领取任务再提交');
    }
    const latest = await this.submissionRepo.findOne({
      where: { assignmentId },
      order: { submittedAt: 'DESC' },
    });
    // 允许在复验失败后重新提交；其他状态下重复提交拒绝
    if (latest && latest.status !== SubmissionStatus.FAILED) {
      throw new BadRequestException(`当前提交状态为 ${latest.status}，不能重复提交`);
    }
    const skillZip = await this.resolveArtifact(
      student,
      dto.skillZipFileId,
      dto.skillZipRef,
      dto.skillZipSha256,
      'Skill 包',
    );
    const capsule = await this.resolveArtifact(
      student,
      dto.capsuleFileId,
      dto.capsuleRef,
      dto.capsuleSha256,
      '证据包（.dshc）',
    );
    const submission = await this.submissionRepo.save(
      this.submissionRepo.create({
        assignmentId,
        studentId: student.id,
        skillZipRef: skillZip.ref,
        skillZipSha256: skillZip.sha256,
        capsuleRef: capsule.ref,
        capsuleSha256: capsule.sha256,
        auditEvents: dto.auditEvents ?? null,
        fileHashes: dto.fileHashes ?? null,
      }),
    );
    assignment.status = AssignmentStatus.SUBMITTED;
    await this.assignmentRepo.save(assignment);
    return submission;
  }

  /**
   * POST /api/submissions/:id/verify —— 教师触发复验。
   * 复验的执行委托给 EvaluationRunner（当前为模拟实现，后续替换为一次性容器复验）。
   */
  async verify(teacher: User, submissionId: string) {
    const submission = await this.getSubmissionWithOwnerCheck(
      teacher,
      submissionId,
    );
    if (
      submission.status !== SubmissionStatus.SUBMITTED &&
      submission.status !== SubmissionStatus.FAILED
    ) {
      throw new BadRequestException(
        `当前提交状态为 ${submission.status}，不能触发复验`,
      );
    }
    const assignment = await this.assignmentRepo.findOne({
      where: { id: submission.assignmentId },
      relations: ['project'],
    });
    if (!assignment) {
      throw new NotFoundException('任务不存在');
    }

    // submitted → verifying → verified
    submission.status = SubmissionStatus.VERIFYING;
    await this.submissionRepo.save(submission);

    const result = await this.evaluationRunner.run(
      submission,
      assignment.project,
    );
    const evaluation = await this.evaluationRepo.save(
      this.evaluationRepo.create({
        submissionId: submission.id,
        ...result,
      }),
    );
    submission.status = SubmissionStatus.VERIFIED;
    await this.submissionRepo.save(submission);
    return evaluation;
  }

  /** GET /api/submissions/:id/evaluation —— 教师（课程 owner）或提交者本人可见 */
  /** GET /api/submissions/:id —— 提交详情（教师或提交者本人） */
  async getSubmission(user: User, submissionId: string) {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
      relations: ['assignment'],
    });
    if (!submission) {
      throw new NotFoundException('提交不存在');
    }
    if (user.role === UserRole.STUDENT) {
      if (submission.studentId !== user.id) {
        throw new ForbiddenException('只能查看自己的提交');
      }
    } else {
      await this.assertCourseOwner(user, submission);
    }
    return submission;
  }

  async getEvaluation(user: User, submissionId: string) {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
    });
    if (!submission) {
      throw new NotFoundException('提交不存在');
    }
    if (user.role === UserRole.STUDENT) {
      if (submission.studentId !== user.id) {
        throw new ForbiddenException('只能查看自己的复验结果');
      }
    } else {
      await this.assertCourseOwner(user, submission);
    }
    const evaluation = await this.evaluationRepo.findOne({
      where: { submissionId },
    });
    if (!evaluation) {
      throw new NotFoundException('尚未产生复验结果');
    }
    return evaluation;
  }

  /** POST /api/submissions/:id/grade —— 教师确认评分与评语 */
  async grade(teacher: User, submissionId: string, dto: GradeDto) {
    const submission = await this.getSubmissionWithOwnerCheck(
      teacher,
      submissionId,
    );
    const evaluation = await this.evaluationRepo.findOne({
      where: { submissionId },
    });
    if (!evaluation) {
      throw new BadRequestException('请先触发复验再评分');
    }
    evaluation.teacherScore = dto.teacherScore;
    evaluation.teacherComment = dto.teacherComment ?? null;
    await this.evaluationRepo.save(evaluation);
    // verified → graded
    submission.status = SubmissionStatus.GRADED;
    await this.submissionRepo.save(submission);
    return evaluation;
  }

  /** GET /api/me/evaluations/:id —— 学生查看自己的复验结果与教师反馈 */
  async getMyEvaluation(student: User, evaluationId: string) {
    const evaluation = await this.evaluationRepo.findOne({
      where: { id: evaluationId },
      relations: ['submission'],
    });
    if (!evaluation || evaluation.submission.studentId !== student.id) {
      throw new NotFoundException('评估结果不存在');
    }
    return evaluation;
  }

  // ---------- 内部工具 ----------

  /**
   * 解析提交物（Skill 包 / 证据包）：
   * - fileId 模式：文件须为本人上传，sha256 以服务端存储值为准；若客户端同时自报哈希则校验一致
   * - 直填模式：ref + sha256 直接登记（兼容旧契约）
   */
  private async resolveArtifact(
    student: User,
    fileId: string | undefined,
    ref: string | undefined,
    sha256: string | undefined,
    label: string,
  ): Promise<{ ref: string; sha256: string }> {
    if (fileId) {
      const file = await this.filesService.getFile(fileId);
      if (file.uploaderId !== student.id) {
        throw new ForbiddenException(`${label}文件不属于当前用户`);
      }
      if (sha256 && sha256.toLowerCase() !== file.sha256) {
        throw new BadRequestException(
          `${label}哈希校验失败：自报 ${sha256.toLowerCase()}，服务端 ${file.sha256}`,
        );
      }
      return { ref: `file:${file.id}`, sha256: file.sha256 };
    }
    if (ref && sha256) {
      return { ref, sha256: sha256.toLowerCase() };
    }
    throw new BadRequestException(
      `${label}缺失：请先 POST /api/files 上传并传 fileId，或直接填引用 + sha256`,
    );
  }

  private async getSubmissionWithOwnerCheck(
    teacher: User,
    submissionId: string,
  ): Promise<Submission> {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
      relations: ['assignment'],
    });
    if (!submission) {
      throw new NotFoundException('提交不存在');
    }
    await this.assertCourseOwner(teacher, submission);
    return submission;
  }

  private async assertCourseOwner(user: User, submission: Submission) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
    const assignment = await this.assignmentRepo.findOne({
      where: { id: submission.assignmentId },
      relations: ['project'],
    });
    if (!assignment) {
      throw new NotFoundException('任务不存在');
    }
    const course = await this.courseRepo.findOne({
      where: { id: assignment.project.courseId },
    });
    if (!course || course.teacherId !== user.id) {
      throw new ForbiddenException('只有课程所属教师可以执行该操作');
    }
  }
}
