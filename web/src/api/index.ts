import client from './client';
import { apiUrl } from '../config';
import type {
  Assignment,
  Chapter,
  ClaimResult,
  Course,
  CourseApplicationRow,
  CourseApplicationsView,
  CourseDashboard,
  CourseProgress,
  Enrollment,
  Evaluation,
  ExperimentProject,
  MyApplication,
  MyCourse,
  CatalogCourseBrief,
  CatalogCourseDetail,
  ProjectDashboard,
  ProjectSubmissionRow,
  Role,
  StoredFileInfo,
  StudentUser,
  Submission,
  TeacherProjectRow,
  TeacherSummary,
  User,
  WorkspaceInfo,
} from '../types';

// ---------- 文件 ----------
/** 上传文件（multipart），返回 fileId 与服务端 sha256 */
export const uploadFile = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return client.post<unknown, StoredFileInfo>('/files', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
};

/** 经 axios（带 JWT）下载存储文件并触发浏览器保存 */
export const downloadStoredFile = async (info: StoredFileInfo) => {
  const blob = await client.get<unknown, Blob>(apiUrl(info.url), {
    responseType: 'blob',
    timeout: 120000,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = info.originalName;
  a.click();
  URL.revokeObjectURL(url);
};

/** 导出项目成绩 CSV（经 axios 带 JWT，触发浏览器保存） */
export const downloadGradesCsv = async (projectId: string, projectTitle: string) => {
  const blob = await client.get<unknown, Blob>(`/projects/${projectId}/grades.csv`, {
    responseType: 'blob',
    timeout: 60000,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectTitle}-成绩.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ---------- 认证 ----------
export interface LoginPayload {
  username: string;
  password: string;
}
export interface RegisterPayload extends LoginPayload {
  nickname: string;
  role: Role;
}
export interface AuthResult {
  /** 后端实际返回 accessToken，token 仅作兼容兜底 */
  accessToken?: string;
  token?: string;
  user: User;
}

export const login = (data: LoginPayload) =>
  client.post<unknown, AuthResult>('/auth/login', data);
export const register = (data: RegisterPayload) =>
  client.post<unknown, AuthResult>('/auth/register', data);
/** 生成长期 API token（365 天，供本地 DSH 插件使用） */
export const issueApiToken = () =>
  client.post<unknown, { accessToken: string }>('/me/tokens');
/** 吊销本人全部 token（含当前 Web 登录态） */
export const revokeApiTokens = () =>
  client.post<unknown, { revoked: boolean }>('/me/tokens/revoke');
/** 修改密码（成功后全部 token 失效，需重新登录） */
export const changePassword = (data: { oldPassword: string; newPassword: string }) =>
  client.post<unknown, { changed: boolean }>('/me/password', data);

// ---------- 课程（教师侧） ----------
export const listCourses = () => client.get<unknown, Course[]>('/courses');
export const getCourse = (id: string) => client.get<unknown, Course>(`/courses/${id}`);
export const createCourse = (data: Partial<Course>) =>
  client.post<unknown, Course>('/courses', data);
export const updateCourse = (id: string, data: Partial<Course>) =>
  client.patch<unknown, Course>(`/courses/${id}`, data);
export const deleteCourse = (id: string) => client.delete<unknown, null>(`/courses/${id}`);
export const publishCourse = (id: string) =>
  client.post<unknown, Course>(`/courses/${id}/publish`);
export const getCourseProgress = (id: string) =>
  client.get<unknown, CourseProgress>(`/courses/${id}/progress`);
export const getCourseDashboard = (id: string) =>
  client.get<unknown, CourseDashboard>(`/courses/${id}/dashboard`);
export const getTeacherSummary = () =>
  client.get<unknown, TeacherSummary>('/dashboard/teacher-summary');

// ---------- 选课学生管理 ----------
export const listStudents = () => client.get<unknown, StudentUser[]>('/users/students');
export const listEnrollments = (courseId: string) =>
  client.get<unknown, Enrollment[]>(`/courses/${courseId}/enrollments`);
export const addEnrollments = (courseId: string, studentIds: string[]) =>
  client.post<unknown, Enrollment[]>(`/courses/${courseId}/enrollments`, { studentIds });
export const removeEnrollment = (courseId: string, studentId: string) =>
  client.delete<unknown, null>(`/courses/${courseId}/enrollments/${studentId}`);

// ---------- 章节 ----------
/** upsert：带 id 为更新（可切换 status 实现发布/下线） */
export const saveChapter = (courseId: string, data: Partial<Chapter>) =>
  client.post<unknown, Chapter>(`/courses/${courseId}/chapters`, data);
export const getChapter = (id: string) => client.get<unknown, Chapter>(`/chapters/${id}`);
export const deleteChapter = (id: string) => client.delete<unknown, null>(`/chapters/${id}`);

// ---------- 实验项目 ----------
export const listProjects = () =>
  client.get<unknown, TeacherProjectRow[]>('/projects');
export const getProject = (id: string) =>
  client.get<unknown, ExperimentProject>(`/projects/${id}`);
export const createProject = (data: Partial<ExperimentProject>) =>
  client.post<unknown, ExperimentProject>('/projects', data);
/** 注意：后端 PATCH 为整体替换，调用方必须提交完整字段集 */
export const updateProject = (id: string, data: Partial<ExperimentProject>) =>
  client.patch<unknown, ExperimentProject>(`/projects/${id}`, data);
export const deleteProject = (id: string) => client.delete<unknown, null>(`/projects/${id}`);
export const publishProject = (id: string) =>
  client.post<unknown, ExperimentProject>(`/projects/${id}/publish`);
export const listProjectSubmissions = (id: string) =>
  client.get<unknown, ProjectSubmissionRow[]>(`/projects/${id}/submissions`);
export const getProjectDashboard = (id: string) =>
  client.get<unknown, ProjectDashboard>(`/projects/${id}/dashboard`);

// ---------- 提交与批改 ----------
export const getSubmission = (id: string) =>
  client.get<unknown, Submission>(`/submissions/${id}`);
export const verifySubmission = (id: string) =>
  client.post<unknown, Submission>(`/submissions/${id}/verify`);
export const getSubmissionEvaluation = (id: string) =>
  client.get<unknown, Evaluation>(`/submissions/${id}/evaluation`);
export const gradeSubmission = (id: string, data: { teacherScore: number; teacherComment: string }) =>
  client.post<unknown, Submission>(`/submissions/${id}/grade`, data);

// ---------- 学生侧 ----------
export const listMyCourses = () => client.get<unknown, MyCourse[]>('/me/courses');
export const completeChapter = (id: string) =>
  client.post<unknown, Chapter>(`/chapters/${id}/complete`);
export const listMyAssignments = () => client.get<unknown, Assignment[]>('/me/assignments');
export const claimAssignment = (id: string) =>
  client.post<unknown, ClaimResult>(`/assignments/${id}/claim`);
export interface SubmitPayload {
  /** 已上传文件 id（POST /api/files 获得），与 ref+sha256 直填二选一 */
  skillZipFileId?: string;
  skillZipRef?: string;
  skillZipSha256?: string;
  capsuleFileId?: string;
  capsuleRef?: string;
  capsuleSha256?: string;
  auditEvents?: unknown[];
}
export const submitAssignment = (id: string, data: SubmitPayload) =>
  client.post<unknown, Submission>(`/assignments/${id}/submit`, data);
/** 提交版本历史（学生限本人任务，教师限课程 owner），按版本号降序 */
export const listAssignmentVersions = (id: string) =>
  client.get<unknown, Submission[]>(`/assignments/${id}/submissions`);
/** :id 为评估结果（evaluation）ID */
export const getMyEvaluation = (id: string) =>
  client.get<unknown, Evaluation>(`/me/evaluations/${id}`);

// ---------- 课程目录与详情（选课用，需登录） ----------
export const listCatalogCourses = (params?: { keyword?: string; term?: string }) =>
  client.get<unknown, CatalogCourseBrief[]>('/browse/courses', { params });
export const getCatalogCourse = (slug: string) =>
  client.get<unknown, CatalogCourseDetail>(`/browse/courses/${slug}`);

// ---------- 课程申请（学生） ----------
export const applyCourse = (courseId: string) =>
  client.post<unknown, CourseApplicationRow>(`/courses/${courseId}/applications`);
export const withdrawApplication = (courseId: string, id: string) =>
  client.delete<unknown, null>(`/courses/${courseId}/applications/${id}`);
export const listMyApplications = () =>
  client.get<unknown, MyApplication[]>('/me/applications');

// ---------- 报名审批（教师） ----------
export const listCourseApplications = (courseId: string) =>
  client.get<unknown, CourseApplicationsView>(`/courses/${courseId}/applications`);
export const approveApplication = (courseId: string, id: string) =>
  client.post<unknown, CourseApplicationRow>(
    `/courses/${courseId}/applications/${id}/approve`,
  );
export const rejectApplication = (courseId: string, id: string, note?: string) =>
  client.post<unknown, CourseApplicationRow>(
    `/courses/${courseId}/applications/${id}/reject`,
    { note },
  );

// ---------- 平台侧实验工作台（本地装不上 DSH 时的浏览器兜底环境） ----------
/** 启动（或复用）自己的工作台；**立即返回**，就绪状态由 `getWorkspaceStatus` 轮询推进 */
export const startWorkspace = () =>
  client.post<unknown, WorkspaceInfo>('/workspace/start');
/** 查询状态；从未启动过时后端返回 `null` */
export const getWorkspaceStatus = () =>
  client.get<unknown, WorkspaceInfo | null>('/workspace/status');
/** 主动结束工作台（幂等） */
export const stopWorkspace = () =>
  client.post<unknown, { stopped: boolean }>('/workspace/stop');
