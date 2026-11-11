import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { IsNull, Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import {
  AGENT_APP_DATA_DIR,
  AGENT_APP_ZIP_MAX,
} from './agent-app.config';
import { AgentAppRuntime } from './agent-app-runtime';
import {
  AgentApp,
  AgentAppMessage,
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

@Injectable()
export class AgentAppsService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentAppsService.name);

  constructor(
    @InjectRepository(AgentApp) private readonly apps: Repository<AgentApp>,
    @InjectRepository(AgentAppVersion)
    private readonly versions: Repository<AgentAppVersion>,
    @InjectRepository(AgentAppMessage)
    private readonly messages: Repository<AgentAppMessage>,
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
    const upstream = await this.runtime.upstream(app.id, version.id);
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
    const name = file || 'index.html';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new BadRequestException('非法文件名');
    const res = await fetch(`${upstream}/${name}`);
    if (!res.ok) throw new NotFoundException(`应用里没有 ${name}`);
    let body = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    if (contentType.includes('text/html')) {
      // 让 iframe 里的相对资源与 /api 调用都回到平台前缀（学生代码不用关心部署在哪）
      const base = `/lab/api/apps/${app.id}/site/`;
      const inject =
        `<base href="${base}"><script>window.__APP_API_BASE__="/lab/api/apps/${app.id}";</script>`;
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
    const { app, upstream } = await this.start(user, id);
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

  // ------------------------------------------------------------ 权限

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
