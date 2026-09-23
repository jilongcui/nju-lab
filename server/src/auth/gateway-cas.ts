/**
 * 上游网关注入的 CAS 身份头解析。
 *
 * medai.nju.edu.cn 之前有一层学校统一认证网关：浏览器未登录时被 302 到
 * authserver.nju.edu.cn，登录成功后网关把身份写进请求头再转发到本机
 * （Dify 侧同一套机制，见 /home/ubuntu/dify/api/controllers/console/auth/login.py）。
 *
 * 因此本平台无需自己再跑一遍 CAS 重定向流——只要网关头在，就是可信的已认证身份。
 * 头名以 nginx 侧写法为准：CAS-USER（学号/工号）、CAS-USER-CN（中文姓名，URL 编码）。
 */

/** 学号/工号 */
export const GATEWAY_CAS_USER_HEADER = 'cas-user';
/** 中文姓名（网关做了 URL 编码） */
export const GATEWAY_CAS_NAME_HEADER = 'cas-user-cn';

export interface GatewayCasUser {
  username: string;
  displayName?: string;
}

type HeaderBag = Record<string, string | string[] | undefined>;

/** HTTP 头名不区分大小写：先按键原样取，取不到再逐个忽略大小写比对 */
function headerValue(headers: HeaderBag, name: string): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct[0] : direct;
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/** 中文姓名由网关 URL 编码（如 %E6%B5%8B%E8%AF%95）；解不开就按原样用 */
function decodeName(raw: string): string {
  const trimmed = raw.trim();
  try {
    return decodeURIComponent(trimmed).trim();
  } catch {
    return trimmed;
  }
}

/**
 * 从请求头提取网关注入的 CAS 用户；网关头不存在或学号为空时返回 null
 * （null 表示"不是经网关来的请求"，调用方应回退到 CAS 重定向流）。
 *
 * 注意：只解姓名、不解学号——学号本身就是明文标识（与 Dify 侧行为一致）。
 */
export function gatewayCasUserFromHeaders(
  headers: HeaderBag,
): GatewayCasUser | null {
  const rawUser = headerValue(headers, GATEWAY_CAS_USER_HEADER);
  if (!rawUser) {
    return null;
  }
  const username = rawUser.trim();
  if (!username) {
    return null;
  }
  const rawName = headerValue(headers, GATEWAY_CAS_NAME_HEADER);
  const displayName = rawName ? decodeName(rawName) : '';
  return displayName ? { username, displayName } : { username };
}
