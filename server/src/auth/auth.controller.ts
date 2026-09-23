import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { CasClient, frontendBasePath } from './cas.client';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { gatewayCasUserFromHeaders } from './gateway-cas';

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
 * 南京大学统一身份认证：与本地账号双轨并行。
 *
 * 登录有两条路径，由本控制器自动挑选：
 *   1. 网关头（优先）：medai.nju.edu.cn 上游的学校统一认证网关认证后会注入
 *      CAS-USER / CAS-USER-CN 请求头，此时身份已可信，直接落地本平台会话，
 *      不再把用户送去 authserver 二次登录。
 *   2. CAS 3.0 重定向流（回退）：请求里没有网关头时（如直连、或网关未覆盖的入口），
 *      维持原有行为——302 到学校登录页，回调用 ticket 服务端校验。
 */
@Controller('auth/cas')
export class CasAuthController {
  constructor(
    private readonly casClient: CasClient,
    private readonly authService: AuthService,
  ) {}

  /**
   * 统一认证入口（前端登录页「南京大学统一认证登录」按钮指向这里）。
   * 有网关头 → 直接签发平台 token 跳回前端；无 → 302 到学校登录页。
   */
  @Public()
  @Get('login')
  async login(@Req() req: Request, @Res() res: Response) {
    const gatewayUser = gatewayCasUserFromHeaders(req.headers);
    if (gatewayUser) {
      const { accessToken } = await this.authService.loginWithCas(gatewayUser);
      res.redirect(this.tokenRedirectUrl(accessToken));
      return;
    }
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
   * 本平台 token 由前端清除；这里负责终止 CAS 会话——否则由于上游网关会持续注入
   * 身份头，用户「退出」后一刷新就被自动登回去，无法切换账号。
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
