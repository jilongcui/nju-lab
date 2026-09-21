import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Segmented, Typography, message, theme } from 'antd';
import { ExperimentOutlined, LockOutlined, SmileOutlined, UserOutlined } from '@ant-design/icons';
import { register } from '../../api';
import { useAuthStore } from '../../stores/auth';
import type { Role } from '../../types';

const { Title, Text } = Typography;

interface FormValues {
  username: string;
  password: string;
  nickname: string;
  role: Role;
}

export default function Register() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { token } = theme.useToken();

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      const res = await register(values);
      const accessToken = res.accessToken ?? res.token;
      if (!accessToken) throw new Error('注册响应缺少 token');
      setAuth(accessToken, res.user);
      message.success('注册成功');
      navigate(res.user.role === 'teacher' ? '/teacher/dashboard' : '/student/courses', { replace: true });
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
      <Card style={{ width: 400, boxShadow: token.boxShadowSecondary }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <ExperimentOutlined style={{ fontSize: 36, color: token.colorPrimary }} />
          <Title level={3} style={{ margin: '8px 0 4px' }}>
            注册 NJU-Lab
          </Title>
          <Text type="secondary">创建教师或学生账号</Text>
        </div>
        <Form<FormValues>
          layout="vertical"
          onFinish={onFinish}
          requiredMark={false}
          initialValues={{ role: 'student' }}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="登录用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}>
            <Input prefix={<SmileOutlined />} placeholder="展示用昵称" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Segmented
              block
              options={[
                { label: '学生', value: 'student' },
                { label: '教师', value: 'teacher' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            注册
          </Button>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Text type="secondary">
              已有账号？<Link to="/login">去登录</Link>
            </Text>
          </div>
        </Form>
      </Card>
    </div>
  );
}
