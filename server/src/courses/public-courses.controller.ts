import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/optional-auth.decorator';
import { User } from '../users/user.entity';
import { CourseApplicationsService } from './course-applications.service';
import { PublicCourseQueryDto } from './dto/course-application.dto';

/**
 * 公开课程目录 —— 无需登录（@OptionalAuth）。
 *
 * 登录状态下会额外返回「我的申请/入册状态」，用于回显按钮；
 * 匿名时只返回课程公开信息。**不要**给这些接口标 @Roles()。
 */
@Controller('public/courses')
export class PublicCoursesController {
  constructor(private readonly service: CourseApplicationsService) {}

  /** GET /api/public/courses —— 课程目录 + 检索 */
  @Get()
  @OptionalAuth()
  list(@Query() query: PublicCourseQueryDto) {
    return this.service.listPublicCourses(query);
  }

  /** GET /api/public/courses/:slug —— 课程公开页（不含教学内容） */
  @Get(':slug')
  @OptionalAuth()
  detail(@Param('slug') slug: string, @CurrentUser() user?: User) {
    return this.service.getPublicCourse(slug, user);
  }
}
