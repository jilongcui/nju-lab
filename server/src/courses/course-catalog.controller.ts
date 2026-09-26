import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { CourseApplicationsService } from './course-applications.service';
import { CatalogCourseQueryDto } from './dto/course-application.dto';

/**
 * 课程目录与课程详情 —— **需登录**（全局 JwtAuthGuard）。
 *
 * 2026-09-24 决策：平台内容一律登录后可见，未登录访客直接落到登录页。
 * 因此这里不再有「匿名放行」的接口（此前的 @OptionalAuth 已移除）。
 *
 * 学生工作台「选课」入口 → 本目录 → 课程详情 → 申请。
 */
@Controller('browse/courses')
export class CourseCatalogController {
  constructor(private readonly service: CourseApplicationsService) {}

  /** GET /api/browse/courses —— 课程目录 + 检索(keyword/term) */
  @Get()
  list(@Query() query: CatalogCourseQueryDto) {
    return this.service.listCatalogCourses(query);
  }

  /** GET /api/browse/courses/:slug —— 课程详情（章节只给标题，不含教学内容） */
  @Get(':slug')
  detail(@CurrentUser() user: User, @Param('slug') slug: string) {
    return this.service.getCatalogCourse(user, slug);
  }
}
