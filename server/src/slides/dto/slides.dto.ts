import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { DeckConfig, SlideJson } from '../deck.schema';
import { TemplateDesign } from '../template.schema';

/**
 * 幻灯片接口的请求体（DTO 只做平面字段校验；`slides` 这种深层结构由 deck.schema 手写校验，
 * 它在 service 里被调用，错误信息也更贴近"第几页哪里不对"）。
 */

export class GenerateDeckDto {
  /** 指定模板（内置 id 或本课程自定义模板 id）；不填用平台默认 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  templateId?: string;

  /** 强制重新生成，忽略缓存命中（同内容重复生成会烧额度，默认 false） */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  force?: boolean;

  /**
   * 教师的额外要求（可选提示词，≤500 字）：注入生成 prompt，用于精确控制
   * （例：「第 3 页改成两栏对比」「多用图表，少用要点列表」）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instruction?: string;

  /**
   * 生成模式：
   *   · `fresh`（默认）= 从章节正文**重新规划**页面结构；
   *   · `optimize` = **沿用现有页面结构**（页序 / intent / 标题都不动），只重写内容并满足 `instruction` ——
   *     多次重生成时改动可控、改进能累积（见 docs/DESIGN-2026-10-11-course-co-teachers.md 相关说明）。
   */
  @IsOptional()
  @IsIn(['fresh', 'optimize'])
  mode?: 'fresh' | 'optimize';

  /**
   * 乐观锁：客户端加载时拿到的 deck 版本。生成会整体替换内容，
   * 若期间别人已保存/生成过（版本不符）→ 409，避免互相覆盖 + 白烧 token。
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  version?: number;
}

export class RegeneratePageDto {
  /** 要重新生成的页码（0 基） */
  @IsInt()
  @Min(0)
  @Type(() => Number)
  index!: number;

  /** 本页的额外要求（可选提示词，≤500 字）：如「改成左右两栏对照」「这张图换到右侧」 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instruction?: string;
}

export class SaveDeckDto {
  /** 结构化内容（与 markdown 二选一；同时给时**以 slides 为准**并提示） */
  @IsOptional()
  @IsArray()
  slides?: SlideJson[];

  /** Markdown 视图内容：走 mergeMarkdown，页级高级设置按位次保留 */
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  markdown?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  /** 乐观锁：客户端加载时拿到的 deck 版本；不符 → 409（见设计文档 §5） */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  version?: number;

  /** 内置模板 id 或本课程自定义模板 id；显式 null 表示恢复平台默认 */
  @IsOptional()
  templateId?: string | null;

  @IsOptional()
  @IsObject()
  config?: DeckConfig;
}

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  /** 从一个内置模板"另存为"（推荐路径）：以它的 design/config 为底 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fromBuiltinId?: string;

  /** 不基于内置模板时，可直接给设计参数 */
  @IsOptional()
  @IsObject()
  design?: Partial<TemplateDesign>;

  @IsOptional()
  @IsObject()
  config?: DeckConfig;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsObject()
  design?: Partial<TemplateDesign>;

  @IsOptional()
  @IsObject()
  config?: DeckConfig;
}

/** 回滚到历史版本 */
export class RestoreDeckVersionDto {
  /** 乐观锁：客户端加载时拿到的 deck 版本（不一致说明别人改过，给 409） */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  version?: number;
}

/**
 * 只更新某一页的**讲稿**（notes）—— 讲稿是讲者的话，不进版面，
 * 因此不跟"改内容块"走同一条整体替换路径：整体替换会牵动版式校验，
 * 而且冲突面大（两个人分别改不同页的讲稿不该互相阻塞）。
 */
export class UpdatePageNotesDto {
  /** 讲稿正文；留空表示删除该页讲稿 */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  /** 乐观锁：客户端持有的 deck 版本 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  version?: number;
}

/**
 * 预览态「双击就地编辑」：按路径更新某一页的**单个文本字段**。
 *
 * path 形如 `title` / `lede` / `blocks.2.text` / `blocks.1.items.0`。
 * 之所以不整体替换 slides：就地编辑只碰一个字符串，整体替换会牵动版式校验、冲突面也大。
 * 允许的字段在 service 里用白名单正则卡住（只放纯文本字段）。
 */
export class UpdatePageFieldDto {
  /** 字段路径（白名单见 SlidesService.EDITABLE_FIELD_PATH） */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  path!: string;

  /** 新的文本；留空表示清空该字段 */
  @IsOptional()
  @IsString()
  @MaxLength(600)
  value?: string;

  /** 乐观锁：客户端持有的 deck 版本 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  version?: number;
}
