import { Module } from '@nestjs/common';
import { ContainerRuntime } from './container-runtime';

/**
 * 通用容器运行时模块：复验（SubmissionsModule）与将来的实验工作台共用。
 * 隔离策略（限额 / 出栈白名单 / 一次性）集中在 ContainerRuntime，避免多份实现漂移。
 */
@Module({
  providers: [ContainerRuntime],
  exports: [ContainerRuntime],
})
export class ContainerRuntimeModule {}
