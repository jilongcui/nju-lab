import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * 标记「可选认证」接口。
 *
 * 用于公开课程页：带 token 时识别身份（回显「我的申请状态 / 是否已入册」），
 * 不带 token 或 token 无效时也照常放行（匿名可浏览）。
 *
 * 与 @Public() 的区别：@Public() 完全跳过认证，即使带了 token 也拿不到 user。
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
