import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { GradeDto, SubmitDto } from './dto/submission.dto';
import { SubmissionsService } from './submissions.service';

@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  /** 教师触发复验（当前为模拟复验，真实容器复验后续接入） */
  @Post(':id/verify')
  @Roles(UserRole.TEACHER)
  verify(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.submissionsService.verify(user, id);
  }

  @Get(':id')
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.submissionsService.getSubmission(user, id);
  }

  @Get(':id/evaluation')
  evaluation(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.submissionsService.getEvaluation(user, id);
  }

  /** 教师确认评分与评语 */
  @Post(':id/grade')
  @Roles(UserRole.TEACHER)
  grade(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GradeDto,
  ) {
    return this.submissionsService.grade(user, id, dto);
  }
}

@Controller('assignments')
export class AssignmentSubmitController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  /** 学生提交：ZIP + .dshc + 审计事件（引用与哈希） */
  @Post(':id/submit')
  @Roles(UserRole.STUDENT)
  submit(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitDto,
  ) {
    return this.submissionsService.submit(user, id, dto);
  }
}

@Controller('me')
export class MeEvaluationsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  /** GET /api/me/evaluations/:id 学生查看自己的复验结果与反馈 */
  @Get('evaluations/:id')
  @Roles(UserRole.STUDENT)
  myEvaluation(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.submissionsService.getMyEvaluation(user, id);
  }
}
