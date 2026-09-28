import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRole } from '../users/user.entity';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/slides.dto';
import { SlidesService } from './slides.service';

/**
 * 幻灯片模板接口（设计文档 §12）。
 *
 * 模板分两类：
 *   · **内置模板**（id 形如 `builtin-*`，代码常量，不入库）—— 可选用，但**不可改不可删**，只能"另存为"；
 *   · **课程级自定义模板**（落库，`courseId` 归属课程）—— 可改可删，仅本课程可用。
 * 模板只承载"调参"（配色/字体/页脚/圆角…），CSS 由服务端用窄字符集校验后编译，不存整段 CSS。
 */
@Controller('slide-templates')
@Roles(UserRole.TEACHER)
export class SlideTemplatesController {
  constructor(private readonly slidesService: SlidesService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.slidesService.listTemplates(user, courseId);
  }

  /** 从内置模板"另存为"课程模板（也可直接给 design） */
  @Post()
  create(
    @CurrentUser() user: User,
    @Query('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.slidesService.createTemplate(user, courseId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.slidesService.updateTemplate(user, id, dto);
  }

  /** 删除自定义模板；被 deck 引用时会自动解绑回落默认，并回报解绑数量 */
  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.slidesService.deleteTemplate(user, id);
  }
}
