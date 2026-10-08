import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 平台存储文件：模板、题目包、学生提交物（ZIP / .dshc）等 */
@Entity('stored_files')
export class StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  originalName: string;

  @Column()
  mimeType: string;

  /** 字节数（上传限制 100MB，int 足够） */
  @Column({ type: 'int' })
  size: number;

  /** 服务端在上传时计算的 sha256（完整性校验的权威值） */
  @Column({ length: 64 })
  sha256: string;

  /** 相对上传根目录的存储路径 */
  @Column()
  storagePath: string;

  @Index()
  @Column()
  uploaderId: string;

  @CreateDateColumn()
  createdAt: Date;
}

/** 文件对外信息（claim / 项目详情等响应中下发） */
export interface StoredFileInfo {
  fileId: string;
  url: string;
  originalName: string;
  size: number;
  sha256: string;
  mimeType: string;
  createdAt: string;
}
