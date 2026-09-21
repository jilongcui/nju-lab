import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { CoursesService } from './courses.service';
import {
  CreateCourseDto,
  EnrollStudentsDto,
  UpdateCourseDto,
  UpsertChapterDto,
} from './dto/course.dto';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @Roles(UserRole.TEACHER)
  create(@CurrentUser() user: User, @Body() dto: CreateCourseDto) {
    return this.coursesService.createCourse(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User) {
    return this.coursesService.listCourses(user);
  }

  @Get(':id')
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.getCourse(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.TEACHER)
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.coursesService.updateCourse(user, id, dto);
  }

  @Post(':id/publish')
  @Roles(UserRole.TEACHER)
  publish(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.publishCourse(user, id);
  }

  @Delete(':id')
  @Roles(UserRole.TEACHER)
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.removeCourse(user, id);
  }

  @Post(':id/chapters')
  @Roles(UserRole.TEACHER)
  upsertChapter(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertChapterDto,
  ) {
    return this.coursesService.upsertChapter(user, id, dto);
  }

  @Get(':id/chapters')
  listChapters(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.listChapters(user, id);
  }

  @Post(':id/enrollments')
  @Roles(UserRole.TEACHER)
  enroll(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollStudentsDto,
  ) {
    return this.coursesService.enrollStudents(user, id, dto);
  }

  @Get(':id/enrollments')
  @Roles(UserRole.TEACHER)
  listEnrollments(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.listEnrollments(user, id);
  }

  @Delete(':id/enrollments/:studentId')
  @Roles(UserRole.TEACHER)
  unenroll(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.coursesService.unenroll(user, id, studentId);
  }

  @Get(':id/progress')
  @Roles(UserRole.TEACHER)
  progress(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.getCourseProgress(user, id);
  }

  @Get(':id/dashboard')
  @Roles(UserRole.TEACHER)
  dashboard(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.getCourseDashboard(user, id);
  }
}

@Controller('chapters')
export class ChaptersController {
  constructor(private readonly coursesService: CoursesService) {}

  /** 学生阅读章节：自动记录"学习中" */
  @Get(':id')
  read(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.readChapter(user, id);
  }

  /** 学生标记章节完成 */
  @Post(':id/complete')
  @Roles(UserRole.STUDENT)
  complete(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.completeChapter(user, id);
  }

  /** 删除章节（级联删除其下实验项目） */
  @Delete(':id')
  @Roles(UserRole.TEACHER)
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.removeChapter(user, id);
  }
}

@Controller('me')
export class MeCoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  /** GET /api/me/courses 我的课程与章节进度 */
  @Get('courses')
  @Roles(UserRole.STUDENT)
  myCourses(@CurrentUser() user: User) {
    return this.coursesService.getMyCourses(user);
  }
}
