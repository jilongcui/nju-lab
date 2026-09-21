import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from './user.entity';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** GET /api/me 返回当前登录用户 */
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.usersService.sanitize(user);
  }

  /** GET /api/users/students 学生名单（教师选课用；管理员由 RolesGuard 放行） */
  @Get('users/students')
  @Roles(UserRole.TEACHER)
  listStudents() {
    return this.usersService.listStudents();
  }
}
