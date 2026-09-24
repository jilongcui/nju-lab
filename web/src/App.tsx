import { Navigate, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from './stores/auth';
import type { Role } from './types';
import AppLayout from './layouts/AppLayout';
import PublicLayout from './layouts/PublicLayout';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import CasCallback from './pages/auth/CasCallback';
import CourseBrowse from './pages/public/CourseBrowse';
import PublicCourseDetail from './pages/public/PublicCourseDetail';
import TeacherDashboard from './pages/teacher/Dashboard';
import CourseList from './pages/teacher/CourseList';
import CourseDetail from './pages/teacher/CourseDetail';
import CourseApplications from './pages/teacher/CourseApplications';
import ChapterEdit from './pages/teacher/ChapterEdit';
import ProjectDetail from './pages/teacher/ProjectDetail';
import ProjectList from './pages/teacher/ProjectList';
import Grading from './pages/teacher/Grading';
import MyCourses from './pages/student/MyCourses';
import StudentCourseDetail from './pages/student/CourseDetail';
import ChapterRead from './pages/student/ChapterRead';
import ExperimentDetail from './pages/student/ExperimentDetail';
import MySubmissions from './pages/student/MySubmissions';
import MyApplications from './pages/student/MyApplications';
import ClientDownload from './pages/student/ClientDownload';

function homeOf(role?: Role) {
  return role === 'teacher' || role === 'admin'
    ? '/teacher/dashboard'
    : '/student/courses';
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

/**
 * 兜底路由。原先一律重定向到 `/`，而 `/` 在 RequireAuth 下——
 * 未登录访客访问任何未知路径都会被弹到登录页。公开区上线后改为：
 * 匿名 → 课程目录；已登录 → 角色首页。
 */
function NotFoundRedirect() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  return <Navigate to={token ? homeOf(user?.role) : '/browse'} replace />;
}

const teacher = (node: ReactNode) => <RequireRole role="teacher">{node}</RequireRole>;
const student = (node: ReactNode) => <RequireRole role="student">{node}</RequireRole>;

const router = createBrowserRouter([
  // ---------- 公开区：无需登录 ----------
  {
    element: <PublicLayout />,
    children: [
      { path: '/browse', element: <CourseBrowse /> },
      { path: '/course/:slug', element: <PublicCourseDetail /> },
    ],
  },
  // ---------- 认证 ----------
  { path: '/login', element: <Login /> },
  { path: '/login/cas', element: <CasCallback /> },
  { path: '/register', element: <Register /> },
  // ---------- 私域区：需登录 ----------
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <IndexRedirect /> },
      { path: 'teacher/dashboard', element: teacher(<TeacherDashboard />) },
      { path: 'teacher/courses', element: teacher(<CourseList />) },
      { path: 'teacher/courses/:courseId', element: teacher(<CourseDetail />) },
      {
        path: 'teacher/courses/:courseId/applications',
        element: teacher(<CourseApplications />),
      },
      { path: 'teacher/chapters/:chapterId/edit', element: teacher(<ChapterEdit />) },
      { path: 'teacher/projects', element: teacher(<ProjectList />) },
      { path: 'teacher/projects/:projectId', element: teacher(<ProjectDetail />) },
      { path: 'teacher/submissions/:submissionId/grade', element: teacher(<Grading />) },
      { path: 'student/courses', element: student(<MyCourses />) },
      { path: 'student/courses/:courseId', element: student(<StudentCourseDetail />) },
      { path: 'student/chapters/:chapterId', element: student(<ChapterRead />) },
      { path: 'student/projects/:projectId', element: student(<ExperimentDetail />) },
      { path: 'student/applications', element: student(<MyApplications />) },
      { path: 'student/submissions', element: student(<MySubmissions />) },
      { path: 'student/client', element: student(<ClientDownload />) },
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
