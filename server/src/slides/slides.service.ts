import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { Chapter, ChapterStatus, Course } from '../courses/course.entity';
import { CoursesService } from '../courses/courses.service';
import { buildConflictError } from '../common/content-conflict';
import { User, UserRole } from '../users/user.entity';
import { mergeMarkdown, toMarkdown } from './deck-markdown';
import {
  DEFAULT_DECK_CONFIG,
  DeckConfig,
  DeckSlide,
  DeckValidationError,
  SlideJson,
  normalizeSlides,
  validateDeckConfig,
} from './deck.schema';
import { isSemanticDeck, semanticToMarkdown, validateSemanticPages, type SemanticPage } from './semantic.schema';
import { llmDiagnostics } from './llm.client';
import { SlideDeck, SlideDeckStatus } from './slide-deck.entity';
import { SlideDeckVersion } from './slide-deck-version.entity';
import { SlideTemplate } from './slide-template.entity';
import {
  SLIDES_GENERATE_PER_HOUR,
  SLIDES_GENERATOR,
  SLIDES_LIMITS,
  SLIDES_MODEL,
  MAX_DECK_VERSIONS,
  SLIDES_PROMPT_VERSION,
} from './slides.config';
import {
  DeckSource,
  OutlineSlide,
  createDeckGenerator,
  extractChapterImages,
} from './slides.generator';
import {
  BUILTIN_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  TemplateDesign,
  TemplateValidationError,
  designToCss,
  findBuiltinTemplate,
  isAllowedBaseTheme,
  validateTemplateDesign,
} from './template.schema';
import {
  CreateTemplateDto,
  GenerateDeckDto,
  SaveDeckDto,
  UpdateTemplateDto,
} from './dto/slides.dto';

/**
 * 章节幻灯片（reveal.js）业务逻辑。
 *
 * 边界与纪律（设计文档 §9/§11/§12）：
 *   · 权限口径**复用 CoursesService**（`getOwnedCourse` / `assertEnrolled`），不在这里另写一套
 *   · 生成是异步的：先把状态置 GENERATING 落库再返回，后台任务完成后写回 READY/FAILED
 *   · 缓存键 `sourceHash = sha256(正文 + 模型 + prompt 版本)`；命中直接复用，`force` 才重跑
 *   · **绝不自动重生成**：章节改了只提示（`chapterChanged`），由教师决定
 *   · 模板只存"调参"，CSS 由 `designToCss` 编译（窄字符集校验后的值才会进 CSS）
 */

/** 历史版本列表项（不含 slides 全量，避免列表接口过大；要看内容用"预览/回滚"） */
export interface DeckVersionView {
  id: string;
  title: string;
  pages: number;
  label: string;
  reason: string;
  promptVersion: string | null;
  tokensUsed: number | null;
  model: string | null;
  generatedBy: string | null;
  createdAt: Date;
}

export interface DeckView {
  id: string;
  chapterId: string;
  courseId: string;
  title: string;
  /** v2（语义模型）或 v1（旧版式模型）—— 两者共用同一列，前端按此分流渲染与编辑能力 */
  slides: DeckSlide[];
  /** true = 语义 deck：Markdown 只是只读预览，编辑面收窄为「换主题 / 重生成当前页」 */
  semantic: boolean;
  markdown: string;
  templateId: string | null;
  config: Required<DeckConfig> & DeckConfig;
  status: SlideDeckStatus;
  generatedBy: string | null;
  model: string | null;
  tokensUsed: number | null;
  basedOnChapterHash: string | null;
  error: string | null;
  warnings: string | null;
  updatedAt: Date;
  /** 乐观锁版本：前端保存/生成时原样带回，不符会拿到 409（见设计文档 §5） */
  version: number;
  /** 最后一次写入者（userId）—— 前端冲突提示据此显示「被谁改了」 */
  updatedBy: string | null;
}

export interface TemplateView {
  id: string;
  name: string;
  description: string | null;
  baseTheme: string;
  design: TemplateDesign;
  css: string;
  config: DeckConfig | null;
  isBuiltin: boolean;
}

interface ResolvedTemplate {
  id: string;
  name: string;
  description: string | null;
  baseTheme: string;
  design: TemplateDesign;
  css: string;
  config: DeckConfig | null;
  isBuiltin: boolean;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

@Injectable()
export class SlidesService {
  private readonly logger = new Logger(SlidesService.name);

  /**
   * 生成频次护栏：进程内滑动窗口。
   * 平台是单进程 systemd 部署，够用；将来若多实例，这里要换成落库计数（已在设计文档 §8 记下）。
   */
  private readonly generateLog = new Map<string, number[]>();

  constructor(
    @InjectRepository(SlideDeck)
    private readonly deckRepo: Repository<SlideDeck>,
    @InjectRepository(SlideDeckVersion)
    private readonly versionRepo: Repository<SlideDeckVersion>,
    @InjectRepository(SlideTemplate)
    private readonly templateRepo: Repository<SlideTemplate>,
    @InjectRepository(Chapter)
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Course)
    private readonly courseRepo: Repository<Course>,
    /** 冲突提示要显示「被谁改了」，因此需要按 updatedBy 取昵称 */
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly coursesService: CoursesService,
  ) {}

  // ------------------------------------------------------------ 读取

  async getDeck(user: User, chapterId: string) {
    const chapter = await this.loadChapter(chapterId);
    const canEdit = await this.canEdit(user, chapter.courseId);
    await this.assertChapterAccess(user, chapter, canEdit);

    const deck = await this.deckRepo.findOne({ where: { chapterId } });
    const chapterHash = sha256(chapter.content ?? '');
    const template = await this.resolveTemplate(
      chapter.courseId,
      deck?.templateId ?? null,
    );

    return {
      deck: deck ? this.toDeckView(deck) : null,
      chapterHash,
      /** 生成之后章节又被改过 —— 只提示，不自动重生成 */
      chapterChanged: !!deck?.basedOnChapterHash && deck.basedOnChapterHash !== chapterHash,
      template: this.toTemplateView(template),
      /** 学生不需要模板清单（也不能枚举课程模板） */
      templates: canEdit ? await this.listCourseTemplates(chapter.courseId) : [],
      canEdit,
      generator:
        SLIDES_GENERATOR === 'llm'
          ? llmDiagnostics()
          : { generator: 'mock', baseUrl: null, model: 'mock', keyEnv: null, keyConfigured: true },
    };
  }

  // ------------------------------------------------------------ 生成

  async generate(user: User, chapterId: string, dto: GenerateDeckDto) {
    // 乐观锁（见设计文档 §5）：生成会整体替换内容，同样要防「两人同时点生成」互相覆盖
    {
      const existing = await this.deckRepo.findOne({ where: { chapterId } });
      if (
        existing &&
        dto.version !== undefined &&
        dto.version !== existing.version
      ) {
        await this.throwDeckConflict(existing);
      }
    }
    const chapter = await this.loadChapter(chapterId);
    const course = await this.coursesService.getOwnedCourse(user, chapter.courseId);

    if (!chapter.content?.trim()) {
      throw new BadRequestException('章节还没有正文内容，先写点内容再生成幻灯片');
    }

    const chapterHash = sha256(chapter.content);
    const instruction = (dto.instruction ?? '').trim();
    /** 优化模式 = 沿用现有页结构只重写内容（与 fresh 的结果必然不同，缓存键要区分开） */
    const optimize = dto.mode === 'optimize';
    const sourceHash = sha256(
      `${chapter.content}\u0000${SLIDES_GENERATOR === 'llm' ? SLIDES_MODEL : 'mock'}\u0000${SLIDES_PROMPT_VERSION}` +
        `\u0000${optimize ? 'optimize' : 'fresh'}\u0000${instruction}`,
    );

    let deck = await this.deckRepo.findOne({ where: { chapterId } });

    if (
      deck &&
      !dto.force &&
      deck.status === SlideDeckStatus.READY &&
      deck.sourceHash === sourceHash
    ) {
      // 同内容 + 同模型 + 同 prompt 版本：直接复用，不重复烧额度
      return { deck: this.toDeckView(deck), cached: true };
    }
    if (deck?.status === SlideDeckStatus.GENERATING && !dto.force) {
      throw new ConflictException('该章节正在生成中，请稍候');
    }

    const templateId =
      dto.templateId !== undefined ? dto.templateId || null : deck?.templateId ?? null;
    await this.assertTemplateUsable(templateId, course.id, user);
    this.assertRateLimit(course.id);

    if (!deck) {
      deck = this.deckRepo.create({
        courseId: course.id,
        chapterId,
        title: chapter.title,
        createdBy: user.id,
        status: SlideDeckStatus.EMPTY,
      });
    }
    deck.status = SlideDeckStatus.GENERATING;
    deck.error = null;
    deck.warnings = null;
    deck.templateId = templateId;
    deck.model = SLIDES_GENERATOR === 'llm' ? SLIDES_MODEL : 'mock';
    deck.sourceHash = sourceHash;
    deck.basedOnChapterHash = chapterHash;
    deck = await this.deckRepo.save(deck);
    this.recordGenerateAttempt(course.id);

    // 后台跑（Node 单进程；前端轮询 status 直到 ready/failed）
    // availableImages：正文里的 `file:` 插图清单，LLM 配图的唯一合法来源（无图则生成器维持不配图的默认）
    // 优化模式：把**上一版页面**（intent/标题/内容块）交给生成器，让它在此基础上改，而不是从零重规划
    const basePages = optimize
      ? (deck.slides ?? [])
          .filter((page): page is SemanticPage => isSemanticDeck([page]) && typeof page === 'object')
          .map((page) => ({
            intent: page.intent,
            kicker: page.kicker,
            title: page.title,
            lede: page.lede,
            blocks: page.blocks,
          }))
      : undefined;
    void this.runGeneration(
      deck.id,
      {
        courseTitle: course.title,
        chapterTitle: chapter.title,
        chapterContent: chapter.content,
        availableImages: extractChapterImages(chapter.content),
        instruction: instruction || undefined,
        basePages: basePages?.length ? basePages : undefined,
      },
      user.id,
    );

    return { deck: this.toDeckView(deck), cached: false };
  }

  private async runGeneration(
    deckId: string,
    source: DeckSource,
    /** 触发生成的人：写进 updatedBy，冲突提示据此显示「被谁改了」 */
    actorId?: string,
  ): Promise<void> {
    const generator = createDeckGenerator(SLIDES_GENERATOR);
    try {
      const outcome = await generator.generate(source);
      const deck = await this.deckRepo.findOne({ where: { id: deckId } });
      if (!deck) return;
      // 覆盖前把上一版存进历史（教师可回滚）—— optimize 与彻底重做都能回到生成前
      await this.archiveVersion(deck, source.basePages?.length ? 'optimize' : 'regenerate', actorId);
      deck.slides = outcome.slides;
      // 语义 deck 的 Markdown 只是只读预览（不接受回写）；旧 deck 仍是双向投影
      deck.markdown = isSemanticDeck(outcome.slides)
        ? semanticToMarkdown(outcome.slides)
        : toMarkdown(outcome.slides as SlideJson[]);
      deck.title = outcome.deckTitle || deck.title;
      deck.model = outcome.model;
      deck.tokensUsed = outcome.tokens
        ? outcome.tokens.promptTokens + outcome.tokens.completionTokens
        : null;
      deck.generatedBy = generator.mode;
      deck.warnings = outcome.warnings.length ? outcome.warnings.join('\n') : null;
      deck.error = null;
      deck.status = SlideDeckStatus.READY;
      deck.updatedBy = actorId ?? deck.updatedBy;
      await this.deckRepo.save(deck);
      if (actorId) {
        await this.coursesService.recordAudit({
          courseId: deck.courseId,
          action: 'deck_generate',
          targetType: 'deck',
          targetId: deck.id,
          summary: `重新生成了幻灯片（${outcome.slides.length} 页，${generator.mode}）`,
          actorId,
        });
      }
      this.logger.log(
        `章节幻灯片生成完成 deck=${deckId} 页数=${outcome.slides.length} 生成器=${generator.mode}`,
      );
    } catch (error) {
      const message = (error as Error).message || '未知错误';
      this.logger.error(`章节幻灯片生成失败 deck=${deckId}：${message}`);
      const deck = await this.deckRepo.findOne({ where: { id: deckId } });
      if (!deck) return;
      deck.status = SlideDeckStatus.FAILED;
      deck.error = message;
      await this.deckRepo.save(deck);
    }
  }

  // ------------------------------------------------------------ 单页重生成

  /**
   * 只重新生成某一页（同步，一次 LLM 调用，几秒到十几秒）：
   * 把该页当「大纲」回传扩写管线，产物原位替换；其余页一律不动 —— 修坏页不必整份重跑、
   * 也不会冲掉其他页的手工编辑。哈希语义不变：deck 的章节基准仍以整份生成时为准，
   * 章节变了继续走 chapterChanged 提示，由教师决定整份重生成。
   */
  async regeneratePage(
    user: User,
    chapterId: string,
    index: number,
    /** 本页的额外要求（可选提示词） */
    instruction?: string,
  ) {
    const chapter = await this.loadChapter(chapterId);
    const course = await this.coursesService.getOwnedCourse(user, chapter.courseId);
    if (!chapter.content?.trim()) {
      throw new BadRequestException('章节还没有正文内容，无法重新生成页面');
    }
    const deck = await this.deckRepo.findOne({ where: { chapterId } });
    if (!deck?.slides?.length) {
      throw new NotFoundException('该章节还没有幻灯片，请先生成');
    }
    if (deck.status === SlideDeckStatus.GENERATING) {
      throw new ConflictException('该章节正在整份生成中，请稍候');
    }
    if (!Number.isInteger(index) || index < 0 || index >= deck.slides.length) {
      throw new BadRequestException(`页码超出范围（共 ${deck.slides.length} 页）`);
    }
    // 与整份生成共用一个频次护栏（单页也是一次 LLM 调用）
    this.assertRateLimit(course.id);

    const semantic = isSemanticDeck(deck.slides);
    const current = deck.slides[index];
    // 旧模型：cover 封面的 bullets 多为大纲锚点残留（封面=标题+副标题），不回传；section 的要点是
    // "本节导览"素材，照常回传给模型参考。
    // 语义模型（v2）：回传 intent + 标题，模型据此重写这一页的内容块 —— 页序与其余页一律不动。
    const outlineItem: OutlineSlide = semantic
      ? {
          layout: 'semantic',
          intent: (current as SemanticPage).intent,
          kicker: current.kicker,
          title: current.title,
          lede: (current as { lede?: string }).lede,
        }
      : {
          layout: (current as SlideJson).layout,
          kicker: current.kicker,
          title: current.title,
          bullets: (current as SlideJson).layout === 'cover' ? undefined : (current as SlideJson).bullets,
        };
    const generator = createDeckGenerator(SLIDES_GENERATOR);
    const result = await generator.expandBatch(
      {
        courseTitle: course.title,
        chapterTitle: chapter.title,
        chapterContent: chapter.content,
        availableImages: extractChapterImages(chapter.content),
        instruction: instruction?.trim() || undefined,
      },
      [outlineItem],
      index,
      // v2：把这一页的**上一版内容**给模型 —— 在原内容上改，而不是重新发挥
      semantic
        ? [
            {
              intent: (current as SemanticPage).intent,
              title: current.title,
              blocks: (current as SemanticPage).blocks,
            },
          ]
        : undefined,
    );
    this.recordGenerateAttempt(course.id);

    const regenerated = result.slides[0];
    if (!regenerated) {
      throw new BadGatewayException(`第 ${index + 1} 页重新生成失败，请重试`);
    }
    // 旧模型：分节页眉题强制为「第 N 节」（按它在整份 deck 里的分节序号算，不交给模型编——
    // 模型看不到其他页，编出来的号会断档；与整份生成的 postProcess 编号同口径）。
    // 语义模型没有这一步：分节页的 kicker 由计划给定。
    if (!semantic && (regenerated as SlideJson).layout === 'section') {
      const sectionNo = deck.slides
        .slice(0, index + 1)
        .filter((slide) => (slide as SlideJson).layout === 'section').length;
      (regenerated as SlideJson).kicker = `第 ${sectionNo} 节`;
    }
    // 覆盖这一页前存一版（单页重生成也能后悔）
    await this.archiveVersion(deck, 'regenerate', user.id);
    const slides: DeckSlide[] = [...deck.slides];
    // 保留原页 id：缩略图/编辑态以 id 做 key，原位替换不应引起视图抖动
    slides[index] = { ...(regenerated as unknown as Record<string, unknown>), id: current.id } as DeckSlide;
    deck.slides = slides;
    deck.markdown = semantic
      ? semanticToMarkdown(slides as SemanticPage[])
      : toMarkdown(slides as SlideJson[]);
    deck.generatedBy = generator.mode;
    deck.warnings = result.warnings.length ? result.warnings.join('\n') : null;
    if (result.promptTokens + result.completionTokens > 0) {
      deck.tokensUsed = (deck.tokensUsed ?? 0) + result.promptTokens + result.completionTokens;
    }
    deck.error = null;
    deck.status = SlideDeckStatus.READY;
    const saved = await this.deckRepo.save(deck);
    this.logger.log(
      `单页重生成完成 deck=${deck.id} 页码=${index + 1} 生成器=${generator.mode}`,
    );
    return { deck: this.toDeckView(saved), warnings: result.warnings };
  }

  // ------------------------------------------------------------ 编辑与保存

  async save(user: User, chapterId: string, dto: SaveDeckDto) {
    const chapter = await this.loadChapter(chapterId);
    const course = await this.coursesService.getOwnedCourse(user, chapter.courseId);

    const warnings: string[] = [];
    let deck = await this.deckRepo.findOne({ where: { chapterId } });
    // 乐观锁：客户端持有的版本已过期（别人刚保存/生成过）→ 409，别静默覆盖他的改动
    if (deck && dto.version !== undefined && dto.version !== deck.version) {
      await this.throwDeckConflict(deck);
    }

    let slides: DeckSlide[] | undefined;
    if (dto.slides !== undefined) {
      // JSON 视图（高级入口）保留可写：按结构自辨识走语义校验或旧校验
      slides = isSemanticDeck(dto.slides)
        ? this.guardDeck(
            () =>
              validateSemanticPages(dto.slides, {
                maxPages: SLIDES_LIMITS.maxSlides,
                maxNotes: SLIDES_LIMITS.maxNotes,
              }).pages,
          )
        : this.guardDeck(() => normalizeSlides(dto.slides as SlideJson[], SLIDES_LIMITS));
      if (dto.markdown !== undefined) {
        warnings.push('同时提交了 slides 与 markdown，已以 slides 为准');
      }
    } else if (dto.markdown !== undefined) {
      // v2 语义 deck：Markdown 只是只读预览，不接受回写（编辑面已收窄为「换主题 / 重生成当前页」）
      if (isSemanticDeck(deck?.slides)) {
        throw new BadRequestException(
          '新版幻灯片（语义模型）不支持编辑 Markdown：请用「换主题」改观感，用「重生成当前页」改内容；高级改动可在 JSON 视图里进行',
        );
      }
      // 能走到这里说明是旧模型 deck（语义 deck 上面已拦），收窄后交给 MD 合并管线
      const legacySlides = (deck?.slides ?? []) as SlideJson[];
      const merged = this.guardDeck(() => mergeMarkdown(legacySlides, dto.markdown as string, SLIDES_LIMITS));
      slides = merged.slides;
      warnings.push(...merged.warnings);
    }

    if (!deck && !slides) {
      throw new BadRequestException('该章节还没有幻灯片，先手工创建或用生成功能');
    }

    if (slides) {
      if (!deck) {
        deck = this.deckRepo.create({
          courseId: course.id,
          chapterId,
          title: chapter.title,
          createdBy: user.id,
          status: SlideDeckStatus.READY,
          basedOnChapterHash: sha256(chapter.content ?? ''),
        });
      }
      // 教师手动保存前存一版（新建 deck 时 slides 为空，archiveVersion 会自行跳过）
      await this.archiveVersion(deck, 'manual-save', user.id);
      deck.slides = slides;
      deck.markdown = isSemanticDeck(slides)
        ? semanticToMarkdown(slides as SemanticPage[])
        : toMarkdown(slides as SlideJson[]);
      deck.status = SlideDeckStatus.READY;
      deck.generatedBy = 'manual';
      deck.error = null;
      if (!deck.basedOnChapterHash) {
        deck.basedOnChapterHash = sha256(chapter.content ?? '');
      }
    }

    if (!deck) throw new BadRequestException('该章节还没有幻灯片');

    deck.updatedBy = user.id;
    if (dto.title !== undefined) deck.title = dto.title;
    if (dto.templateId !== undefined) {
      await this.assertTemplateUsable(dto.templateId, course.id, user);
      deck.templateId = dto.templateId || null;
    }
    if (dto.config !== undefined) {
      deck.config = this.guardDeck(() => validateDeckConfig(dto.config));
    }

    deck = await this.deckRepo.save(deck);
    // 谁在什么时候改了这份课件（多教师协作的追溯，见设计文档 §8）
    await this.coursesService.recordAudit({
      courseId: course.id,
      action: 'deck_save',
      targetType: 'deck',
      targetId: deck.id,
      summary: `保存了「${chapter.title}」的幻灯片`,
      actorId: user.id,
    });
    return { deck: this.toDeckView(deck), warnings };
  }

  /** 「保留现有 deck，仅把基准哈希对齐到当前章节内容」 */
  async syncChapterHash(user: User, chapterId: string) {
    const chapter = await this.loadChapter(chapterId);
    await this.coursesService.getOwnedCourse(user, chapter.courseId);
    const deck = await this.deckRepo.findOne({ where: { chapterId } });
    if (!deck) throw new NotFoundException('该章节还没有幻灯片');
    deck.basedOnChapterHash = sha256(chapter.content ?? '');
    return { deck: this.toDeckView(await this.deckRepo.save(deck)) };
  }

  async removeDeck(user: User, chapterId: string) {
    const chapter = await this.loadChapter(chapterId);
    await this.coursesService.getOwnedCourse(user, chapter.courseId);
    const deck = await this.deckRepo.findOne({ where: { chapterId } });
    if (!deck) throw new NotFoundException('该章节还没有幻灯片');
    await this.deckRepo.remove(deck);
    return { deleted: true };
  }

  // ------------------------------------------------------------ 模板

  async listTemplates(user: User, courseId: string) {
    await this.coursesService.getOwnedCourse(user, courseId);
    return this.listCourseTemplates(courseId);
  }

  async createTemplate(user: User, courseId: string, dto: CreateTemplateDto) {
    await this.coursesService.getOwnedCourse(user, courseId);

    let baseTheme = 'simple';
    let design: TemplateDesign = {};
    let config: DeckConfig | null = null;

    if (dto.fromBuiltinId) {
      const builtin = findBuiltinTemplate(dto.fromBuiltinId);
      if (!builtin) throw new BadRequestException('指定的内置模板不存在');
      baseTheme = builtin.baseTheme;
      design = { ...builtin.design };
      config = builtin.config ?? null;
    }
    if (dto.design !== undefined) {
      design = { ...design, ...this.guardTemplate(() => validateTemplateDesign(dto.design)) };
    }
    if (dto.config !== undefined) {
      config = this.guardDeck(() => validateDeckConfig(dto.config));
    }

    const template = await this.templateRepo.save(
      this.templateRepo.create({
        courseId,
        name: dto.name,
        description: dto.description ?? null,
        baseTheme,
        design,
        config,
        isBuiltin: false,
        createdBy: user.id,
      }),
    );
    return this.toTemplateView(this.resolveTemplateFromEntity(template));
  }

  async updateTemplate(user: User, templateId: string, dto: UpdateTemplateDto) {
    const template = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!template) throw new NotFoundException('模板不存在');
    if (template.isBuiltin || !template.courseId) {
      throw new BadRequestException('内置模板不可修改，请先「另存为」课程模板');
    }
    await this.coursesService.getOwnedCourse(user, template.courseId);

    if (dto.name !== undefined) template.name = dto.name;
    if (dto.description !== undefined) template.description = dto.description;
    if (dto.design !== undefined) {
      template.design = this.guardTemplate(() => validateTemplateDesign(dto.design));
    }
    if (dto.config !== undefined) {
      template.config = this.guardDeck(() => validateDeckConfig(dto.config));
    }
    const saved = await this.templateRepo.save(template);
    return this.toTemplateView(this.resolveTemplateFromEntity(saved));
  }

  async deleteTemplate(user: User, templateId: string) {
    const template = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!template) throw new NotFoundException('模板不存在');
    if (template.isBuiltin || !template.courseId) {
      throw new BadRequestException('内置模板不可删除');
    }
    await this.coursesService.getOwnedCourse(user, template.courseId);

    // 被 deck 引用时先解绑（回落到平台默认），再删除 —— 不让历史 deck 打不开
    const referenced = await this.deckRepo.find({ where: { templateId } });
    for (const deck of referenced) {
      deck.templateId = null;
      await this.deckRepo.save(deck);
    }
    await this.templateRepo.remove(template);
    return { deleted: true, unboundDecks: referenced.length };
  }

  // ------------------------------------------------------------ 内部工具

  private async loadChapter(chapterId: string): Promise<Chapter> {
    const chapter = await this.chapterRepo.findOne({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException('章节不存在');
    return chapter;
  }

  /** deck 保存/生成撞上并发编辑：409 + 当前版本 + 最后修改者（与章节保存同一错误结构） */
  private async throwDeckConflict(deck: SlideDeck): Promise<never> {
    const editor = deck.updatedBy
      ? await this.userRepo.findOne({ where: { id: deck.updatedBy } })
      : null;
    throw buildConflictError(deck.version, editor);
  }

  private async canEdit(user: User, courseId: string): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    if (user.role !== UserRole.TEACHER) return false;
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    // 多教师：协作教师同样可以编辑幻灯片（判定复用 CoursesService，见设计文档 §3）
    return !!course && (await this.coursesService.isTeacherOfCourse(course, user.id));
  }

  /** 学生：章节已发布 + 在课程名单里；教师：课程 owner（口径与章节阅读接口一致） */
  private async assertChapterAccess(user: User, chapter: Chapter, canEdit: boolean) {
    if (user.role === UserRole.STUDENT) {
      if (chapter.status !== ChapterStatus.PUBLISHED) {
        throw new ForbiddenException('章节尚未发布');
      }
      await this.coursesService.assertEnrolled(chapter.courseId, user.id);
      return;
    }
    if (!canEdit) throw new ForbiddenException('没有权限查看该章节的幻灯片');
  }

  /**
   * 把 deck 的**当前内容**存成一个历史版本 —— 在"即将覆盖内容"之前调用。
   *
   * 为什么在覆盖前存：教师判断"哪一版更好"是主观的，覆盖掉就没了（实测踩过：
   * 收紧 prompt 重生成后教师更想要旧版，只能靠运维从备份文件恢复）。
   * 没内容的 deck 不存（首次生成没什么可保存的）；只保留最近 `MAX_DECK_VERSIONS` 版。
   */
  private async archiveVersion(
    deck: SlideDeck,
    reason: 'regenerate' | 'optimize' | 'manual-save' | 'pre-restore',
    actorId?: string,
  ): Promise<void> {
    if (!deck.slides?.length) return;
    await this.versionRepo.save(
      this.versionRepo.create({
        deckId: deck.id,
        chapterId: deck.chapterId,
        title: deck.title,
        slides: deck.slides,
        markdown: deck.markdown,
        templateId: deck.templateId,
        config: deck.config,
        tokensUsed: deck.tokensUsed,
        model: deck.model,
        generatedBy: deck.generatedBy,
        promptVersion: SLIDES_PROMPT_VERSION,
        label: `存档于 ${SLIDES_PROMPT_VERSION} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        reason,
        createdBy: actorId ?? deck.updatedBy ?? null,
      }),
    );
    // 超出上限则删最旧的几份（历史版本是"后悔药"，不是归档系统）
    const existing = await this.versionRepo.find({
      where: { deckId: deck.id },
      order: { createdAt: 'ASC' },
      select: ['id', 'createdAt'],
    });
    const overflow = existing.length - MAX_DECK_VERSIONS;
    if (overflow > 0) {
      const ids = existing.slice(0, overflow).map((v) => v.id);
      await this.versionRepo.delete(ids);
    }
  }

  private toVersionView(v: SlideDeckVersion): DeckVersionView {
    return {
      id: v.id,
      title: v.title,
      pages: v.slides?.length ?? 0,
      label: v.label,
      reason: v.reason,
      promptVersion: v.promptVersion,
      tokensUsed: v.tokensUsed,
      model: v.model,
      generatedBy: v.generatedBy,
      createdAt: v.createdAt,
    };
  }

  /** 列出该章节 deck 的历史版本（含当前版本，便于前端并排展示） */
  async listVersions(user: User, chapterId: string) {
    const chapter = await this.loadChapter(chapterId);
    await this.coursesService.getOwnedCourse(user, chapter.courseId);
    const deck = await this.deckRepo.findOne({ where: { chapterId } });
    if (!deck) return { versions: [] as DeckVersionView[], current: null };
    const rows = await this.versionRepo.find({
      where: { deckId: deck.id },
      order: { createdAt: 'DESC' },
      take: MAX_DECK_VERSIONS,
    });
    return { versions: rows.map((v) => this.toVersionView(v)), current: this.toDeckView(deck) };
  }

  /** 某历史版本的完整内容（预览用） */
  async getVersion(user: User, chapterId: string, versionId: string) {
    const chapter = await this.loadChapter(chapterId);
    await this.coursesService.getOwnedCourse(user, chapter.courseId);
    const deck = await this.deckRepo.findOne({ where: { chapterId } });
    if (!deck) throw new NotFoundException('该章节还没有幻灯片');
    const v = await this.versionRepo.findOne({ where: { id: versionId, deckId: deck.id } });
    if (!v) throw new NotFoundException('该历史版本不存在（可能已超出保留数量）');
    return { version: this.toVersionView(v), slides: v.slides, config: v.config, templateId: v.templateId };
  }

  /**
   * 回滚到某个历史版本。
   *
   * **回滚前先把"当前内容"也存成一版**（reason=pre-restore）—— 否则"滚回去发现更差"就无法再回来，
   * 后悔药必须双向。
   */
  async restoreVersion(
    user: User,
    chapterId: string,
    versionId: string,
    expectedVersion?: number,
  ) {
    const chapter = await this.loadChapter(chapterId);
    const course = await this.coursesService.getOwnedCourse(user, chapter.courseId);
    const deck = await this.deckRepo.findOne({ where: { chapterId } });
    if (!deck) throw new NotFoundException('该章节还没有幻灯片');
    if (deck.status === SlideDeckStatus.GENERATING) {
      throw new ConflictException('该章节正在生成中，请稍候再回滚');
    }
    if (expectedVersion !== undefined && expectedVersion !== deck.version) {
      throw new ConflictException(
        `幻灯片已被他人修改（当前版本 ${deck.version}，你持有 ${expectedVersion}），请刷新后重试`,
      );
    }
    const v = await this.versionRepo.findOne({ where: { id: versionId, deckId: deck.id } });
    if (!v) throw new NotFoundException('该历史版本不存在（可能已超出保留数量）');

    await this.archiveVersion(deck, 'pre-restore', user.id);

    deck.slides = v.slides;
    deck.title = v.title || deck.title;
    deck.markdown = v.markdown ?? deck.markdown;
    deck.config = v.config ?? deck.config;
    deck.generatedBy = 'manual';
    deck.error = null;
    deck.warnings = null;
    deck.updatedBy = user.id;
    // 回滚后与"当前章节正文"的基准重新对齐：这版内容是按当时的正文生成的，不制造假的"内容已变更"提示
    deck.basedOnChapterHash = sha256(chapter.content ?? '');
    deck.sourceHash = null;
    const saved = await this.deckRepo.save(deck);
    await this.coursesService.recordAudit({
      courseId: course.id,
      action: 'deck_restore',
      targetType: 'deck',
      targetId: saved.id,
      summary: `把「${chapter.title}」的幻灯片回滚到历史版本（${v.label}，${v.slides?.length ?? 0} 页）`,
      actorId: user.id,
    });
    this.logger.log(`幻灯片回滚 deck=${saved.id} 版本=${versionId} 页数=${v.slides?.length ?? 0}`);
    return { deck: this.toDeckView(saved) };
  }

  /** 删除某个历史版本（教师自己清理；当前内容不受影响） */
  async deleteVersion(user: User, chapterId: string, versionId: string) {
    const chapter = await this.loadChapter(chapterId);
    await this.coursesService.getOwnedCourse(user, chapter.courseId);
    const deck = await this.deckRepo.findOne({ where: { chapterId } });
    if (!deck) throw new NotFoundException('该章节还没有幻灯片');
    const v = await this.versionRepo.findOne({ where: { id: versionId, deckId: deck.id } });
    if (!v) throw new NotFoundException('该历史版本不存在');
    await this.versionRepo.remove(v);
    return { deleted: true };
  }

  private toDeckView(deck: SlideDeck): DeckView {
    return {
      id: deck.id,
      chapterId: deck.chapterId,
      courseId: deck.courseId,
      title: deck.title,
      slides: deck.slides ?? [],
      semantic: isSemanticDeck(deck.slides),
      markdown: deck.markdown ?? '',
      templateId: deck.templateId,
      config: { ...DEFAULT_DECK_CONFIG, ...(deck.config ?? {}) },
      status: deck.status,
      generatedBy: deck.generatedBy,
      model: deck.model,
      tokensUsed: deck.tokensUsed,
      basedOnChapterHash: deck.basedOnChapterHash,
      error: deck.error,
      warnings: deck.warnings,
      updatedAt: deck.updatedAt,
      version: deck.version,
      updatedBy: deck.updatedBy,
    };
  }

  private toTemplateView(template: ResolvedTemplate): TemplateView {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      baseTheme: template.baseTheme,
      design: template.design,
      css: template.css,
      config: template.config,
      isBuiltin: template.isBuiltin,
    };
  }

  private async listCourseTemplates(courseId: string): Promise<TemplateView[]> {
    const builtins: TemplateView[] = BUILTIN_TEMPLATES.map((builtin) => ({
      id: builtin.id,
      name: builtin.name,
      description: builtin.description,
      baseTheme: builtin.baseTheme,
      design: builtin.design,
      css: designToCss(builtin.design),
      config: builtin.config ?? null,
      isBuiltin: true,
    }));
    const customs = await this.templateRepo.find({
      where: { courseId },
      order: { createdAt: 'ASC' },
    });
    return [...builtins, ...customs.map((t) => this.toTemplateView(this.resolveTemplateFromEntity(t)))];
  }

  private resolveTemplateFromEntity(template: SlideTemplate): ResolvedTemplate {
    const design = template.design ?? {};
    const baseTheme = isAllowedBaseTheme(template.baseTheme)
      ? (template.baseTheme as string)
      : 'simple';
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      baseTheme,
      design,
      css: designToCss(design),
      config: template.config,
      isBuiltin: false,
    };
  }

  /** 解析 deck 生效的模板；**找不到时回落到平台默认**（历史 deck 不因模板被删就打不开） */
  private async resolveTemplate(
    courseId: string,
    templateId: string | null,
  ): Promise<ResolvedTemplate> {
    let fallbackId = DEFAULT_TEMPLATE_ID;
    if (templateId) {
      const builtin = findBuiltinTemplate(templateId);
      if (builtin) {
        return {
          id: builtin.id,
          name: builtin.name,
          description: builtin.description,
          baseTheme: builtin.baseTheme,
          design: builtin.design,
          css: designToCss(builtin.design),
          config: builtin.config ?? null,
          isBuiltin: true,
        };
      }
      const custom = await this.templateRepo.findOne({
        where: { id: templateId, courseId },
      });
      if (custom) return this.resolveTemplateFromEntity(custom);
      fallbackId = templateId; // 记录一下，仍是回落默认
    }
    const builtin = findBuiltinTemplate(fallbackId) ?? findBuiltinTemplate(DEFAULT_TEMPLATE_ID);
    if (!builtin) throw new NotFoundException('平台默认模板缺失');
    return {
      id: builtin.id,
      name: builtin.name,
      description: builtin.description,
      baseTheme: builtin.baseTheme,
      design: builtin.design,
      css: designToCss(builtin.design),
      config: builtin.config ?? null,
      isBuiltin: true,
    };
  }

  private async assertTemplateUsable(
    templateId: string | null,
    courseId: string,
    user: User,
  ) {
    if (!templateId) return;
    if (findBuiltinTemplate(templateId)) return;
    const custom = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!custom) throw new BadRequestException('指定的模板不存在');
    if (custom.courseId !== courseId) {
      throw new ForbiddenException('不能使用其他课程的模板');
    }
    if (custom.createdBy && custom.createdBy !== user.id && user.role !== UserRole.ADMIN) {
      // 同课程的教师之间共享模板是允许的（同课程协作），这里只拦跨课程
    }
  }

  private assertRateLimit(courseId: string) {
    const windowStart = Date.now() - 3_600_000;
    const stamps = (this.generateLog.get(courseId) ?? []).filter((t) => t > windowStart);
    this.generateLog.set(courseId, stamps);
    if (stamps.length >= SLIDES_GENERATE_PER_HOUR) {
      throw new ConflictException(
        `本课程一小时内最多生成 ${SLIDES_GENERATE_PER_HOUR} 次，请稍后再试`,
      );
    }
  }

  private recordGenerateAttempt(courseId: string) {
    const stamps = this.generateLog.get(courseId) ?? [];
    stamps.push(Date.now());
    this.generateLog.set(courseId, stamps);
  }

  /** 把内容校验错误翻译成 400（带"第几页哪里不对"的信息） */
  private guardDeck<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof DeckValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private guardTemplate<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

