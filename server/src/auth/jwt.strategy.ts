import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { User } from '../users/user.entity';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  /** 签发时的 User.tokenVersion；validate 时比对，不一致即 token 已吊销 */
  ver?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'nju-lab-dev-secret',
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('用户不存在或已被删除');
    }
    // tokenVersion 比对：用户吊销（+1）后全部旧 token 失效；旧 token 无 ver 视为 0
    if ((payload.ver ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }
    return user;
  }
}
