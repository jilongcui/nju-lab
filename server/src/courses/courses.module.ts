import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Chapter, Course } from './course.entity';
import { ExperimentProject } from '../projects/project.entity';
import { ChapterProgress, Enrollment } from './enrollment.entity';
import { CourseApplication } from './course-application.entity';
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
import { PublicCoursesController } from './public-courses.controller';
import { CourseApplicationsService } from './course-applications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Chapter,
      Enrollment,
      ChapterProgress,
      ExperimentProject,
      CourseApplication,
    ]),
    UsersModule,
  ],
  controllers: [
    CoursesController,
    ChaptersController,
    MeCoursesController,
    CourseApplicationsController,
    MeApplicationsController,
    PublicCoursesController,
  ],
  providers: [CoursesService, CourseApplicationsService],
  exports: [TypeOrmModule, CoursesService],
})
export class CoursesModule {}
