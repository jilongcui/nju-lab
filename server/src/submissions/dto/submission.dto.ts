import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SubmitDto {
  /** 已上传的 Skill 包文件 id（POST /api/files 获得）。与 skillZipRef+skillZipSha256 直填二选一，优先使用 fileId */
  @IsOptional()
  @IsUUID()
  skillZipFileId?: string;

  /** 完整 Skill 目录包的存储引用（直填模式；fileId 模式下由服务端写为 file:<id>） */
  @IsOptional()
  @IsString()
  skillZipRef?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, { message: 'skillZipSha256 必须是 sha256 十六进制' })
  skillZipSha256?: string;

  /** 已上传的 .dshc 证据包文件 id */
  @IsOptional()
  @IsUUID()
  capsuleFileId?: string;

  /** .dshc 证据包的存储引用（直填模式） */
  @IsOptional()
  @IsString()
  capsuleRef?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, { message: 'capsuleSha256 必须是 sha256 十六进制' })
  capsuleSha256?: string;

  /** 会话审计事件（approval 对、permission/preset 提权日志） */
  @IsOptional()
  @IsArray()
  auditEvents?: unknown[];

  /** 提交时刻全部文件哈希登记（相对路径 -> sha256） */
  @IsOptional()
  @IsObject()
  fileHashes?: Record<string, string>;
}

export class GradeDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  teacherScore: number;

  @IsOptional()
  @IsString()
  teacherComment?: string;
}
