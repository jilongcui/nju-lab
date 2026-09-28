import {
  Controller,
  ForbiddenException,
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
import {
  WORKSPACE_BRIDGE_PORT,
  WORKSPACE_PROXY_PATH,
  WORKSPACE_SESSION_COOKIE,
  WORKSPACE_WS_BRIDGE,
} from './workspace.config';
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
   * 反代形态的**入口**：`GET /api/workspace/enter?k=<wsKey>`
   * → 种会话 cookie（`nju_ws`）+ 302 到工作台首页（带 dsh 的 launch token）。
   *
   * 前端「进入实验环境」直接导航到这里（`apiUrl('/api/workspace/enter?k=…')`），
   * 而不是直接打开容器 URL —— 因为 dsh 的运行时路径锚定 **origin 根**
   * （`/api/**`、`/plugins/**`、`/open-in-app/**` 都不带前缀），nginx 只能按
   * **cookie** 把这些请求认领到正确的容器，所以首次进入必须先种 cookie。
   * 取舍与实测见设计文档 §4.5.1 / §4.5.2。
   *
   * `@Public()` 是刻意的：浏览器导航带不上 `Authorization`，凭证是 `wsKey`。
   */
  @Public()
  @Get('enter')
  enter(@Query('k') key: string, @Res() res: Response): void {
    const info = this.workspace.enter(key ?? '');
    if (!info) {
      throw new ForbiddenException('工作台会话不存在或尚未就绪');
    }
    res.cookie(WORKSPACE_SESSION_COOKIE, key, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    res.redirect(
      `${WORKSPACE_PROXY_PATH}/${key}/?token=${encodeURIComponent(info.token)}`,
    );
  }

  /**
   * 供 nginx `auth_request` 使用：`?k=<wsKey>` → `204` + `X-Workspace-Upstream`（`ip:port`）。
   * nginx 用这个 header 做动态 `proxy_pass`（配置示例见 `lab-nginx-snippet.conf`）。
   *
   * 不用宿主端口映射：`--internal` 网络下 `-p` 会静默失效，所以目标是容器 IP。
   *
   * `mode` 决定"查不到会话"时的语义（见 `WorkspaceService.resolveUpstream`）：
   * - 缺省（严格）：403 —— 页面入口用，伪造 key 必须被拒；
   * - `mode=fallback`：204 且**不带** header —— 给「绝对路径按 cookie 分流」用：
   *   `/api/**`、`/plugins/**`、`/open-in-app/**` 这些 dsh 写死的根路径前缀，
   *   没有有效工作台 cookie 的请求（FoxCMS/dify 自己的流量）必须能**原样回落**。
   *
   * `@Public()` 是刻意的：`auth_request` 子请求由 nginx 发起，且浏览器直连时不带 JWT。
   */
  @Public()
  @Get('proxy-auth')
  @HttpCode(204)
  proxyAuth(
    @Query('k') key: string,
    @Query('mode') mode: string,
    @Res({ passthrough: true }) res: Response,
  ): null {
    const upstream =
      mode === 'fallback'
        ? this.workspace.resolveUpstreamOrNull(key ?? '')
        : this.workspace.resolveUpstream(key ?? '');
    if (upstream) {
      res.setHeader('X-Workspace-Upstream', upstream);
      // 桥与容器**同一个 IP、另一个端口**：nginx 用它做 /wsbridge/ 的上游
      // （网关不透传 WebSocket 时的替代通道；未启用桥时不下发这个头）
      if (WORKSPACE_WS_BRIDGE) {
        res.setHeader(
          'X-Workspace-Bridge-Upstream',
          upstream.replace(/:\d+$/, `:${WORKSPACE_BRIDGE_PORT}`),
        );
      }
    }
    return null;
  }
}
