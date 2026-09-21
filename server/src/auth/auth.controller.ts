import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}

/** 长期 API token 自助管理（供本地 DSH 插件；D-lite+ 方案：tokenVersion 整体吊销） */
@Controller('me/tokens')
export class MeTokensController {
  constructor(private readonly authService: AuthService) {}

  /** 生成长期 token（365 天）。每次生成都是新 token，但共享同一 tokenVersion */
  @Post()
  issue(@CurrentUser() user: User) {
    return this.authService.issueApiToken(user);
  }

  /** 吊销：本人全部已签发 token（含 Web 登录态）立即失效 */
  @Post('revoke')
  revoke(@CurrentUser() user: User) {
    return this.authService.revokeAllTokens(user);
  }
}

@Controller('me')
export class MePasswordController {
  constructor(private readonly authService: AuthService) {}

  /** 修改密码（校验旧密码；成功后本人全部 token 失效，需重新登录/重配插件 token） */
  @Post('password')
  changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user, dto);
  }
}
