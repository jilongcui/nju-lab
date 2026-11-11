import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { ChatPayload, AgentAppsService } from './agent-apps.service';

/**
 * 学生应用（第 20 章）—— 学生侧接口。
 *
 * 与工作台（`/workspace`）同一套约定：**预览与对话都由后端反代容器**，
 * 浏览器只跟 `/lab/api/apps/...` 打交道，因此**不需要改 nginx**。
 * `site/:file` 会把学生前端当静态页发给 iframe（并注入 base + api 前缀）。
 */
@Controller('apps')
export class AgentAppsController {
  constructor(private readonly service: AgentAppsService) {}

  @Post()
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  create(
    @CurrentUser() user: User,
    @Body() dto: { title: string; scenario?: string; courseId?: string; projectId?: string },
  ) {
    return this.service.create(user, dto);
  }

  @Get('mine')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  mine(@CurrentUser() user: User) {
    return this.service.listMine(user);
  }

  @Get(':id')
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, never>,
  ) {
    return this.service.update(user, id, dto as never);
  }

  /** 上传一版产物（zip）：根目录要有 `app.json` 与 `harness/api.py` */
  @Post(':id/versions')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { originalname: string; buffer: Buffer; size: number },
    @Body('note') note?: string,
  ) {
    if (!file) throw new BadRequestException('缺少上传文件（字段名 file）');
    return this.service.uploadVersion(user, id, file, note);
  }

  @Post(':id/publish')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  publish(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.publish(user, id);
  }

  @Post(':id/unpublish')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  unpublish(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.unpublish(user, id);
  }

  @Post(':id/start')
  start(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.start(user, id);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listMessages(user, id, Number(limit || 200));
  }

  /** iframe 预览用的静态资源（默认 index.html） */
  @Get(':id/site/:file')
  async site(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const asset = await this.service.siteAsset(user, id, file);
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Content-Length', String(asset.body.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(asset.body);
  }

  @Get(':id/site')
  async siteIndex(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const asset = await this.service.siteAsset(user, id, 'index.html');
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Content-Length', String(asset.body.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(asset.body);
  }

  /** 对话：附件用 base64 传，后端转 multipart 给容器 */
  @Post(':id/api/chat')
  chat(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: ChatPayload,
  ) {
    return this.service.chat(user, id, payload);
  }
}

/** 教师侧：按课程看学生应用 */
@Controller('courses/:courseId/apps')
export class CourseAgentAppsController {
  constructor(private readonly service: AgentAppsService) {}

  @Get()
  @Roles(UserRole.TEACHER)
  list(
    @CurrentUser() user: User,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.service.listByCourse(user, courseId);
  }
}
