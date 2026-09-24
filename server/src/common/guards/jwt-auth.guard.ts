import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';

/**
 * 全局 JWT 认证 Guard。三种模式：
 *
 * - 默认：必须有合法 token，否则 401
 * - @Public()：完全跳过认证（登录/注册/CAS 回调）
 * - @OptionalAuth()：尝试认证——带合法 token 则注入 user，不带/无效也放行
 *   （公开课程页需要：已登录时回显「我的申请状态」，匿名时照常浏览）
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isOptional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isOptional) {
      try {
        await super.canActivate(context);
      } catch {
        // 匿名访问（无 token / token 无效）按匿名处理，继续放行
      }
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }
}
