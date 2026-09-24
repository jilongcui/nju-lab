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
   * CAS 统一认证登录：按学号/工号找用户，不存在则按 CAS 身份注册
   * （随机密码，本地密码登录不可用）。
   *
   * 角色由 CAS 属性推断（containerId 的 ou=JZG → 教师，见 cas.client 的
   * resolveRoleFromCasAttributes）。已存在用户只在「CAS 判定为教师、库里还是学生」
   * 时升级 —— 只升不降，免得把管理员手工设过的教师又降回学生。
   * 注意：用户名即绑定键——若同名本地账号已存在则直接并入（占位风险由管理员管控）。
   */
  async loginWithCas(casUser: {
    username: string;
    displayName?: string;
    role?: UserRole;
  }) {
    let user = await this.userRepo.findOne({
      where: { username: casUser.username },
    });
    if (!user) {
      user = await this.authProvider.register({
        username: casUser.username,
        nickname: casUser.displayName || casUser.username,
        password: `${randomUUID()}${randomUUID()}`,
        role: casUser.role ?? UserRole.STUDENT,
      });
    } else if (
      casUser.role === UserRole.TEACHER &&
      user.role === UserRole.STUDENT
    ) {
      // CAS 说是教职工、库里还是学生 → 升级（issueToken 读的是内存里的 user.role，需同步）
      await this.userRepo.update(user.id, { role: UserRole.TEACHER });
      user.role = UserRole.TEACHER;
    }
    return { user: this.sanitize(user), ...this.issueToken(user) };
  }
}
