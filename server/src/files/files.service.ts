import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { createReadStream, ReadStream } from 'fs';
import { extname, join, resolve } from 'path';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { StoredFile, StoredFileInfo } from './stored-file.entity';

/** multer memoryStorage 上传文件（避免依赖 @types/multer，只声明用到的字段） */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(StoredFile)
    private readonly fileRepo: Repository<StoredFile>,
  ) {}

  /** 上传根目录：默认 server/uploads，可用 UPLOAD_DIR 覆盖 */
  get uploadDir(): string {
    return resolve(process.env.UPLOAD_DIR || 'uploads');
  }

  /** POST /api/files —— 保存上传文件并计算 sha256（服务端权威值） */
  async saveUploaded(
    uploader: User,
    file: UploadedFileLike,
  ): Promise<StoredFile> {
    if (!file || !file.buffer) {
      throw new BadRequestException('缺少上传文件（multipart 字段名 file）');
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const entity = this.fileRepo.create({
      originalName: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      sha256,
      storagePath: '',
      uploaderId: uploader.id,
    });
    const saved = await this.fileRepo.save(entity);

    // 按 sha256 前缀分目录，文件名保留原始扩展名
    const ext = extname(file.originalname).slice(0, 16);
    const relPath = join(sha256.slice(0, 2), `${saved.id}${ext}`);
    const absPath = join(this.uploadDir, relPath);
    await mkdir(resolve(absPath, '..'), { recursive: true });
    await writeFile(absPath, file.buffer);

    saved.storagePath = relPath;
    return this.fileRepo.save(saved);
  }

  async getFile(id: string): Promise<StoredFile> {
    const file = await this.fileRepo.findOne({ where: { id } });
    if (!file) {
      throw new NotFoundException('文件不存在');
    }
    return file;
  }

  async openReadStream(file: StoredFile): Promise<ReadStream> {
    return createReadStream(join(this.uploadDir, file.storagePath));
  }

  /** 对外下发的文件信息（下载地址 + 服务端 sha256） */
  toInfo(file: StoredFile): StoredFileInfo {
    return {
      fileId: file.id,
      url: `/api/files/${file.id}`,
      originalName: file.originalName,
      size: file.size,
      sha256: file.sha256,
    };
  }

  /** 按 id 取对外信息；空 id 或文件不存在返回 null（用于项目模板/数据集等可空关联） */
  async infoOrNull(fileId: string | null): Promise<StoredFileInfo | null> {
    if (!fileId) {
      return null;
    }
    const file = await this.fileRepo.findOne({ where: { id: fileId } });
    return file ? this.toInfo(file) : null;
  }
}
