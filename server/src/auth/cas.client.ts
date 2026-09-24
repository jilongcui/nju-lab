import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

/** CAS 校验诊断日志（记录认证机原始报文，用于确认属性名） */
const logger = new Logger('CasClient');

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

    // 【属性探测】记录认证机返回的原始报文 + 其中释放的全部属性。
    // 目的：确认南大认证机到底有没有返回身份（教师/学生）字段、字段叫什么名字——
    // 属性名由学校属性释放策略决定，各校不同，只能实测。确认完毕后本段可删除。
    logger.log(`CAS 校验原始响应: ${xml.replace(/\s*\n\s*/g, ' ').trim()}`);
    logger.log(`CAS 属性解析: ${JSON.stringify(this.parseAttributes(xml))}`);

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

  /**
   * 提取 <cas:attributes> 内的全部属性为键值对。
   * 认证机未返回属性节点时返回空对象。
   */
  private parseAttributes(xml: string): Record<string, string> {
    const block = /<cas:attributes>([\s\S]*?)<\/cas:attributes>/.exec(xml);
    if (!block) {
      return {};
    }
    const attributes: Record<string, string> = {};
    const re = /<cas:([A-Za-z0-9_.-]+)>([\s\S]*?)<\/cas:\1>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(block[1])) !== null) {
      attributes[match[1]] = match[2].trim();
    }
    return attributes;
  }
}
