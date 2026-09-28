import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { WorkspaceService } from './workspace.service';

/**
 * 平台侧实验工作台（兜底环境）。
 *
 * 前三个接口需登录（学生与教师都可用，教师可用于课堂演示）。
 * 另有**一个供 nginx `auth_request` 调用的内部端点**：浏览器是直接导航到工作台 URL 的，
 * 带不上 JWT，所以它按能力凭证（`wsKey`）校验 —— 取舍见 `WorkspaceService.resolveProxyPort`。
 */
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  /** 启动（或复用）自己的工作台；**立即返回**，就绪状态由 `status` 轮询推进 */
  @Post('start')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  start(@CurrentUser() user: User) {
    return this.workspace.start(user);
  }

  /** 查询状态；首次返回 `running` 时 `token`/`wsKey`/`directUrl` 才有值 */
  @Get('status')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  status(@CurrentUser() user: User) {
    return this.workspace.status(user.id);
  }

  /** 主动结束工作台（幂等） */
  @Post('stop')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  stop(@CurrentUser() user: User) {
    this.workspace.stop(user.id);
    return { stopped: true };
  }

  /**
   * 供 nginx `auth_request` 使用：`?k=<wsKey>` → `204` + `X-Workspace-Upstream`（`ip:port`）。
   * nginx 用这个 header 做动态 `proxy_pass`（配置示例见设计文档 §4.5）。
   *
   * 不用宿主端口映射：`--internal` 网络下 `-p` 会静默失效，所以目标是容器 IP。
   *
   * `@Public()` 是刻意的：`auth_request` 子请求由 nginx 发起，且浏览器直连时不带 JWT。
   */
  @Public()
  @Get('proxy-auth')
  @HttpCode(204)
  proxyAuth(
    @Query('k') key: string,
    @Res({ passthrough: true }) res: Response,
  ): null {
    const upstream = this.workspace.resolveUpstream(key ?? '');
    res.setHeader('X-Workspace-Upstream', upstream);
    return null;
  }
}
