import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContainerRuntimeModule } from '../container-runtime/container-runtime.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

/**
 * 平台侧实验工作台模块。
 *
 * 容器编排（限额 / 出栈隔离 / 长驻生命周期）全部来自 `ContainerRuntime`，
 * 与复验共用同一份隔离策略；本模块只负责工作台特有的：端口分配、就绪探测、
 * 空闲回收、以及给学生/nginx 的接口。
 */
@Module({
  imports: [ContainerRuntimeModule, AuthModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
