import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContainerRuntimeModule } from '../container-runtime/container-runtime.module';
import {
  AgentApp,
  AgentAppMessage,
  AgentAppReview,
  AgentAppVersion,
} from './agent-app.entity';
import { AgentAppRuntime } from './agent-app-runtime';
import {
  AgentAppShareController,
  AgentAppsController,
  CourseAgentAppsController,
} from './agent-apps.controller';
import { AgentAppsService } from './agent-apps.service';

/**
 * 学生应用托管（第 20 章 · 平台一期）。
 *
 * 范围与边界见 `docs/DESIGN-2026-11-agent-app-platform.md`：
 * - 产物 zip 存在 `<AGENT_APP_DATA_DIR>/<appId>/<versionId>.zip`（只读挂进容器，容器内解包）；
 * - 运行时按需起容器、空闲回收，**不占宿主端口**（反代走容器 IP）；
 * - 一期可见性 `owner / teacher / course` 三档，`shareKey` 已生成但**免登录访问还没接**（二期）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AgentApp, AgentAppVersion, AgentAppMessage, AgentAppReview]),
    ContainerRuntimeModule,
  ],
  controllers: [AgentAppShareController, AgentAppsController, CourseAgentAppsController],
  providers: [AgentAppsService, AgentAppRuntime],
  exports: [AgentAppsService],
})
export class AgentAppsModule {}
