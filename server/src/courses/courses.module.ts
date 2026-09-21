import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Chapter, Course } from './course.entity';
import { ExperimentProject } from '../projects/project.entity';
import { ChapterProgress, Enrollment } from './enrollment.entity';
import {
  ChaptersController,
  CoursesController,
  MeCoursesController,
} from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Chapter,
      Enrollment,
      ChapterProgress,
      ExperimentProject,
    ]),
    UsersModule,
  ],
  controllers: [CoursesController, ChaptersController, MeCoursesController],
  providers: [CoursesService],
  exports: [TypeOrmModule, CoursesService],
})
export class CoursesModule {}
