import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chapter, Course } from '../courses/course.entity';
import { ChapterProgress, Enrollment } from '../courses/enrollment.entity';
import { FilesModule } from '../files/files.module';
import { Submission } from '../submissions/submission.entity';
import { Assignment, ExperimentProject } from './project.entity';
import {
  AssignmentsController,
  MeAssignmentsController,
  ProjectsController,
} from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExperimentProject,
      Assignment,
      Course,
      Chapter,
      Enrollment,
      ChapterProgress,
      Submission,
    ]),
    FilesModule,
  ],
  controllers: [
    ProjectsController,
    AssignmentsController,
    MeAssignmentsController,
  ],
  providers: [ProjectsService],
  exports: [TypeOrmModule, ProjectsService],
})
export class ProjectsModule {}
