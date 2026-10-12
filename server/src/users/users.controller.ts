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

  /** GET /api/users/teachers 教师名单（教师可见：转让课程、指定协作教师都要选人） */
  @Get('users/teachers')
  @Roles(UserRole.TEACHER)
  listTeachers() {
    return this.usersService.listTeachers();
  }
}
