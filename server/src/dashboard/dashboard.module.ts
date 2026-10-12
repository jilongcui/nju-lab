import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/course.entity';
import { Enrollment } from '../courses/enrollment.entity';
import { Assignment, ExperimentProject } from '../projects/project.entity';
import { ProjectsModule } from '../projects/projects.module';
import { Evaluation, Submission } from '../submissions/submission.entity';
import { User } from '../users/user.entity';
import { DashboardController, TeacherDashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { CoursesModule } from '../courses/courses.module';

@Module({
  imports: [
    CoursesModule,
    TypeOrmModule.forFeature([
      ExperimentProject,
      Assignment,
      Submission,
      Evaluation,
      Course,
      Enrollment,
      User,
    ]),
    ProjectsModule,
  ],
  controllers: [DashboardController, TeacherDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
