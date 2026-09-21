import { User, UserRole } from '../../users/user.entity';

export interface RegisterInput {
  username: string;
  password: string;
  nickname: string;
  role: UserRole;
}

/**
 * 认证提供者抽象：业务代码（AuthService）只依赖本接口，不感知密码校验细节。
 *
 * 当前实现：LocalAuthProvider（独立账号体系，bcryptjs 哈希）。
 * 后期接学校统一认证（CAS / OAuth / LDAP）时，新增一个实现本接口的 Provider，
 * 在 AuthModule 中把 AUTH_PROVIDER 的 useClass 换掉即可，无需改动业务代码。
 */
export interface AuthProvider {
  readonly name: string;

  /** 校验登录凭证，成功返回用户，失败返回 null */
  validateCredentials(username: string, password: string): Promise<User | null>;

  /** 注册新用户（统一认证体系下可能不支持，由对应 Provider 决定是否实现） */
  register(input: RegisterInput): Promise<User>;

  /** 修改密码（本地账号体系实现；统一认证体系下不实现，平台返回不支持） */
  setPassword?(userId: string, newPassword: string): Promise<void>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
