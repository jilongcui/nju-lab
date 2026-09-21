import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记无需认证的接口（登录/注册），全局 JwtAuthGuard 会放行 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
