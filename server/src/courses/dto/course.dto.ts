import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ChapterStatus } from '../course.entity';

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  term?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  term?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** 公开链接标识；课程发布后锁定，不允许再改（保证已分享链接不失效） */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  slug?: string | null;

  /** 名额上限；null = 不限。判定口径是「已批准数」 */
  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number | null;

  /** 申请开放时间（ISO 字符串）；null = 不开放申请（纯展示） */
  @IsOptional()
  @IsDateString()
  applicationOpenAt?: string | null;

  /** 申请截止时间（ISO 字符串）；null = 不设截止 */
  @IsOptional()
  @IsDateString()
  applicationCloseAt?: string | null;
}

/** 创建/更新章节：带 id 时视为更新该章节 */
export class UpsertChapterDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order?: number;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exampleSkills?: string[];

  @IsOptional()
  @IsEnum(ChapterStatus)
  status?: ChapterStatus;
}

/**
 * 章节重排：按数组顺序把 `order` 重写为 `1..N`。
 * 必须传该课程的**全部**章节 id —— 漏传会被拒，避免"静默把某章挤到末尾"。
 * 顺带用于把历史遗留的重复/跳号 order 规范化（见 HANDOFF ⑦）。
 */
export class ReorderChaptersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  chapterIds: string[];
}

export class EnrollStudentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  studentIds: string[];
}
