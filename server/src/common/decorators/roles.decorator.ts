import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/user.entity';

export const ROLES_KEY = 'roles';

/** 限定接口允许的角色，配合全局 RolesGuard 使用 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
