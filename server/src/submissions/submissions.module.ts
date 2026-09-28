import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/course.entity';
import { ContainerRuntime } from '../container-runtime/container-runtime';
import { ContainerRuntimeModule } from '../container-runtime/container-runtime.module';
import { FilesModule } from '../files/files.module';
import { FilesService } from '../files/files.service';
import { Assignment } from '../projects/project.entity';
import { Evaluation, Submission } from './submission.entity';
import {
  AssignmentSubmitController,
  MeEvaluationsController,
  SubmissionsController,
} from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import {
  EVALUATION_RUNNER,
  EvaluationRunner,
  MockEvaluationRunner,
} from './evaluation-runner';
import { DockerEvaluationRunner } from './docker-evaluation-runner';

@Module({
  imports: [
    TypeOrmModule.forFeature([Submission, Evaluation, Assignment, Course]),
    FilesModule,
    ContainerRuntimeModule,
  ],
  controllers: [
    SubmissionsController,
    AssignmentSubmitController,
    MeEvaluationsController,
  ],
  providers: [
    SubmissionsService,
    // 复验执行器绑定：EVALUATION_RUNNER=mock（默认，确定性模拟）| docker（一次性容器真实复验）
    {
      provide: EVALUATION_RUNNER,
      inject: [FilesService, ContainerRuntime],
      useFactory: (
        filesService: FilesService,
        runtime: ContainerRuntime,
      ): EvaluationRunner =>
        process.env.EVALUATION_RUNNER === 'docker'
          ? new DockerEvaluationRunner(filesService, runtime)
          : new MockEvaluationRunner(),
    },
  ],
  exports: [TypeOrmModule, SubmissionsService],
})
export class SubmissionsModule {}
