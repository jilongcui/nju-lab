import { Navigate, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from './stores/auth';
import type { Role } from './types';
import AppLayout from './layouts/AppLayout';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import CasCallback from './pages/auth/CasCallback';
import TeacherDashboard from './pages/teacher/Dashboard';
import CourseList from './pages/teacher/CourseList';
import CourseDetail from './pages/teacher/CourseDetail';
import ChapterEdit from './pages/teacher/ChapterEdit';
import ProjectDetail from './pages/teacher/ProjectDetail';
import ProjectList from './pages/teacher/ProjectList';
import Grading from './pages/teacher/Grading';
import MyCourses from './pages/student/MyCourses';
import StudentCourseDetail from './pages/student/CourseDetail';
import ChapterRead from './pages/student/ChapterRead';
import ExperimentDetail from './pages/student/ExperimentDetail';
import MySubmissions from './pages/student/MySubmissions';
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

const teacher = (node: ReactNode) => <RequireRole role="teacher">{node}</RequireRole>;
const student = (node: ReactNode) => <RequireRole role="student">{node}</RequireRole>;

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/login/cas', element: <CasCallback /> },
  { path: '/register', element: <Register /> },
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
      { path: 'teacher/chapters/:chapterId/edit', element: teacher(<ChapterEdit />) },
      { path: 'teacher/projects', element: teacher(<ProjectList />) },
      { path: 'teacher/projects/:projectId', element: teacher(<ProjectDetail />) },
      { path: 'teacher/submissions/:submissionId/grade', element: teacher(<Grading />) },
      { path: 'student/courses', element: student(<MyCourses />) },
      { path: 'student/courses/:courseId', element: student(<StudentCourseDetail />) },
      { path: 'student/chapters/:chapterId', element: student(<ChapterRead />) },
      { path: 'student/projects/:projectId', element: student(<ExperimentDetail />) },
      { path: 'student/submissions', element: student(<MySubmissions />) },
      { path: 'student/client', element: student(<ClientDownload />) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
], {
  // 子目录部署（VITE_BASE=/lab/）时路由挂在 /lab 下
  basename: import.meta.env.BASE_URL,
});

export default function App() {
  return <RouterProvider router={router} />;
}
