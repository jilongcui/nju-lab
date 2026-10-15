import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DeckConfig, DeckSlide } from './deck.schema';

/**
 * 章节幻灯片的**历史版本快照**（2026-10-13 新增）。
 *
 * 为什么要有它：重生成会整体替换内容，而"哪一版更好"是**教师的主观判断** ——
 * 实测出现过"收紧约束后内容变少、教师更想要旧版"的情况。只靠代码里的覆盖写入，
 * 教师就只能靠运维从备份文件人工回滚。这个表让界面能直接列出历史版本并一键回滚。
 *
 * 设计要点：
 *   · **只增不删**（除非超上限或教师主动删）：每次"会覆盖现有内容"的操作前存一份快照，
 *     快照是**当时的完整内容**（slides 是内容真源），不依赖任何 diff 逻辑；
 *   · `promptVersion` 记录生成时的 prompt 口径（v8/v9/…）—— 教师看到"这版是 v9 收紧口径"
 *     就明白为什么内容少，不必靠时间猜；
 *   · `label`/`reason` 说明这版**怎么来的**（重新生成 / 优化重生成 / 手工保存 / 回滚前的存档）；
 *   · 外键 ON DELETE CASCADE：deck 没了，它的历史版本一起清（不会留孤儿）。
 */
@Entity('slide_deck_versions')
export class SlideDeckVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  deckId: string;

  /** 冗余一份 chapterId：按章节查历史版本是最高频的路径，省一次 join */
  @Index()
  @Column({ type: 'varchar', length: 36 })
  chapterId: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  /** 内容真源快照（与 slide_decks.slides 同构） */
  @Column({ type: 'json' })
  slides: DeckSlide[];

  @Column({ type: 'longtext', nullable: true })
  markdown: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  templateId: string | null;

  @Column({ type: 'json', nullable: true })
  config: DeckConfig | null;

  @Column({ type: 'int', nullable: true })
  tokensUsed: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  generatedBy: string | null;

  /** 生成这一版时的 prompt 版本（如 'v9'）—— 让教师看懂"这版是什么口径产出的" */
  @Column({ type: 'varchar', length: 16, nullable: true })
  promptVersion: string | null;

  /** 展示用标签，如「v9 口径 · 2026-10-13 12:30」 */
  @Column({ type: 'varchar', length: 120, default: '' })
  label: string;

  /** 这版是怎么来的：regenerate | optimize | manual-save | pre-restore | import */
  @Column({ type: 'varchar', length: 32, default: 'regenerate' })
  reason: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
