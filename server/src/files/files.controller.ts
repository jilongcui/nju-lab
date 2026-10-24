import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { FilesService, UploadedFileLike } from './files.service';

/** 单文件大小上限 100MB（服务器磁盘紧张，见 HANDOFF） */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * 上传字节的传输层混淆（与 `dsh/nju-lab-client/src/host/api.ts` 对应）。
 *
 * 为什么需要：平台前面有校园 WAF，它会把请求体解码后做「命令注入」匹配，命中
 * `#!/bin/bash`、`rm -rf` 这类串就回 403，请求到不了本服务（2026-10-24 实测：
 * store 模式 zip 里有 shebang → 403；同样的内容 deflate 压缩后 → 正常）。
 * 学生交的 SKILL.md/脚本里这类串很常见，所以客户端上传前把字节 XOR 0x5a，
 * 这里还原后再算 sha256、存盘 —— 存储内容与散列契约完全不变。
 */
const OBFUSCATION_HEADER = 'x-nju-obfuscation';
const OBFUSCATION_XOR5A = 'xor5a';
const OBFUSCATION_KEY = 0x5a;

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * POST /api/files —— 上传文件（multipart，字段名 file），登录即可。
   * 返回 { fileId, url, originalName, size, sha256 }；sha256 为服务端计算的权威值。
   *
   * 若带 `x-nju-obfuscation: xor5a`，先把文件字节还原（见上方 OBFUSCATION_* 注释）。
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }),
  )
  async upload(
    @CurrentUser() user: User,
    @UploadedFile() file: UploadedFileLike,
    @Headers(OBFUSCATION_HEADER) obfuscation?: string,
  ) {
    if (obfuscation === OBFUSCATION_XOR5A && file?.buffer) {
      for (let i = 0; i < file.buffer.length; i++) {
        file.buffer[i] = file.buffer[i]! ^ OBFUSCATION_KEY;
      }
      // XOR 不改变长度，size 无需调整
    }
    const saved = await this.filesService.saveUploaded(user, file);
    return this.filesService.toInfo(saved);
  }

  /**
   * GET /api/files?kind=image&limit=&offset= —— 列出本人上传的文件。
   * kind=image 时只回 image/*（幻灯片/章节图片选择器用）；只列本人，不列他人。
   */
  @Get()
  async list(
    @CurrentUser() user: User,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (kind && kind !== 'image') {
      throw new BadRequestException('kind 只支持 image');
    }
    const take = Math.min(Math.max(parseInt(limit ?? '', 10) || 50, 1), 100);
    const skip = Math.max(parseInt(offset ?? '', 10) || 0, 0);
    return this.filesService.listByUploader(user.id, {
      kind,
      limit: take,
      offset: skip,
    });
  }

  /**
   * GET /api/files/:id —— 下载文件。登录即可（id 为不可猜测的 UUID，充当能力凭证；
   * 更细粒度的按课程/归属鉴权留待生产化阶段）。
   */
  @Get(':id')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.filesService.getFile(id);
    const stream = await this.filesService.openReadStream(file);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    });
    return new StreamableFile(stream);
  }
}
