import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { DashboardService } from './dashboard.service';

@Controller('projects')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** GET /api/projects/:id/dashboard 班级视图数据（实验维度） */
  @Get(':id/dashboard')
  @Roles(UserRole.TEACHER)
  projectDashboard(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dashboardService.getProjectDashboard(user, id);
  }
}

@Controller('dashboard')
export class TeacherDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** GET /api/dashboard/teacher-summary 教师工作台汇总（含待批改列表） */
  @Get('teacher-summary')
  @Roles(UserRole.TEACHER)
  teacherSummary(@CurrentUser() user: User) {
    return this.dashboardService.getTeacherSummary(user);
  }
}
