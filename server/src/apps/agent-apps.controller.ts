import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Options,
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
import { Public } from '../common/decorators/public.decorator';
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

  /** 从"已提交的 Skill 包"一键创建应用（平台自动装包、发布、给分享链接） */
  @Post('from-submission')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  fromSubmission(
    @CurrentUser() user: User,
    @Body()
    dto: { submissionId?: string; assignmentId?: string; title?: string; courseId?: string },
  ) {
    return this.service.createFromSubmission(user, dto);
  }

  /** 我可以用哪些提交来创建应用 */
  @Get('skill-submissions')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  skillSubmissions(@CurrentUser() user: User) {
    return this.service.listSkillSubmissions(user);
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

  @Delete(':id')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user, id);
  }

  /** 平台模型代理（容器用一次性 token 调，不是 JWT）：公开路由 + 自己校验 token */
  @Public()
  @Post('llm/chat')
  llmChat(
    @Headers('x-app-token') token: string,
    @Body()
    payload: { messages?: unknown; max_tokens?: number; temperature?: number; reasoning_effort?: string },
  ) {
    return this.service.llmChat(token, payload);
  }

  @Get(':id/usage')
  usage(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.usageOf(user, id);
  }

  @Get(':id/versions')
  versions(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listVersions(user, id);
  }

  /** 回滚到某历史版本（发布态不变，容器重建后用该版本） */
  @Post(':id/versions/:versionId/activate')
  activate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.service.activateVersion(user, id, versionId);
  }

  @Get(':id/review')
  review(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getReview(user, id);
  }

  @Post(':id/review')
  @Roles(UserRole.TEACHER)
  createReview(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { total: number; dimensions?: never; comment?: string },
  ) {
    return this.service.review(user, id, dto as never);
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

/**
 * 分享链接（**匿名可看**）—— 第 20 章"学生把应用分享出去"的落地。
 *
 * 边界（设计见 `docs/DESIGN-2026-11-agent-app-platform.md` §9）：
 * - 只有「已发布 + 有 shareKey」的应用能被匿名访问；下架即失效（`shareKey` 被清空）；
 * - 匿名侧只暴露 title / scenario / theme / 附件类型，**不暴露学生与课程归属**；
 * - 对话通道限流更紧（每链接每分钟 20 次），避免被当成免费模型入口。
 */
@Controller('apps/share')
export class AgentAppShareController {
  constructor(private readonly service: AgentAppsService) {}

  @Public()
  @Get(':key')
  meta(@Param('key') key: string) {
    return this.service.sharedMeta(key);
  }

  @Public()
  @Get(':key/site')
  async siteIndex(@Param('key') key: string, @Res() res: Response) {
    const asset = await this.service.siteAssetByShareKey(key, 'index.html');
    this.cors(res);
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Content-Length', String(asset.body.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(asset.body);
  }

  /**
   * 分享页在 **iframe sandbox（opaque origin）** 里运行：它没有平台的 cookie/token，
   * 调匿名对话口子算跨域 —— 所以这几个端点必须放行 CORS。
   * 只放行分享口子（匿名 + 限流），登录态端点不放。
   */
  private cors(res: Response): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  @Public()
  @Options(':key/api/chat')
  preflight(@Res() res: Response) {
    this.cors(res);
    res.status(204).end();
  }

  @Public()
  @Get(':key/site/:file')
  async site(
    @Param('key') key: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const asset = await this.service.siteAssetByShareKey(key, file);
    this.cors(res);
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Content-Length', String(asset.body.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(asset.body);
  }

  @Public()
  @Post(':key/api/chat')
  async chat(
    @Param('key') key: string,
    @Body() payload: ChatPayload,
    @Res() res: Response,
  ) {
    const data = await this.service.chatByShareKey(key, payload);
    this.cors(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 0, data, message: 'ok' }));
  }
}
