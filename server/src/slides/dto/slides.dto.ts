import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
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
