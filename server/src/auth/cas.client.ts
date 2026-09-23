import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

/** CAS 集成配置（环境变量；CAS_BASE_URL 为空表示未启用） */
export interface CasConfig {
  /** 学校 CAS 服务根，如 https://authserver.nju.edu.cn/authserver */
  baseUrl: string;
  /** ticket 校验路径，CAS 3.0 为 /p3/serviceValidate（返回属性） */
  validatePath: string;
  /** 本平台公网根（拼 service 回调地址），如 https://lab.xiaohe.biz */
  publicBaseUrl: string;
}

export function casConfigFromEnv(): CasConfig | null {
  const baseUrl = (process.env.CAS_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return null;
  }
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!publicBaseUrl) {
    throw new Error('启用 CAS 必须配置 PUBLIC_BASE_URL（平台公网根地址）');
  }
  return {
    baseUrl,
    validatePath: process.env.CAS_VALIDATE_PATH || '/p3/serviceValidate',
    publicBaseUrl,
  };
}

/**
 * 前端 SPA 的对外基路径（浏览器地址栏里可见的前缀）。
 *
 * 前端构建时 basename 固定为 /lab/，部署在 medai.nju.edu.cn/lab/ 下，
 * 所以后端跳回前端不能再用根路径 /login/cas —— 那会落到同域的 FoxCMS 上。
 * 取 PUBLIC_BASE_URL 的 path 部分（http://medai.nju.edu.cn/lab → /lab），
 * 未配置或解析失败时退回默认 /lab。
 *
 * 与 casConfigFromEnv 不同：读网关头登录不依赖 CAS 服务端配置，
 * 本函数必须在 CAS_BASE_URL 为空时也能正常工作。
 */
export function frontendBasePath(): string {
  const raw = (process.env.PUBLIC_BASE_URL || '').trim();
  if (raw) {
    try {
      // 根部署（https://lab.xiaohe.biz）的 pathname 是 ''，必须原样返回——
      // 落进默认 /lab 会让 CAS 回跳在根部署上 404
      return new URL(raw).pathname.replace(/\/+$/, '');
    } catch {
      // 非法 URL：忽略，走默认前缀
    }
  }
  return '/lab';
}

/**
 * 南京大学统一身份认证（CAS 3.0）客户端。
 *
 * 流程：GET /api/auth/cas/login → 302 到学校登录页 → 学校回调
 * /api/auth/cas/callback?ticket=ST-... → 本类服务端校验 ticket → 返回学号/工号。
 */
@Injectable()
export class CasClient {
  private readonly config = casConfigFromEnv();

  get enabled(): boolean {
    return this.config !== null;
  }

  private requireConfig(): CasConfig {
    if (!this.config) {
      throw new BadRequestException('统一认证未配置（CAS_BASE_URL 未设置）');
    }
    return this.config;
  }

  /** 本平台回调地址（作为 CAS 的 service 参数） */
  serviceUrl(): string {
    return `${this.requireConfig().publicBaseUrl}/api/auth/cas/callback`;
  }

  /** 学校登录页地址（302 目标） */
  loginUrl(): string {
    const cfg = this.requireConfig();
    return `${cfg.baseUrl}/login?service=${encodeURIComponent(this.serviceUrl())}`;
  }

  /** 本平台对外根地址（登出后回跳用） */
  appRootUrl(): string {
    return this.requireConfig().publicBaseUrl;
  }

  /**
   * 学校登出地址（302 目标）。
   * 文档：GET {认证地址}/authserver/logout?service=URLEncode(应用地址)
   */
  logoutUrl(service: string): string {
    const cfg = this.requireConfig();
    return `${cfg.baseUrl}/logout?service=${encodeURIComponent(service)}`;
  }

  /**
   * 校验 service ticket，成功返回学号/工号（及可选显示名），失败抛 401。
   * CAS 3.0 返回 XML（无 JSON 模式保证），用正则提取，不引入 XML 依赖。
   */
  async validateTicket(
    ticket: string,
  ): Promise<{ username: string; displayName?: string }> {
    const cfg = this.requireConfig();
    const url =
      `${cfg.baseUrl}${cfg.validatePath}` +
      `?ticket=${encodeURIComponent(ticket)}` +
      `&service=${encodeURIComponent(this.serviceUrl())}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const xml = await res.text();
    const failure = /<cas:authenticationFailure[^>]*>([\s\S]*?)<\/cas:authenticationFailure>/.exec(xml);
    if (failure) {
      throw new UnauthorizedException(
        `统一认证校验失败：${failure[1].trim().slice(0, 100)}`,
      );
    }
    const user = /<cas:user>([^<]+)<\/cas:user>/.exec(xml);
    if (!user) {
      throw new UnauthorizedException('统一认证返回格式无法识别');
    }
    // 尽量取真实姓名作显示名（不同学校属性名不同，取不到就用工号/学号）
    const displayName =
      /<cas:(?:cn|displayName|name)>([^<]+)<\/cas:(?:cn|displayName|name)>/.exec(
        xml,
      )?.[1];
    return { username: user[1].trim(), displayName: displayName?.trim() };
  }
}
