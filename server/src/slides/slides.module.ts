import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chapter, Course } from '../courses/course.entity';
import { CoursesModule } from '../courses/courses.module';
import { SlideDeck } from './slide-deck.entity';
import { SlideTemplate } from './slide-template.entity';
import { ChapterSlidesController } from './slides.controller';
import { SlideTemplatesController } from './slide-templates.controller';
import { SlidesService } from './slides.service';

/**
 * 章节在线幻灯片（reveal.js）模块。
 *
 * - `CoursesModule` 用于复用**同一套权限口径**（`getOwnedCourse` / `assertEnrolled`），
 *   不在本模块里另写一份 owner 判断（权限判断出现第二份实现就是漂移的开始）。
 * - Chapter/Course 仓储只用于取章节正文与课程归属，不做业务写入。
 * - 生成用哪个模型、是否 mock，全在 `slides.config.ts` 从环境变量读（`SLIDES_GENERATOR=mock|llm`）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SlideDeck, SlideTemplate, Chapter, Course]),
    CoursesModule,
  ],
  controllers: [ChapterSlidesController, SlideTemplatesController],
  providers: [SlidesService],
  exports: [SlidesService],
})
export class SlidesModule {}
