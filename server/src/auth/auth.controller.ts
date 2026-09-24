import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { CasClient, frontendBasePath } from './cas.client';
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

/**
 * 南京大学统一身份认证（CAS 3.0 重定向流，与本地账号双轨并行）。
 *
 * 由应用自己决定何时登录：302 到学校登录页 → 回调用 ticket 服务端校验 → 签发本平台 token。
 *
 * 历史：上游网关曾拦截全站并注入 CAS-USER / CAS-USER-CN 头代为认证，本控制器因此有过一条
 * 「读网关头直接签发」的优先路径。网关放开（不再拦截、不再注入头）后该路径已移除——
 * 请求头客户端可任意伪造，留着等于允许冒充任意账号。
 */
@Controller('auth/cas')
export class CasAuthController {
  constructor(
    private readonly casClient: CasClient,
    private readonly authService: AuthService,
  ) {}

  /** 统一认证入口（前端登录页「南京大学统一认证登录」按钮指向这里）：跳学校登录页 */
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
      res.redirect(`${frontendBasePath()}/login?error=cas-no-ticket`);
      return;
    }
    try {
      const casUser = await this.casClient.validateTicket(ticket);
      const { accessToken } = await this.authService.loginWithCas(casUser);
      res.redirect(this.tokenRedirectUrl(accessToken));
    } catch {
      res.redirect(`${frontendBasePath()}/login?error=cas-validate-failed`);
    }
  }

  /**
   * 统一认证登出（官方文档的标准做法）。
   *
   * 本平台 token 由前端清除；这里负责终止 CAS 会话——否则统一认证会话还在，
   * 用户「退出」后再点登录会被直接登回去，无法切换账号。
   *
   * service 固定用配置的应用地址，不接受外部传入（避免开放重定向）。
   */
  @Public()
  @Get('logout')
  logout(@Res() res: Response) {
    res.redirect(this.casClient.logoutUrl(this.casClient.appRootUrl()));
  }

  /**
   * 带平台 token 跳回前端 CAS 落地页。
   * 必须带前端基路径：前端 basename 是 /lab/，跳根路径 /login/cas 会落到同域的 FoxCMS 上。
   */
  private tokenRedirectUrl(accessToken: string): string {
    return `${frontendBasePath()}/login/cas?token=${encodeURIComponent(accessToken)}`;
  }
}
