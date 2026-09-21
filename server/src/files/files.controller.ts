import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * POST /api/files —— 上传文件（multipart，字段名 file），登录即可。
   * 返回 { fileId, url, originalName, size, sha256 }；sha256 为服务端计算的权威值。
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }),
  )
  async upload(
    @CurrentUser() user: User,
    @UploadedFile() file: UploadedFileLike,
  ) {
    const saved = await this.filesService.saveUploaded(user, file);
    return this.filesService.toInfo(saved);
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
