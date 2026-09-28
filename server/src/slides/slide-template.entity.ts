import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeckConfig } from './deck.schema';
import { TemplateDesign } from './template.schema';

// 设计参数（TemplateDesign）与内置模板定义都在 template.schema.ts —— 那里同时负责
// 窄字符集校验与「参数 → CSS」编译（模板值会进学生浏览器，安全边界必须集中在一处）。

/**
 * 幻灯片模板。
 * `courseId = null` 表示**内置模板**（全局，代码里预置、不可改，只能"另存为"课程级模板）。
 */
@Entity('slide_templates')
export class SlideTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** null = 内置模板 */
  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  courseId: string | null;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  /** reveal 主题基座（白名单见 template.schema.ts，刻意排除内嵌字体的 black 系列） */
  @Column({ type: 'varchar', length: 32, default: 'simple' })
  baseTheme: string;

  @Column({ type: 'json', nullable: true })
  design: TemplateDesign | null;

  /** 该模板建议的 reveal 配置（换模板时可一并套用，教师仍可覆盖） */
  @Column({ type: 'json', nullable: true })
  config: DeckConfig | null;

  @Column({ type: 'boolean', default: false })
  isBuiltin: boolean;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
