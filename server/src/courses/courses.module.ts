import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Chapter, Course } from './course.entity';
import { CourseTeacher } from './course-teacher.entity';
import { ContentAudit } from './content-audit.entity';
import { ExperimentProject } from '../projects/project.entity';
import { ChapterProgress, Enrollment } from './enrollment.entity';
import { CourseApplication } from './course-application.entity';
// 课程详情/章节页右栏要显示「这章有没有课件」，故在此注册 deck 仓储（只读页数，见 getCourse）
import { SlideDeck } from '../slides/slide-deck.entity';
import {
  ChaptersController,
  CoursesController,
  MeCoursesController,
} from './courses.controller';
import { CoursesService } from './courses.service';
import {
  CourseApplicationsController,
  MeApplicationsController,
} from './course-applications.controller';
import { CourseCatalogController } from './course-catalog.controller';
import { CourseApplicationsService } from './course-applications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Chapter,
      CourseTeacher,
      ContentAudit,
      Enrollment,
      ChapterProgress,
      ExperimentProject,
      CourseApplication,
      SlideDeck,
    ]),
    UsersModule,
  ],
  controllers: [
    CoursesController,
    ChaptersController,
    MeCoursesController,
    CourseApplicationsController,
    MeApplicationsController,
    CourseCatalogController,
  ],
  providers: [CoursesService, CourseApplicationsService],
  exports: [TypeOrmModule, CoursesService],
})
export class CoursesModule {}
