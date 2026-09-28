import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { GenerateDeckDto, SaveDeckDto } from './dto/slides.dto';
import { SlidesService } from './slides.service';

/**
 * 章节幻灯片接口（挂在既有章节资源下，契约见设计文档 §12）。
 *
 * 权限：读对师生开放（学生需"章节已发布 + 在课程名单里"，由 service 判定）；
 * 写限课程教师 —— `@Roles(TEACHER)` 对 admin 放行（RolesGuard 的既有行为）。
 */
@Controller('chapters')
export class ChapterSlidesController {
  constructor(private readonly slidesService: SlidesService) {}

  @Get(':chapterId/slides')
  get(
    @CurrentUser() user: User,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    return this.slidesService.getDeck(user, chapterId);
  }

  /** 触发两阶段生成（异步：立即返回 GENERATING，前端轮询） */
  @Post(':chapterId/slides/generate')
  @Roles(UserRole.TEACHER)
  generate(
    @CurrentUser() user: User,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: GenerateDeckDto,
  ) {
    return this.slidesService.generate(user, chapterId, dto);
  }

  /** 保存内容（slides 或 markdown 二选一）、标题、模板、放映配置 */
  @Put(':chapterId/slides')
  @Roles(UserRole.TEACHER)
  save(
    @CurrentUser() user: User,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: SaveDeckDto,
  ) {
    return this.slidesService.save(user, chapterId, dto);
  }

  /** 「保留现有 deck，仅对齐章节基准哈希」（章节改了但不想重生成时用） */
  @Post(':chapterId/slides/sync-hash')
  @Roles(UserRole.TEACHER)
  syncHash(
    @CurrentUser() user: User,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    return this.slidesService.syncChapterHash(user, chapterId);
  }

  @Delete(':chapterId/slides')
  @Roles(UserRole.TEACHER)
  remove(
    @CurrentUser() user: User,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    return this.slidesService.removeDeck(user, chapterId);
  }
}
