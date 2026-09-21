import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Roles(UserRole.TEACHER)
  create(@CurrentUser() user: User, @Body() dto: CreateProjectDto) {
    return this.projectsService.createProject(user, dto);
  }

  /** 教师侧实验项目总列表（跨课程） */
  @Get()
  @Roles(UserRole.TEACHER)
  list(@CurrentUser() user: User) {
    return this.projectsService.listProjects(user);
  }

  @Get(':id')
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.getProject(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.TEACHER)
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.TEACHER)
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.removeProject(user, id);
  }

  @Post(':id/publish')
  @Roles(UserRole.TEACHER)
  publish(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.publishProject(user, id);
  }

  @Get(':id/submissions')
  @Roles(UserRole.TEACHER)
  submissions(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.listProjectSubmissions(user, id);
  }
}

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** 领取：校验 unlockRule，返回模板 + 数据集 + eval_config */
  @Post(':id/claim')
  @Roles(UserRole.STUDENT)
  claim(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.claimAssignment(user, id);
  }
}

@Controller('me')
export class MeAssignmentsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** GET /api/me/assignments 任务列表（含解锁状态） */
  @Get('assignments')
  @Roles(UserRole.STUDENT)
  myAssignments(@CurrentUser() user: User) {
    return this.projectsService.getMyAssignments(user);
  }
}
