import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeckConfig, DeckSlide } from './deck.schema';

/**
 * deck 状态机（与平台既有的 `verifying` 一类状态机同风格）。
 * 生成是异步的（10–60s），接口立即返回 GENERATING，前端轮询直到 READY / FAILED。
 */
export enum SlideDeckStatus {
  /** 还没有 deck（章节刚建或删过） */
  EMPTY = 'empty',
  GENERATING = 'generating',
  READY = 'ready',
  FAILED = 'failed',
}

/**
 * 章节课件（**一章一 deck**，见设计文档 §5）。
 *
 * 真源是 `slides`（结构化 JSON）；`markdown` 是它的投影缓存，两者由 service 保证一致
 * （教师用 MD 视图保存时走 `mergeMarkdown`，高级字段不会被悄悄丢掉）。
 */
@Entity('slide_decks')
export class SlideDeck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  courseId: string;

  /** 一章一 deck：唯一索引（v1 不做多版本，见设计文档 §14） */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 36 })
  chapterId: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  /** 内容真源 */
  @Column({ type: 'json', nullable: true })
  slides: DeckSlide[] | null;

  /** Markdown 投影（由 slides 生成/教师编辑后的缓存） */
  @Column({ type: 'longtext', nullable: true })
  markdown: string | null;

  /** null = 用平台默认模板；课程级自定义模板见 SlideTemplate */
  @Column({ type: 'varchar', length: 36, nullable: true })
  templateId: string | null;

  @Column({ type: 'json', nullable: true })
  config: DeckConfig | null;

  @Column({ type: 'enum', enum: SlideDeckStatus, default: SlideDeckStatus.EMPTY })
  status: SlideDeckStatus;

  /** 'llm' | 'manual'：谁产出的当前内容 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  generatedBy: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string | null;

  /** 本次生成消耗（prompt + completion），仅用于成本可见性 */
  @Column({ type: 'int', nullable: true })
  tokensUsed: number | null;

  /**
   * 生成时章节正文的 sha256 —— 用于"章节内容已变更"提示（§9）。
   * **只用于提示**：绝不据此自动重生成（会烧额度、并覆盖教师的手工编辑）。
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  basedOnChapterHash: string | null;

  /**
   * 缓存键 = sha256(章节正文 + 模型 + prompt 版本)。
   * 与 `basedOnChapterHash` 分开是职责不同：那个管"要不要提示教师内容变了"，
   * 这个管"这次生成能不能直接复用"—— 换模型或改 prompt（版本号 +1）都必须重新生成。
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceHash: string | null;

  /** 失败原因（可直接回前端展示；不含 key 等敏感信息） */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** 非致命提示（如"某批扩写失败，已用大纲兜底"）—— 与 error 分开，避免把提示当失败 */
  @Column({ type: 'text', nullable: true })
  warnings: string | null;

  @Column({ type: 'varchar', length: 36 })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
