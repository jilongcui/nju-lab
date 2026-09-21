import { Inject, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
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

  /** POST /api/me/password —— 修改密码；成功后 tokenVersion + 1（全部端重新登录/重配 token） */
  async changePassword(user: User, dto: ChangePasswordDto) {
    const ok = await this.authProvider.validateCredentials(
      user.username,
      dto.oldPassword,
    );
    if (!ok) {
      throw new UnauthorizedException('旧密码错误');
    }
    if (!this.authProvider.setPassword) {
      throw new BadRequestException('当前认证方式不支持在平台修改密码');
    }
    await this.authProvider.setPassword(user.id, dto.newPassword);
    await this.userRepo.increment({ id: user.id }, 'tokenVersion', 1);
    return { changed: true };
  }

  /**
   * CAS 统一认证登录（双轨并行）：按学号/工号找用户，不存在则自动注册为学生
   * （随机密码，本地密码登录不可用；教师角色由管理员后台调整）。
   * 注意：用户名即绑定键——若同名本地账号已存在则直接并入（占位风险由管理员管控）。
   */
  async loginWithCas(casUser: { username: string; displayName?: string }) {
    let user = await this.userRepo.findOne({
      where: { username: casUser.username },
    });
    if (!user) {
      user = await this.authProvider.register({
        username: casUser.username,
        nickname: casUser.displayName || casUser.username,
        password: `${randomUUID()}${randomUUID()}`,
        role: UserRole.STUDENT,
      });
    }
    return { user: this.sanitize(user), ...this.issueToken(user) };
  }
}
