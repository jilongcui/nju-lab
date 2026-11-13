import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { IsNull, Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import { FilesService } from '../files/files.service';
import { Assignment, ExperimentProject } from '../projects/project.entity';
import { Submission } from '../submissions/submission.entity';
import {
  AGENT_APP_DATA_DIR,
  AGENT_APP_ZIP_MAX,
} from './agent-app.config';
import { AgentAppRuntime } from './agent-app-runtime';
import {
  AgentApp,
  AgentAppMessage,
  AgentAppReview,
  AgentAppVersion,
  AppStatus,
  AppVisibility,
} from './agent-app.entity';

export interface ChatAttachment {
  name: string;
  data: string; // base64
}

export interface ChatPayload {
  message?: string;
  session?: string;
  attachments?: ChatAttachment[];
}

/** 每应用 / 每个分享链接的简单限流（进程内存；重启清零，教学场景够用） */
const RATE_WINDOW_MS = 60_000;

/** 从"已提交的 Skill 包"创建应用时，平台要读的那部分提交信息 */
interface SubmissionLike {
  id: string;
  studentId: string;
  assignmentId: string;
  skillZipRef: string;
  skillZipSha256: string;
}

@Injectable()
export class AgentAppsService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentAppsService.name);
  private readonly rate = new Map<string, { windowStart: number; count: number }>();
  /** 平台代理的用量（进程内存；重启清零，够教学场景看"谁在用"） */
  private readonly usage = new Map<string, { calls: number; tokens: number }>();

  constructor(
    @InjectRepository(AgentApp) private readonly apps: Repository<AgentApp>,
    @InjectRepository(AgentAppVersion)
    private readonly versions: Repository<AgentAppVersion>,
    @InjectRepository(AgentAppMessage)
    private readonly messages: Repository<AgentAppMessage>,
    @InjectRepository(AgentAppReview)
    private readonly reviews: Repository<AgentAppReview>,
    @InjectRepository(Submission) private readonly submissions: Repository<Submission>,
    @InjectRepository(Assignment) private readonly assignments: Repository<Assignment>,
    @InjectRepository(ExperimentProject) private readonly projects: Repository<ExperimentProject>,
    private readonly filesService: FilesService,
    private readonly runtime: AgentAppRuntime,
  ) {}

  onModuleDestroy(): void {
    this.runtime.stopAll();
  }

  // ------------------------------------------------------------ 查询

  listMine(user: User): Promise<AgentApp[]> {
    return this.apps.find({ where: { studentId: user.id }, order: { updatedAt: 'DESC' } });
  }

  /** 教师：按课程看学生应用（一期先按课程过滤，课程为空的应用也能看到） */
  listByCourse(user: User, courseId: string): Promise<AgentApp[]> {
    this.assertTeacher(user);
    return this.apps.find({
      where: [{ courseId }, { courseId: IsNull() }],
      order: { updatedAt: 'DESC' },
    });
  }

  async get(user: User, id: string): Promise<AgentApp> {
    const app = await this.apps.findOne({ where: { id } });
    if (!app) throw new NotFoundException('应用不存在');
    this.assertCanRead(user, app);
    return app;
  }

  async getVersion(app: AgentApp): Promise<AgentAppVersion> {
    if (!app.latestVersionId) throw new BadRequestException('这个应用还没有上传过产物');
    const version = await this.versions.findOne({ where: { id: app.latestVersionId } });
    if (!version) throw new NotFoundException('应用版本不存在');
    return version;
  }

  // ------------------------------------------------------------ 写入

  async create(
    user: User,
    dto: { title: string; scenario?: string; courseId?: string; projectId?: string },
  ): Promise<AgentApp> {
    const title = (dto.title || '').trim();
    if (!title) throw new BadRequestException('标题不能为空');
    return this.apps.save(
      this.apps.create({
        studentId: user.id,
        courseId: dto.courseId ?? null,
        projectId: dto.projectId ?? null,
        title,
        scenario: dto.scenario ?? null,
        visibility: AppVisibility.TEACHER,
        status: AppStatus.DRAFT,
      }),
    );
  }

  async update(
    user: User,
    id: string,
    dto: Partial<Pick<AgentApp, 'title' | 'scenario' | 'entry' | 'theme' | 'attachments' | 'visibility'>>,
  ): Promise<AgentApp> {
    const app = await this.get(user, id);
    this.assertOwnerOrTeacher(user, app);
    Object.assign(app, dto);
    if (dto.visibility && !Object.values(AppVisibility).includes(dto.visibility)) {
      throw new BadRequestException('可见性取值不合法');
    }
    return this.apps.save(app);
  }

  /** 上传一版产物（zip）：只增不改，发布/回滚只切 `latestVersionId` */
  async uploadVersion(
    user: User,
    id: string,
    file: { originalname: string; buffer: Buffer; size: number },
    note?: string,
  ): Promise<AgentAppVersion> {
    const app = await this.get(user, id);
    this.assertOwner(user, app);
    if (!file?.buffer?.length) throw new BadRequestException('缺少上传文件');
    if (file.size > AGENT_APP_ZIP_MAX) {
      throw new BadRequestException(`产物不能超过 ${Math.round(AGENT_APP_ZIP_MAX / 1024 / 1024)}MB`);
    }
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('产物必须是 zip（根目录下要有 app.json 与 harness/api.py）');
    }

    const version = this.versions.create({
      appId: app.id,
      fileId: '',
      bundlePath: '',
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      size: file.size,
      note: note ?? null,
    });
    const saved = await this.versions.save(version);
    const dir = `${AGENT_APP_DATA_DIR}/${app.id}`;
    await mkdir(dir, { recursive: true });
    const zipPath = this.runtime.bundleZipPath(app.id, saved.id);
    await writeFile(zipPath, file.buffer);

    saved.bundlePath = dir;
    await this.versions.save(saved);
    app.latestVersionId = saved.id;
    await this.apps.save(app);
    // 换版本要让旧容器失效，否则预览还在跑旧代码
    this.runtime.stop(app.id);
    return saved;
  }

  async publish(user: User, id: string): Promise<AgentApp> {
    const app = await this.get(user, id);
    this.assertOwnerOrTeacher(user, app);
    if (!app.latestVersionId) throw new BadRequestException('先上传一版产物再发布');
    app.status = AppStatus.PUBLISHED;
    app.shareKey = app.shareKey || randomBytes(16).toString('hex');
    return this.apps.save(app);
  }

  async unpublish(user: User, id: string): Promise<AgentApp> {
    const app = await this.get(user, id);
    this.assertOwnerOrTeacher(user, app);
    app.status = AppStatus.ARCHIVED;
    app.shareKey = null;
    this.runtime.stop(app.id);
    return this.apps.save(app);
  }

  // ------------------------------------------------------------ 运行与反代

  /** 起（或复用）应用容器，返回预览用的上游 base（**等 HTTP 就绪**再返回） */
  async start(user: User, id: string): Promise<{ app: AgentApp; upstream: string }> {
    const app = await this.get(user, id);
    this.assertCanRead(user, app);
    const version = await this.getVersion(app);
    const upstream = await this.runtime.upstream(app.id, version.id, this.metaOf(app));
    await this.waitUntilReady(upstream);
    return { app, upstream };
  }

  /**
   * 等容器里的 `app_host.py` 真的能应答（最多约 20 秒）。
   *
   * 为什么需要：容器拿到 IP 只要几百毫秒，但 `entrypoint.sh` 还要 unzip 产物、启动 python ——
   * 这中间转发过去就是 `fetch failed`（2026-11-11 实测，冒烟第一次就撞上）。
   */
  private async waitUntilReady(upstream: string, attempts = 40): Promise<void> {
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await fetch(`${upstream}/api/health`);
        if (res.ok) return;
      } catch {
        // 还没起来，继续等
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new ServiceUnavailableException('应用启动超时（容器在跑但 HTTP 没应答），请稍后重试');
  }

  async siteAsset(user: User, id: string, file: string): Promise<{ body: Buffer; contentType: string }> {
    const { app, upstream } = await this.start(user, id);
    return this.readSiteAsset(app, upstream, file);
  }

  /** 分享链接（匿名）的静态资源：只允许已发布且有 `shareKey` 的应用 */
  async siteAssetByShareKey(
    key: string,
    file: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const app = await this.getByShareKey(key);
    const version = await this.getVersion(app);
    const upstream = await this.runtime.upstream(app.id, version.id, this.metaOf(app));
    await this.waitUntilReady(upstream);
    return this.readSiteAsset(app, upstream, file, `/lab/api/apps/share/${key}`);
  }

  private async readSiteAsset(
    app: AgentApp,
    upstream: string,
    file: string,
    apiBase?: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const name = file || 'index.html';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new BadRequestException('非法文件名');
    const res = await fetch(`${upstream}/${name}`);
    if (!res.ok) throw new NotFoundException(`应用里没有 ${name}`);
    let body = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    if (contentType.includes('text/html')) {
      // 让 iframe 里的相对资源与 /api 调用都回到平台前缀（学生代码不用关心部署在哪）。
      // 分享场景用 `share/<key>` 前缀：页面在 sandbox（无同源凭据）里也能对话。
      const prefix = apiBase ?? `/lab/api/apps/${app.id}`;
      const inject =
        `<base href="${prefix}/site/"><script>window.__APP_API_BASE__="${prefix}";</script>`;
      body = Buffer.from(
        body
          .toString('utf-8')
          .replace(/<head([^>]*)>/i, `<head$1>${inject}`)
          .replace(/<\/head>/i, `${inject}</head>`),
      );
    }
    return { body, contentType };
  }

  /** 对话：把附件转成 multipart 转发给容器里的 `app_host.py`，并把两边消息落库 */
  async chat(user: User, id: string, payload: ChatPayload): Promise<Record<string, unknown>> {
    if (!this.allow(`app:${id}`, 60)) {
      throw new HttpException('请求太频繁（每应用每分钟 60 次），请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
    }
    const { app, upstream } = await this.start(user, id);
    return this.forwardChat(app, upstream, payload);
  }

  /** 分享链接（匿名）的对话：限流更紧（每个链接每分钟 20 次） */
  async chatByShareKey(key: string, payload: ChatPayload): Promise<Record<string, unknown>> {
    const app = await this.getByShareKey(key);
    if (!this.allow(`share:${key}`, 20)) {
      throw new HttpException(
        '这个分享链接访问太频繁（每分钟 20 次），请稍后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const version = await this.getVersion(app);
    const upstream = await this.runtime.upstream(app.id, version.id, this.metaOf(app));
    await this.waitUntilReady(upstream);
    return this.forwardChat(app, upstream, payload);
  }

  private async forwardChat(
    app: AgentApp,
    upstream: string,
    payload: ChatPayload,
  ): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.append('message', payload.message ?? '');
    if (payload.session) form.append('session', payload.session);
    for (const item of payload.attachments ?? []) {
      if (!item?.data) continue;
      const bytes = Buffer.from(item.data, 'base64');
      form.append(
        'attachments',
        new Blob([new Uint8Array(bytes)]),
        item.name || 'upload.bin',
      );
    }
    const res = await fetch(`${upstream}/api/chat`, { method: 'POST', body: form });
    if (!res.ok) {
      throw new BadRequestException(`应用返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    const sessionId = String(data.session ?? payload.session ?? '');
    await this.messages.save(
      this.messages.create({
        appId: app.id,
        sessionId,
        role: 'user',
        content: (payload.message ?? '').slice(0, 4000),
      }),
    );
    if (typeof data.reply === 'string' && data.reply) {
      await this.messages.save(
        this.messages.create({
          appId: app.id,
          sessionId,
          role: 'assistant',
          content: data.reply.slice(0, 4000),
        }),
      );
    }
    return data;
  }

  // ------------------------------------------------------------ 对话记录

  async listMessages(user: User, id: string, limit = 200): Promise<AgentAppMessage[]> {
    const app = await this.get(user, id);
    this.assertCanRead(user, app);
    return this.messages.find({
      where: { appId: app.id },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  /**
   * 删除应用（作者或教师）：停容器 → 删四张表 → 删落盘产物。
   *
   * 与"下架"的区别：下架只改状态、留数据；删除是学生清理草稿用，**不可恢复**。
   * 前端会二次确认。
   */
  async remove(user: User, id: string): Promise<{ deleted: true }> {
    const app = await this.get(user, id);
    this.assertOwnerOrTeacher(user, app);
    this.runtime.stop(app.id);
    await this.messages.delete({ appId: app.id });
    await this.reviews.delete({ appId: app.id });
    await this.versions.delete({ appId: app.id });
    await this.apps.delete({ id: app.id });
    await rm(`${AGENT_APP_DATA_DIR}/${app.id}`, { recursive: true, force: true });
    return { deleted: true };
  }

  // ------------------------------------------------------------ 平台模型代理

  /**
   * 应用容器调模型的**唯一入口**（容器里没有 key）。
   *
   * 为什么要这一层：① key 不进学生容器；② `model` 与 `max_tokens` 由平台钉死，
   * 学生改不了；③ 能按应用计次（`allow('llm:<appId>', 30)`）并在内存里记用量。
   * 鉴权用起容器时下发的一次性 token（`X-App-Token`），不是 JWT。
   */
  async llmChat(
    token: string,
    payload: { messages?: unknown; max_tokens?: number; temperature?: number; reasoning_effort?: string },
  ): Promise<Record<string, unknown>> {
    const appId = token ? this.runtime.appIdForToken(token) : null;
    if (!appId) throw new UnauthorizedException('应用凭证无效或已过期（容器重启后需要重新获取）');
    if (!this.allow(`llm:${appId}`, 30)) {
      throw new HttpException('模型调用太频繁（每应用每分钟 30 次）', HttpStatus.TOO_MANY_REQUESTS);
    }
    const messages = Array.isArray(payload?.messages) ? payload.messages : null;
    if (!messages || messages.length === 0) throw new BadRequestException('messages 不能为空');

    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new ServiceUnavailableException('平台没有配置模型额度（DEEPSEEK_API_KEY）');
    const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const model = process.env.APP_LLM_MODEL || 'deepseek-flash';
    const maxTokens = Math.min(Math.max(Number(payload.max_tokens) || 800, 16), 2000);
    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
      ...(payload.reasoning_effort ? { reasoning_effort: payload.reasoning_effort } : {}),
    };
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new BadRequestException(`模型返回 ${res.status}：${text}`);
    }
    const data = (await res.json()) as { usage?: { total_tokens?: number } };
    const stat = this.usage.get(appId) ?? { calls: 0, tokens: 0 };
    stat.calls += 1;
    stat.tokens += Number(data.usage?.total_tokens) || 0;
    this.usage.set(appId, stat);
    return data as Record<string, unknown>;
  }

  /** 用量（教师/作者可看） */
  async usageOf(user: User, id: string): Promise<{ calls: number; tokens: number }> {
    const app = await this.get(user, id);
    this.assertCanRead(user, app);
    return this.usage.get(app.id) ?? { calls: 0, tokens: 0 };
  }

  // ------------------------------------------------------------ 从 Skill 包一键创建应用

  /**
   * **学生只交 Skill，平台把它变成应用**（第 20 章的口径）。
   *
   * 流程：取本人最近一次提交的 Skill 包（`skillZipRef = file:<id>`）→ 复制成应用版本 →
   * 发布并生成分享链接。容器起的是**平台 harness**（`server/apps-image/platform/`），
   * 它把平台模板 + 学生 skill 拼起来跑 —— 学生不写 core、不碰前端、不跑命令行。
   */
  async createFromSubmission(
    user: User,
    dto: { submissionId?: string; assignmentId?: string; title?: string; courseId?: string },
  ): Promise<AgentApp> {
    const submission = await this.findSubmission(user, dto);
    const fileId = this.fileIdFromRef(submission.skillZipRef);
    if (!fileId) {
      throw new BadRequestException('这次提交没有可用的 Skill 包（skillZipRef 不是 file:<id> 形式）');
    }
    const payload = await this.filesService.readBuffer(fileId);
    if (!payload?.length || payload[0] !== 0x50 || payload[1] !== 0x4b) {
      throw new BadRequestException('提交的 Skill 包不是合法 zip');
    }

    const entry = this.detectEntry(payload);
    const title = (dto.title || (await this.defaultTitle(user, submission))).slice(0, 120);
    const app = await this.apps.save(
      this.apps.create({
        studentId: user.id,
        courseId: dto.courseId ?? null,
        projectId: null,
        title,
        scenario: '由平台托管的智能体应用（Skill 驱动）',
        entry,
        visibility: AppVisibility.TEACHER,
        status: AppStatus.DRAFT,
      }),
    );

    const version = await this.versions.save(
      this.versions.create({
        appId: app.id,
        fileId,
        bundlePath: '',
        sha256: submission.skillZipSha256 || '',
        size: payload.length,
        note: `来自提交 ${submission.id.slice(0, 8)}`,
      }),
    );
    const dir = `${AGENT_APP_DATA_DIR}/${app.id}`;
    await mkdir(dir, { recursive: true });
    await writeFile(this.runtime.bundleZipPath(app.id, version.id), payload);
    app.latestVersionId = version.id;
    await this.apps.save(app);

    return this.publish(user, app.id);
  }

  /** 本人可用来创建应用的提交（有 Skill 包的那些，最近 20 条） */
  async listSkillSubmissions(user: User): Promise<
    { submissionId: string; assignmentId: string; projectTitle: string; version: number; submittedAt: Date }[]
  > {
    const rows = await this.submissions.find({
      where: { studentId: user.id },
      order: { submittedAt: 'DESC' },
      take: 20,
    });
    return rows
      .filter((s) => !!this.fileIdFromRef(s.skillZipRef))
      .map((s) => ({
        submissionId: s.id,
        assignmentId: s.assignmentId,
        projectTitle: '',
        version: s.version,
        submittedAt: s.submittedAt,
      }));
  }

  private async findSubmission(
    user: User,
    dto: { submissionId?: string; assignmentId?: string },
  ): Promise<SubmissionLike> {
    if (dto.submissionId) {
      const one = await this.submissions.findOne({ where: { id: dto.submissionId } });
      if (!one || one.studentId !== user.id) throw new NotFoundException('提交不存在');
      return one as unknown as SubmissionLike;
    }
    if (dto.assignmentId) {
      const rows = await this.submissions.find({
        where: { assignmentId: dto.assignmentId, studentId: user.id },
        order: { version: 'DESC' },
        take: 1,
      });
      if (!rows.length) throw new NotFoundException('这个任务还没有提交过 Skill 包');
      return rows[0] as unknown as SubmissionLike;
    }
    const rows = await this.submissions.find({
      where: { studentId: user.id },
      order: { submittedAt: 'DESC' },
      take: 1,
    });
    if (!rows.length) throw new NotFoundException('你还没有提交过任何 Skill 包');
    return rows[0] as unknown as SubmissionLike;
  }

  /**
   * 判断 zip 是不是一个**可发布的应用**。
   *
   * 口径（2026-11-13 用户拍板）：**应用 = Skill**，不是 agent。
   * - 应用必须有 `SKILL.md` + `scripts/api.py`（`handle()`）；
   * - **agent 包**（只有 `agent/api.py` / `skills/`）不算应用 —— 它是"可定制的运行时"，
   *   平台已经有一个通用 agent，学生定制的那份不作为应用对外发布。
   * - 旧形态（`harness/api.py`，学生自带整套产物）仍然兼容，但不再是推荐路径。
   */
  private detectEntry(zip: Buffer): string {
    const text = zip.toString('latin1');
    const hasSkill = text.includes('scripts/api.py');
    const hasAgentOnly = text.includes('agent/api.py') && !hasSkill;
    if (hasAgentOnly) {
      throw new BadRequestException(
        '这个包是 agent（只有 agent/api.py），不是应用：应用以 **Skill** 为单位 —— ' +
          '请交含 SKILL.md + scripts/api.py 的 Skill 包（agent 的定制放进 Skill 包的 profile.json）',
      );
    }
    if (hasSkill) return 'skill/scripts/api.py';
    if (text.includes('harness/api.py')) return 'harness/api.py';
    throw new BadRequestException('这个包里没有 scripts/api.py（Skill 入口），不能作为应用发布');
  }

  private fileIdFromRef(ref: string | null | undefined): string | null {
    if (!ref) return null;
    const m = /^file:([0-9a-f-]{36})$/i.exec(ref);
    return m ? m[1] : null;
  }

  private async defaultTitle(user: User, submission: SubmissionLike): Promise<string> {
    const project = await this.projects.findOne({
      where: { id: await this.projectIdOf(submission.assignmentId) },
    });
    return project?.title ? `${project.title}`.slice(0, 60) : `我的应用 ${submission.id.slice(0, 6)}`;
  }

  private async projectIdOf(assignmentId: string): Promise<string> {
    const assignment = await this.assignments.findOne({ where: { id: assignmentId } });
    return assignment?.projectId ?? '';
  }

  // ------------------------------------------------------------ 分享（匿名）

  /** 按 `shareKey` 取应用：只有「已发布 + 有 key」才对外 */
  async getByShareKey(key: string): Promise<AgentApp> {
    if (!key || !/^[0-9a-f]{16,40}$/.test(key)) throw new NotFoundException('分享链接无效');
    const app = await this.apps.findOne({ where: { shareKey: key } });
    if (!app || app.status !== AppStatus.PUBLISHED) {
      throw new NotFoundException('分享链接无效或已下架');
    }
    return app;
  }

  /** 匿名访问只给"能看"的元信息，不带 studentId / 课程归属 */
  async sharedMeta(key: string): Promise<Record<string, unknown>> {
    const app = await this.getByShareKey(key);
    return {
      title: app.title,
      scenario: app.scenario,
      entry: app.entry,
      theme: app.theme,
      attachments: app.attachments,
      publishedAt: app.updatedAt,
    };
  }

  // ------------------------------------------------------------ 版本与回滚

  async listVersions(user: User, id: string): Promise<AgentAppVersion[]> {
    const app = await this.get(user, id);
    this.assertCanRead(user, app);
    return this.versions.find({ where: { appId: app.id }, order: { createdAt: 'DESC' } });
  }

  /** 切回某个历史版本（发布态不变；容器会在下次预览时重建） */
  async activateVersion(
    user: User,
    id: string,
    versionId: string,
  ): Promise<AgentApp> {
    const app = await this.get(user, id);
    this.assertOwnerOrTeacher(user, app);
    const version = await this.versions.findOne({ where: { id: versionId, appId: app.id } });
    if (!version) throw new NotFoundException('这个版本不属于该应用');
    app.latestVersionId = version.id;
    await this.apps.save(app);
    this.runtime.stop(app.id);
    return app;
  }

  // ------------------------------------------------------------ 评分（教师）

  async review(
    user: User,
    id: string,
    dto: { total: number; dimensions?: AgentAppReview['dimensions']; comment?: string },
  ): Promise<AgentAppReview> {
    const app = await this.get(user, id);
    if (user.role !== UserRole.TEACHER) throw new ForbiddenException('只有教师可以评分');
    const total = Math.max(0, Math.min(100, Math.round(Number(dto.total) || 0)));
    const existing = await this.reviews.findOne({ where: { appId: app.id, teacherId: user.id } });
    const entity = existing ?? this.reviews.create({ appId: app.id, teacherId: user.id });
    entity.total = total;
    entity.dimensions = dto.dimensions ?? null;
    entity.comment = dto.comment ?? null;
    return this.reviews.save(entity);
  }

  async getReview(user: User, id: string): Promise<AgentAppReview | null> {
    const app = await this.get(user, id);
    this.assertCanRead(user, app);
    const rows = await this.reviews.find({ where: { appId: app.id }, order: { updatedAt: 'DESC' } });
    return rows[0] ?? null;
  }

  // ------------------------------------------------------------ 权限

  /** 简单滑动窗口限流（每 key 每分钟 `perMinute` 次） */
  private allow(key: string, perMinute: number): boolean {
    const now = Date.now();
    const slot = this.rate.get(key);
    if (!slot || now - slot.windowStart > RATE_WINDOW_MS) {
      this.rate.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (slot.count >= perMinute) return false;
    slot.count += 1;
    return true;
  }

  private metaOf(app: AgentApp): { title: string; scenario: string; accent: string } {
    return {
      title: app.title,
      scenario: app.scenario ?? '',
      accent: app.theme?.accent ?? '#2f6feb',
    };
  }

  private assertTeacher(user: User): void {
    if (user.role !== UserRole.TEACHER) {
      throw new ForbiddenException('只有教师可以访问这里');
    }
  }

  private assertOwner(user: User, app: AgentApp): void {
    if (app.studentId !== user.id) throw new ForbiddenException('只有应用作者可以修改');
  }

  /** 发布 / 下架 / 改元信息：作者本人或教师（教师需要能下架） */
  private assertOwnerOrTeacher(user: User, app: AgentApp): void {
    if (app.studentId === user.id) return;
    if (user.role === UserRole.TEACHER) return;
    throw new ForbiddenException('只有应用作者或教师可以修改');
  }

  private assertCanRead(user: User, app: AgentApp): void {
    if (app.studentId === user.id) return;
    if (user.role === UserRole.TEACHER) return;
    if (app.status === AppStatus.PUBLISHED && app.visibility === AppVisibility.COURSE) return;
    throw new ForbiddenException('没有权限查看这个应用');
  }
}
