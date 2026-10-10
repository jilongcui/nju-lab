/** 与后端统一响应格式对应的类型与实体定义（已按 3100 端口实测契约对齐） */

export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

export type Role = 'teacher' | 'student' | 'admin';

export interface User {
  id: string;
  username: string;
  nickname: string;
  role: Role;
}

export type CourseStatus = 'draft' | 'published' | 'archived';

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
}

export type ChapterStatus = 'draft' | 'published';
export type ChapterProgressStatus = 'not_started' | 'in_progress' | 'completed';

export interface Chapter {
  id: string;
  courseId: string;
  order: number;
  title: string;
  content?: string;
  exampleSkills?: unknown;
  status: ChapterStatus;
  createdAt?: string;
  /** 课程详情中后端返回的实验项目摘要 */
  projects?: ProjectSummary[];
  /** 学生视角：章节阅读接口返回的本章学习进度 */
  myProgress?: ChapterProgressStatus;
}

export interface Course {
  id: string;
  title: string;
  teacherId?: string;
  /** 列表接口返回的授课教师显示名（nickname 或 username） */
  teacherName?: string;
  term?: string;
  description?: string;
  status: CourseStatus;
  chapters?: Chapter[];
  createdAt?: string;
  /** 学生视角（/me/courses） */
  courseStatus?: CourseStatus;
  completedCount?: number;
  /** 公开目录与申请审批（见 docs/DESIGN-course-application-2026-09-24.md） */
  slug?: string | null;
  capacity?: number | null;
  applicationOpenAt?: string | null;
  applicationCloseAt?: string | null;
  /** 教师视角：后端算出的报名状态与名额占用 */
  applicationState?: ApplicationState;
  approvedCount?: number;
  seatsLeft?: number | null;
}

// ---------- 公开课程目录与申请审批 ----------

/** 后端算出的申请状态（前端拿不到别人的入册数，不能自行判断） */
export type ApplicationState =
  | 'not_published'
  | 'not_open_yet'
  | 'open'
  | 'full'
  | 'closed';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

/** GET /api/browse/courses 条目 */
export interface CatalogCourseBrief {
  id: string;
  slug: string | null;
  title: string;
  term: string;
  description: string | null;
  teacherName: string;
  chapterCount: number;
  capacity: number | null;
  approvedCount: number;
  seatsLeft: number | null;
  applicationOpenAt: string | null;
  applicationCloseAt: string | null;
  applicationState: ApplicationState;
}

export interface MyApplicationBrief {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

/** GET /api/browse/courses/:slug */
export interface CatalogCourseDetail
  extends Omit<CatalogCourseBrief, 'chapterCount'> {
  chapters: { id: string; order: number; title: string }[];
  /** 我的最近一次申请（登录用户） */
  myApplication: MyApplicationBrief | null;
  /** 我是否已入册 */
  myEnrollment: boolean;
}

/** GET /api/me/applications 条目 */
export interface MyApplication extends MyApplicationBrief {
  course: { id: string; slug: string | null; title: string; term: string } | null;
  applicationState: ApplicationState;
  enrolled: boolean;
}

/** GET /api/courses/:courseId/applications 里的申请行 */
export interface CourseApplicationRow {
  id: string;
  studentId: string;
  username: string;
  nickname: string;
  status: ApplicationStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
}

/** GET /api/courses/:courseId/applications */
export interface CourseApplicationsView {
  courseId: string;
  capacity: number | null;
  approvedCount: number;
  seatsLeft: number | null;
  applicationState: ApplicationState;
  pendingCount: number;
  applications: CourseApplicationRow[];
}

export interface StudentChapterBrief {
  id: string;
  order: number;
  title: string;
  status: ChapterProgressStatus;
  completedAt?: string | null;
}

/** GET /api/me/courses 返回的课程条目 */
export interface MyCourse {
  id: string;
  title: string;
  term?: string;
  description?: string | null;
  teacherName?: string;
  courseStatus: CourseStatus;
  completedCount: number;
  chapters: StudentChapterBrief[];
}

export type ProjectStatus = 'draft' | 'published' | 'closed';

export interface EvalConfig {
  model?: string;
  reasoningEffort?: string;
  tools?: string[];
  timeoutSeconds?: number;
  /** 复验评判模式（llm | exact）：通常由题目包 manifest 声明，这里只做平台级覆盖 */
  judgeMode?: 'llm' | 'exact';
  /** 成本控制：最多跑几个 case（0 或缺省 = 全部） */
  maxCases?: number;
}

export interface RubricItem {
  name: string;
  weight: number;
}

export interface UnlockRule {
  type: 'default' | 'none' | string;
}

/** POST /api/files 响应 / 项目详情中下发的文件信息 */
export interface StoredFileInfo {
  fileId: string;
  url: string;
  originalName: string;
  size: number;
  sha256: string;
  mimeType: string;
  createdAt: string;
}

export interface ExperimentProject {
  id: string;
  courseId: string;
  chapterId: string;
  title: string;
  objectives?: string | null;
  background?: string | null;
  description?: string | null;
  skillTemplateFileId?: string | null;
  problemFileId?: string | null;
  /** 模板/题目包文件信息：教师详情恒返回；学生端仅领取后返回 */
  skillTemplate?: StoredFileInfo | null;
  problem?: StoredFileInfo | null;
  evalConfig?: EvalConfig;
  rubric?: RubricItem[];
  references?: string | null;
  faq?: string | null;
  unlockRule?: UnlockRule;
  deadline?: string | null;
  status: ProjectStatus;
  createdAt?: string;
}

/** GET /api/projects 教师项目列表行（跨课程） */
export interface TeacherProjectRow {
  id: string;
  title: string;
  status: ProjectStatus;
  deadline?: string | null;
  createdAt?: string;
  courseId: string;
  courseTitle?: string | null;
  chapterId: string;
  chapterTitle?: string | null;
  assignmentCount: number;
  submittedCount: number;
}

/** 学生任务状态：pending=未领取，claimed=已领取，submitted=已提交 */
export type AssignmentStatus = 'pending' | 'claimed' | 'submitted' | string;

export interface AssignmentProjectBrief {
  id: string;
  title: string;
  deadline?: string | null;
  chapterTitle?: string;
}

export interface AssignmentSubmissionBrief {
  id: string;
  status: SubmissionStatus;
  submittedAt: string;
  /** 多版本：该提交的版本号（从 1 起） */
  version: number;
}

/** GET /api/me/assignments 条目 */
export interface Assignment {
  id: string;
  status: AssignmentStatus;
  claimedAt?: string | null;
  unlocked: boolean;
  project: AssignmentProjectBrief;
  /** 该任务最新一条提交，未提交为 null */
  submission?: AssignmentSubmissionBrief | null;
  /** 已提交的版本总数 */
  submissionCount?: number;
}

/** POST /api/assignments/:id/claim 响应 */
export interface ClaimResult {
  assignment: unknown;
  skillTemplate?: StoredFileInfo | null;
  problem?: StoredFileInfo | null;
  evalConfig?: EvalConfig;
}

export type SubmissionStatus = 'submitted' | 'verifying' | 'verified' | 'failed' | 'graded';

export interface AuditEvent {
  type?: string;
  tool?: string;
  decision?: string;
  [key: string]: unknown;
}

export interface RunResult {
  runs?: number;
  problem?: string;
  evalConfig?: EvalConfig;
  /** 0~1 小数 */
  successRate?: number;
  avgTokensPerRun?: number;
}

export interface IntegrityCheck {
  note?: string;
  deviation?: number;
  selfReportVsRerun?: string;
  capsuleHashVerified?: boolean;
}

export interface Evaluation {
  id: string;
  submissionId: string;
  /** @deprecated baseline 轮已取消（2026-10-06）；仅历史记录里还可能有值 */
  baselineResult?: RunResult;
  treatmentResult?: RunResult;
  /** 0~1 小数 */
  successRate?: number;
  tokenCost?: number;
  dossierSnapshot?: Record<string, unknown>;
  integrityCheck?: IntegrityCheck;
  autoScoreSuggestion?: number;
  teacherScore?: number;
  teacherComment?: string;
  createdAt?: string;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  submittedAt: string;
  /** 多版本：版本号（从 1 起） */
  version: number;
  skillZipRef: string;
  skillZipSha256?: string;
  capsuleRef: string;
  capsuleSha256?: string;
  auditEvents?: AuditEvent[];
  fileHashes?: Record<string, string>;
  status: SubmissionStatus;
  evaluation?: Evaluation;
  assignment?: { id: string; projectId: string; studentId: string; status: string };
  student?: { id: string; username: string; nickname: string };
}

/** GET /api/projects/:id/submissions 条目 */
export interface ProjectSubmissionRow {
  assignmentId: string;
  student: { id: string; username: string; nickname: string };
  assignmentStatus: AssignmentStatus;
  /** 该任务最新一版提交 */
  submission: Submission | null;
  /** 已提交的版本总数 */
  versionCount?: number;
}

/** GET /api/courses/:id/progress（对象，非数组） */
export interface CourseProgress {
  courseId: string;
  chapterCount: number;
  studentCount: number;
  students: StudentProgressEntry[];
}

export interface StudentProgressEntry {
  studentId: string;
  username: string;
  nickname: string;
  completedCount: number;
  totalChapters: number;
  chapters: {
    chapterId: string;
    title: string;
    order: number;
    status: ChapterProgressStatus;
    completedAt?: string | null;
  }[];
}

export interface Enrollment {
  id: string;
  studentId: string;
  username: string;
  nickname: string;
  enrolledAt: string;
}

export interface StudentUser {
  id: string;
  username: string;
  nickname: string;
}

/** GET /api/users/teachers 条目（仅管理员） */
export interface TeacherUser {
  id: string;
  username: string;
  nickname: string;
}

/** GET /api/dashboard/teacher-summary（教师/管理员） */
export interface TeacherSummary {
  courseCount: number;
  studentCount: number;
  pendingGradingCount: number;
  pendingGrading: PendingGradingItem[];
}

export interface PendingGradingItem {
  submissionId: string;
  status: SubmissionStatus;
  submittedAt: string;
  projectId: string;
  projectTitle: string;
  courseId: string;
  studentUsername: string;
  studentNickname: string;
}

/** GET /api/courses/:id/dashboard */
export interface CourseDashboard {
  courseId: string;
  studentCount: number;
  chapters: {
    chapterId: string;
    title: string;
    order: number;
    studentCount: number;
    completedCount: number;
    inProgressCount: number;
    /** 0~1 小数 */
    completionRate: number;
  }[];
}

/** GET /api/projects/:id/dashboard */
export interface ProjectDashboard {
  projectId: string;
  title: string;
  submissionProgress: {
    totalAssignments: number;
    assignmentStatus: Record<string, number>;
    submissionStatus: Record<string, number>;
    submittedCount: number;
  };
  successRateDistribution: Record<string, number>;
  tokenCostDistribution: {
    count: number;
    avg: number;
    min: number;
    max: number;
    buckets: Record<string, number>;
  };
  evaluatedCount: number;
}

/** 平台侧实验工作台（兜底环境）：GET /api/workspace/status、POST /api/workspace/start */
export interface WorkspaceInfo {
  status: 'starting' | 'running' | 'failed';
  /** 就绪后才非 null：URL 里的不透明会话键（16 字节 hex） */
  wsKey: string | null;
  /** dsh 的 launch token（`?token=` 不可省） */
  token: string | null;
  /** 容器在隔离网络里的 ip:port（nginx 反代目标） */
  upstream: string | null;
  /** 直连 URL（仅本机/内网验证用） */
  directUrl: string | null;
  /** 反代基址 */
  publicBase: string | null;
  /** 「进入实验环境」应导航到的入口；前端用 `apiUrl()` 转成带部署前缀后再跳转 */
  enterUrl: string | null;
  startedAt: number;
  lastSeenAt: number;
  error?: string;
}

// ---------- 章节幻灯片（reveal.js） ----------

export type SlideLayout =
  | 'cover'
  | 'section'
  | 'agenda'
  | 'bullets'
  | 'steps'
  | 'stat'
  | 'compare'
  | 'two-col'
  | 'code'
  | 'quote'
  | 'image'
  | 'image-full'
  | 'image-left'
  | 'image-right'
  | 'image-grid'
  | 'end';

/** deck 内容真源（与后端 server/src/slides/deck.schema.ts 一一对应） */
export interface SlideStat {
  value: string;
  label: string;
  detail?: string;
}

export interface SlideCompare {
  leftTitle?: string;
  rightTitle?: string;
  left: string[];
  right: string[];
}

/** 单张图片引用：只允许 `file:<fileId>`（平台内文件），渲染前由前端取内容转成 data URL */
export interface SlideImage {
  url: string;
  caption?: string;
}

export interface SlideJson {
  id: string;
  layout: SlideLayout;
  /** 眉题（封面/分节页上方的小字，如课程名） */
  kicker?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  /** stat：大数字（1–4 个） */
  stats?: SlideStat[];
  /** compare：左右两栏带列标题的要点清单 */
  compare?: SlideCompare;
  /** two-col：两栏 Markdown */
  left?: string;
  right?: string;
  code?: { lang: string; content: string };
  quote?: { text: string; cite?: string };
  /** image / image-full / image-left / image-right：单图（left/right 另配 bullets） */
  image?: SlideImage;
  /** image-grid：多图网格（1–4 张） */
  images?: SlideImage[];
  notes?: string;
  attrs?: { background?: string; transition?: string; className?: string };
}

export interface SlideDeckConfig {
  transition?: 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom';
  slideNumber?: boolean | 'c/t';
  progress?: boolean;
  hash?: boolean;
  controls?: boolean;
  center?: boolean;
  loop?: boolean;
}

/** 模板"可视化调参"的结构化值（v1 不允许自由写 CSS） */
/** 语义模型（v2）的页面意图 —— 由渲染层映射到版式（见 web/src/slides/semantic/） */
export type SemanticIntent =
  | 'cover' | 'toc' | 'section' | 'claim' | 'contrast' | 'pillars' | 'metric'
  | 'sequence' | 'flow' | 'arch' | 'relation' | 'timeline' | 'table' | 'example'
  | 'quote' | 'image' | 'summary';

/** 语义内容块（结构化数据，图形由渲染层画；模型只提供数据） */
export interface SemanticBlock {
  kind: string;
  [key: string]: unknown;
}

export interface SemanticPage {
  id?: string;
  intent: SemanticIntent;
  kicker?: string;
  title?: string;
  subtitle?: string;
  lede?: string;
  number?: string;
  blocks: SemanticBlock[];
  notes?: string;
}

/** deck 的一页：语义模型（v2）或旧版式模型（v1）—— 两者共用同一列，按结构自辨识 */
export type DeckSlide = SlideJson | SemanticPage;

/** 「换版式」下拉用的 intent 清单（教师可见的中文名） */
export const SEMANTIC_INTENT_OPTIONS: { value: SemanticIntent; label: string }[] = [
  { value: 'cover', label: '封面' },
  { value: 'toc', label: '目录 / 脉络' },
  { value: 'section', label: '分节页' },
  { value: 'claim', label: '主张 + 证据' },
  { value: 'contrast', label: '两栏对照' },
  { value: 'pillars', label: '并列要素' },
  { value: 'metric', label: '关键数字' },
  { value: 'sequence', label: '步骤' },
  { value: 'flow', label: '流程管线' },
  { value: 'arch', label: '分层结构' },
  { value: 'relation', label: '关系图' },
  { value: 'timeline', label: '时间线' },
  { value: 'table', label: '数据表' },
  { value: 'example', label: '代码示例' },
  { value: 'quote', label: '引用' },
  { value: 'image', label: '图片页' },
  { value: 'summary', label: '小结' },
];

export interface SlideTemplateDesign {
  primary?: string;
  background?: string;
  text?: string;
  accent?: string;
  fontFamily?: string;
  headingFontFamily?: string;
  footerText?: string;
  logoFileId?: string | null;
  radius?: number;
  density?: 'compact' | 'cozy' | 'loose';
  /** 字号阶梯：整体基准字号 */
  fontScale?: 'compact' | 'standard' | 'large';
  /** 要点/对比栏的卡片化处理 */
  cardStyle?: 'none' | 'soft' | 'outline';
}

export interface SlideTemplateView {
  id: string;
  name: string;
  description: string | null;
  baseTheme: string;
  design: SlideTemplateDesign;
  /** 服务端已编译好的 CSS 变量块 */
  css: string;
  config: SlideDeckConfig | null;
  isBuiltin: boolean;
}

export type SlideDeckStatus = 'empty' | 'generating' | 'ready' | 'failed';

export interface SlideDeckView {
  id: string;
  chapterId: string;
  courseId: string;
  title: string;
  /** v2（语义模型）或 v1（旧版式模型） */
  slides: DeckSlide[];
  /** true = 语义 deck：Markdown 只是只读预览，编辑面收窄为「换主题 / 换版式 / 重生成当前页」 */
  semantic: boolean;
  markdown: string;
  templateId: string | null;
  config: SlideDeckConfig;
  status: SlideDeckStatus;
  generatedBy: string | null;
  model: string | null;
  tokensUsed: number | null;
  basedOnChapterHash: string | null;
  error: string | null;
  warnings: string | null;
  updatedAt: string;
}

export interface ChapterSlidesResponse {
  deck: SlideDeckView | null;
  chapterHash: string;
  /** 生成之后章节内容又被改过 —— 只提示，绝不自动重生成 */
  chapterChanged: boolean;
  template: SlideTemplateView;
  /** 学生端为空数组 */
  templates: SlideTemplateView[];
  canEdit: boolean;
  generator: {
    generator: string;
    baseUrl?: string | null;
    model?: string | null;
    keyEnv?: string | null;
    keyConfigured?: boolean;
  };
}
