import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class EvalConfigDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  reasoningEffort?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];

  @IsOptional()
  timeoutSeconds?: number;
}

class RubricDimensionDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNotEmpty()
  weight: number;

  @IsOptional()
  @IsString()
  description?: string;
}

class UnlockRuleDto {
  @IsIn(['default', 'none', 'chapters'])
  type: 'default' | 'none' | 'chapters';

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  chapterIds?: string[];
}

class ProjectBaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title: string;

  @IsOptional()
  @IsString()
  objectives?: string;

  @IsOptional()
  @IsString()
  background?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  skillTemplateFileId?: string;

  @IsOptional()
  @IsUUID()
  problemFileId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EvalConfigDto)
  evalConfig?: EvalConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RubricDimensionDto)
  rubric?: RubricDimensionDto[];

  @IsOptional()
  @IsString()
  references?: string;

  @IsOptional()
  @IsString()
  faq?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UnlockRuleDto)
  unlockRule?: UnlockRuleDto;

  @IsOptional()
  @IsDateString()
  deadline?: string;
}

export class CreateProjectDto extends ProjectBaseDto {
  @IsUUID()
  chapterId: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title?: string;

  /**
   * 移动实验项目到同一课程内的其它章节（"挂错章节"的纠正路径）。
   * 跨课程移动不允许 —— 那会牵连解锁规则与课程归属，属于另一件事。
   */
  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsString()
  objectives?: string;

  @IsOptional()
  @IsString()
  background?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  skillTemplateFileId?: string;

  @IsOptional()
  @IsUUID()
  problemFileId?: string;

  @IsOptional()
  @IsObject()
  evalConfig?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  rubric?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  references?: string;

  @IsOptional()
  @IsString()
  faq?: string;

  @IsOptional()
  @IsObject()
  unlockRule?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  deadline?: string;
}
