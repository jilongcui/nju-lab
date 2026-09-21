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
