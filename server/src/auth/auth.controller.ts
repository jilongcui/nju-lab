import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { CasClient } from './cas.client';
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

/** 南京大学统一身份认证（CAS 3.0）：浏览器重定向流，与本地账号双轨并行 */
@Controller('auth/cas')
export class CasAuthController {
  constructor(
    private readonly casClient: CasClient,
    private readonly authService: AuthService,
  ) {}

  /** 跳转到学校统一认证登录页 */
  @Public()
  @Get('login')
  login(@Res() res: Response) {
    res.redirect(this.casClient.loginUrl());
  }

  /** 学校回调：校验 ticket → 找/建用户 → 带平台 token 跳回前端 */
  @Public()
  @Get('callback')
  async callback(@Query('ticket') ticket: string, @Res() res: Response) {
    if (!ticket) {
      res.redirect('/login?error=cas-no-ticket');
      return;
    }
    try {
      const casUser = await this.casClient.validateTicket(ticket);
      const { accessToken } = await this.authService.loginWithCas(casUser);
      res.redirect(`/login/cas?token=${encodeURIComponent(accessToken)}`);
    } catch {
      res.redirect('/login?error=cas-validate-failed');
    }
  }
}
