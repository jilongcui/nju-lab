import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Button, Layout, Space, Typography } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/auth';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

/**
 * 公开区布局：课程目录 / 课程公开页。
 *
 * - **不需要登录**（路由不在 RequireAuth 下），因此不复用 AppLayout（它依赖 user 与菜单）。
 * - 「返回门户」用原生 <a>：站点根 `/` 是 FoxCMS 门户，而 react-router 的 to="/" 会
 *   因为 basename=/lab/ 导航到 /lab/ 自己。
 */
export default function PublicLayout() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const homeOf = () =>
    user?.role === 'teacher' || user?.role === 'admin'
      ? '/teacher/dashboard'
      : '/student/courses';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
        }}
      >
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#fff',
            fontSize: 17,
            fontWeight: 600,
          }}
        >
          <ExperimentOutlined style={{ fontSize: 22 }} />
          南大医学院 AI 实验室 · 实验平台
        </a>
        <Space size="large">
          <Link to="/browse" style={{ color: 'rgba(255,255,255,0.85)' }}>
            课程目录
          </Link>
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
          <a href="/" style={{ color: 'rgba(255,255,255,0.85)' }}>
            返回门户
          </a>
          {token ? (
            <Button ghost onClick={() => navigate(homeOf())}>
              进入平台
            </Button>
          ) : (
            <Button type="primary" onClick={() => navigate('/login')}>
              登录
            </Button>
          )}
        </Space>
      </Header>
      <Content style={{ padding: '24px 24px 0', width: '100%', maxWidth: 1120, margin: '0 auto' }}>
        <Outlet />
      </Content>
      <Footer style={{ textAlign: 'center' }}>
        <Text type="secondary">
          课程目录对外公开；申请加入需登录（南大统一认证），具体教学内容在登录后可见。
        </Text>
      </Footer>
    </Layout>
  );
}
