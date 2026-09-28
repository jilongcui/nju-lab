import { Navigate, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from './stores/auth';
import type { Role } from './types';
import AppLayout from './layouts/AppLayout';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import CasCallback from './pages/auth/CasCallback';
import CourseBrowse from './pages/courses/CourseBrowse';
import CourseDetail from './pages/courses/CourseDetail';
import TeacherDashboard from './pages/teacher/Dashboard';
import CourseList from './pages/teacher/CourseList';
import TeacherCourseDetail from './pages/teacher/CourseDetail';
import ChapterEdit from './pages/teacher/ChapterEdit';
import ChapterSlides from './pages/teacher/ChapterSlides';
import ProjectDetail from './pages/teacher/ProjectDetail';
import ProjectList from './pages/teacher/ProjectList';
import Grading from './pages/teacher/Grading';
import StudentHome from './pages/student/Home';
import MyCourses from './pages/student/MyCourses';
import StudentCourseDetail from './pages/student/CourseDetail';
import ChapterRead from './pages/student/ChapterRead';
import ExperimentDetail from './pages/student/ExperimentDetail';
import MySubmissions from './pages/student/MySubmissions';
import MyApplications from './pages/student/MyApplications';
import ClientDownload from './pages/student/ClientDownload';
import Workspace from './pages/student/Workspace';

/** 登录后的默认落地页：各自的工作台 */
function homeOf(role?: Role) {
  return role === 'teacher' || role === 'admin'
    ? '/teacher/dashboard'
    : '/student/home';
}

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  // 管理员可访问教师侧全部页面
  const allowed =
    user && (user.role === role || (role === 'teacher' && user.role === 'admin'));
  if (user && !allowed) {
    return <Navigate to={homeOf(user.role)} replace />;
  }
  return <>{children}</>;
}

function IndexRedirect() {
  const user = useAuthStore((s) => s.user);
  return <Navigate to={homeOf(user?.role)} replace />;
}

/** 兜底：未登录一律进登录页（平台内容登录后可见） */
function NotFoundRedirect() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  return <Navigate to={token ? homeOf(user?.role) : '/login'} replace />;
}

const teacher = (node: ReactNode) => <RequireRole role="teacher">{node}</RequireRole>;
const student = (node: ReactNode) => <RequireRole role="student">{node}</RequireRole>;

const router = createBrowserRouter([
  // ---------- 认证入口 ----------
  { path: '/login', element: <Login /> },
  { path: '/login/cas', element: <CasCallback /> },
  { path: '/register', element: <Register /> },
  // ---------- 平台内（需登录） ----------
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <IndexRedirect /> },

      // 选课：课程目录 → 课程详情 → 申请
      { path: 'browse', element: student(<CourseBrowse />) },
      { path: 'course/:slug', element: student(<CourseDetail />) },

      // 教师端
      { path: 'teacher/dashboard', element: teacher(<TeacherDashboard />) },
      { path: 'teacher/courses', element: teacher(<CourseList />) },
      { path: 'teacher/courses/:courseId', element: teacher(<TeacherCourseDetail />) },
      { path: 'teacher/chapters/:chapterId/edit', element: teacher(<ChapterEdit />) },
      { path: 'teacher/chapters/:chapterId/slides', element: teacher(<ChapterSlides />) },
      { path: 'teacher/projects', element: teacher(<ProjectList />) },
      { path: 'teacher/projects/:projectId', element: teacher(<ProjectDetail />) },
      { path: 'teacher/submissions/:submissionId/grade', element: teacher(<Grading />) },
      // 实验环境两个角色都可用（教师用于课堂演示）
      { path: 'teacher/workspace', element: teacher(<Workspace />) },

      // 学生端
      { path: 'student/home', element: student(<StudentHome />) },
      { path: 'student/courses', element: student(<MyCourses />) },
      { path: 'student/courses/:courseId', element: student(<StudentCourseDetail />) },
      { path: 'student/chapters/:chapterId', element: student(<ChapterRead />) },
      { path: 'student/projects/:projectId', element: student(<ExperimentDetail />) },
      { path: 'student/applications', element: student(<MyApplications />) },
      { path: 'student/submissions', element: student(<MySubmissions />) },
      { path: 'student/client', element: student(<ClientDownload />) },
      { path: 'student/workspace', element: student(<Workspace />) },
    ],
  },
  { path: '*', element: <NotFoundRedirect /> },
], {
  // 子目录部署（VITE_BASE=/lab/）时路由挂在 /lab 下
  basename: import.meta.env.BASE_URL,
});

export default function App() {
  return <RouterProvider router={router} />;
}
