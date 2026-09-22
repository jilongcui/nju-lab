import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Typography, theme } from 'antd';
import { ExperimentOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { login } from '../../api';
import { useAuthStore } from '../../stores/auth';
import { withBase } from '../../config';

const { Title, Text } = Typography;

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { token } = theme.useToken();
  const [params] = useSearchParams();
  const casError = params.get('error');

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await login(values);
      const accessToken = res.accessToken ?? res.token;
      if (!accessToken) throw new Error('登录响应缺少 token');
      setAuth(accessToken, res.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/' ? from : res.user.role === 'teacher' || res.user.role === 'admin' ? '/teacher/dashboard' : '/student/courses', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: token.colorBgLayout,
      }}
    >
      <Card style={{ width: 380, boxShadow: token.boxShadowSecondary }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <ExperimentOutlined style={{ fontSize: 36, color: token.colorPrimary }} />
          <Title level={3} style={{ margin: '8px 0 4px' }}>
            NJU-Lab
          </Title>
          <Text type="secondary">课程 + 实验一体化教学平台</Text>
        </div>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          {casError && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message={casError === 'cas-no-ticket' ? '统一认证回调缺少 ticket' : '统一认证校验失败，请重试或改用账号密码登录'}
            />
          )}
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
          <Button
            block
            style={{ marginTop: 12 }}
            onClick={() => {
              window.location.href = withBase('api/auth/cas/login');
            }}
          >
            南京大学统一认证登录
          </Button>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Text type="secondary">
              还没有账号？<Link to="/register">立即注册</Link>
            </Text>
          </div>
        </Form>
      </Card>
    </div>
  );
}
