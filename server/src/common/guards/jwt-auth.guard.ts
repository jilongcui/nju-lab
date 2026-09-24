import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * 全局 JWT 认证 Guard。
 *
 * - 默认：必须有合法 token，否则 401
 * - @Public()：完全跳过认证（仅登录/注册/CAS 回调等认证入口）
 *
 * 平台内容一律登录后可见：曾有过的「可选认证」（带 token 识别、不带放行）
 * 已随 2026-09-24 的决策移除——未登录访客应直接落到登录页。
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
    return (await super.canActivate(context)) as boolean;
  }
}
