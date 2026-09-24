import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { CourseApplicationsService } from './course-applications.service';
import { RejectApplicationDto } from './dto/course-application.dto';

/** 课程申请与审批 */
@Controller('courses')
export class CourseApplicationsController {
  constructor(private readonly service: CourseApplicationsService) {}

  /** 教师：申请列表（按申请时间升序＝先到先得） */
  @Get(':courseId/applications')
  @Roles(UserRole.TEACHER)
  list(
    @CurrentUser() user: User,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.service.listApplications(user, courseId);
  }

  /** 学生：提交申请（课程未开放或名额已满会被拒） */
  @Post(':courseId/applications')
  @Roles(UserRole.STUDENT)
  apply(
    @CurrentUser() user: User,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.service.apply(user, courseId);
  }

  /** 学生：撤销自己的待审批申请 */
  @Delete(':courseId/applications/:id')
  @Roles(UserRole.STUDENT)
  withdraw(
    @CurrentUser() user: User,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.withdraw(user, courseId, id);
  }

  /** 教师：批准（建入册 + 补发该课程已发布项目的任务） */
  @Post(':courseId/applications/:id/approve')
  @Roles(UserRole.TEACHER)
  approve(
    @CurrentUser() user: User,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approve(user, courseId, id);
  }

  /** 教师：驳回（可选填理由） */
  @Post(':courseId/applications/:id/reject')
  @Roles(UserRole.TEACHER)
  reject(
    @CurrentUser() user: User,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.service.reject(user, courseId, id, dto?.note);
  }
}

/** 学生：我的申请 */
@Controller('me')
export class MeApplicationsController {
  constructor(private readonly service: CourseApplicationsService) {}

  /** GET /api/me/applications */
  @Get('applications')
  @Roles(UserRole.STUDENT)
  mine(@CurrentUser() user: User) {
    return this.service.listMyApplications(user);
  }
}
