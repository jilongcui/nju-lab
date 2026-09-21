import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';
import {
  AUTH_PROVIDER,
  AuthProvider,
} from './providers/auth-provider.interface';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_PROVIDER)
    private readonly authProvider: AuthProvider,
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async register(dto: RegisterDto) {
    const user = await this.authProvider.register(dto);
    return { user: this.sanitize(user), ...this.issueToken(user) };
  }

  async login(dto: LoginDto) {
    // 凭证校验全部委托给 AuthProvider；接学校统一认证时替换 Provider 即可
    const user = await this.authProvider.validateCredentials(
      dto.username,
      dto.password,
    );
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    return { user: this.sanitize(user), ...this.issueToken(user) };
  }

  private issueToken(user: User, expiresIn?: string) {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      ver: user.tokenVersion,
    };
    return {
      accessToken: expiresIn
        ? this.jwtService.sign(payload, {
            expiresIn: expiresIn as JwtSignOptions['expiresIn'],
          })
        : this.jwtService.sign(payload),
    };
  }

  private sanitize(user: User) {
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  }

  /** POST /api/me/tokens —— 自助生成长期 API token（供本地 DSH 插件；365 天，受 tokenVersion 吊销约束） */
  issueApiToken(user: User) {
    return this.issueToken(user, '365d');
  }

  /** POST /api/me/tokens/revoke —— tokenVersion + 1：本人全部已签发 token（含 Web 登录态）立即失效 */
  async revokeAllTokens(user: User) {
    await this.userRepo.increment({ id: user.id }, 'tokenVersion', 1);
    return { revoked: true };
  }
}
