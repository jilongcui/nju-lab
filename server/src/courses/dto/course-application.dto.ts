import { IsOptional, IsString, MaxLength } from 'class-validator';

/** GET /api/browse/courses 的检索参数 */
export class CatalogCourseQueryDto {
  /** 关键词：匹配标题或简介 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;

  /** 学期 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  term?: string;
}

/** POST /api/courses/:courseId/applications/:id/reject */
export class RejectApplicationDto {
  /** 审批意见 / 驳回理由（可选） */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
