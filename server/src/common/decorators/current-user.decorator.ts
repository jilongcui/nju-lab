import {
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { User } from '../../users/user.entity';

/** 从请求中取当前登录用户（由 JwtStrategy 注入） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<{ user: User }>();
    return request.user;
  },
);
