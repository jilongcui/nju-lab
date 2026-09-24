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

/** GET /api/public/courses 条目 */
export interface PublicCourseBrief {
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

/** GET /api/public/courses/:slug */
export interface PublicCourseDetail
  extends Omit<PublicCourseBrief, 'chapterCount'> {
  chapters: { id: string; order: number; title: string }[];
  /** 仅登录时返回 */
  myApplication: MyApplicationBrief | null;
  /** 仅登录时返回 */
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
  testDatasetFileId?: string | null;
  /** 模板/数据集文件信息：教师详情恒返回；学生端仅领取后返回 */
  skillTemplate?: StoredFileInfo | null;
  testDataset?: StoredFileInfo | null;
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
  testDataset?: StoredFileInfo | null;
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
  dataset?: string;
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
