import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
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

export class EnrollStudentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  studentIds: string[];
}
