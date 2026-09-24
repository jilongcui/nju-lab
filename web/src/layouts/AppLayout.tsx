import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Breadcrumb,
  Button,
  Dropdown,
  Form,
  Input,
  Layout,
  Menu,
  message,
  Modal,
  Popconfirm,
  Popover,
  Switch,
  theme,
  Tooltip,
  Typography,
} from 'antd';
import {
  BookOutlined,
  CheckOutlined,
  CloudDownloadOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { changePassword, issueApiToken, revokeApiTokens } from '../api';
import { withBase } from '../config';
import { useAuthStore } from '../stores/auth';
import { PRESET_COLORS, useThemeStore } from '../stores/theme';
import AuxiliaryPanel from './AuxiliaryPanel';

const { Sider, Header, Content } = Layout;
const { Text, Paragraph } = Typography;

const SEGMENT_LABELS: Record<string, string> = {
  teacher: '教师端',
  student: '学生端',
  dashboard: '工作台',
  courses: '课程',
  chapters: '章节',
  edit: '编辑',
  projects: '实验项目',
  submissions: '提交与反馈',
  client: '客户端下载',
  grade: '批改',
};

const MENUS = {
  teacher: [
    { key: '/teacher/dashboard', icon: <DashboardOutlined />, label: '工作台' },
    { key: '/teacher/courses', icon: <BookOutlined />, label: '课程管理' },
    { key: '/teacher/projects', icon: <ExperimentOutlined />, label: '实验项目' },
  ],
  student: [
    { key: '/student/courses', icon: <BookOutlined />, label: '我的课程' },
    { key: '/student/submissions', icon: <FileDoneOutlined />, label: '我的提交与反馈' },
    { key: '/student/client', icon: <CloudDownloadOutlined />, label: '客户端下载' },
  ],
};

function ColorPalette() {
  const { colorPrimary, setColorPrimary } = useThemeStore();
  return (
    <div style={{ display: 'flex', gap: 8, padding: 4 }}>
      {PRESET_COLORS.map((c) => (
        <Tooltip key={c.value} title={c.name}>
          <div
            onClick={() => setColorPrimary(c.value)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: c.value,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 12,
            }}
          >
            {colorPrimary === c.value && <CheckOutlined />}
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { dark, setDark } = useThemeStore();
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdForm] = Form.useForm();

  // 管理员使用教师菜单
  const role = user?.role === 'admin' ? 'teacher' : (user?.role ?? 'student');
  const menuItems = MENUS[role];

  const selectedKey = useMemo(() => {
    const hit = menuItems
      .map((m) => m.key)
      .filter((k) => location.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return hit ?? menuItems[0]?.key;
  }, [location.pathname, menuItems]);

  const breadcrumbs = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    return segments.map((seg, i) => ({
      title: SEGMENT_LABELS[seg] ?? '详情',
      key: segments.slice(0, i + 1).join('/'),
    }));
  }, [location.pathname]);

  const handleLogout = () => {
    // 只清本地 token 不够：统一认证会话还在，会被自动登回去（换不了账号）。
    // 再走一趟 CAS 登出终止会话 —— 后端端点会 302 到 authserver 的 logout。
    // 注意：api/client.ts 里 401 拦截器的被动登出**不**走这里（token 过期不该把人从统一认证里踢出去）。
    logout();
    window.location.href = withBase('api/auth/cas/logout');
  };

  const handleIssueToken = async () => {
    setTokenBusy(true);
    try {
      const { accessToken } = await issueApiToken();
      setApiToken(accessToken);
    } finally {
      setTokenBusy(false);
    }
  };

  const handleRevokeTokens = async () => {
    setTokenBusy(true);
    try {
      await revokeApiTokens();
      message.success('已吊销全部 token，请重新登录');
      logout();
      navigate('/login');
    } finally {
      setTokenBusy(false);
    }
  };

  const handleChangePassword = async () => {
    const values = await pwdForm.validateFields();
    setPwdBusy(true);
    try {
      await changePassword({ oldPassword: values.oldPassword, newPassword: values.newPassword });
      message.success('密码已修改，请用新密码重新登录（本地 DSH 插件的 token 也需重新生成）');
      logout();
      navigate('/login');
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 菜单区 */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={208}
        style={{ background: token.colorBgContainer, borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <ExperimentOutlined style={{ fontSize: 22, color: token.colorPrimary }} />
          {!collapsed && (
            <Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>
              NJU-Lab
            </Text>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', flex: 1 }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            width: '100%',
            padding: 12,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            textAlign: 'center',
          }}
        >
          <Button type="text" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '»' : '« 收起菜单'}
          </Button>
        </div>
      </Sider>

      {/* 功能区 */}
      <Layout>
        <Header
          style={{
            height: 56,
            lineHeight: 'normal',
            padding: '0 24px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Breadcrumb items={breadcrumbs} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Tooltip title={dark ? '切换到明亮模式' : '切换到暗黑模式'}>
              <Switch
                checked={dark}
                onChange={setDark}
                checkedChildren={<MoonOutlined />}
                unCheckedChildren={<SunOutlined />}
              />
            </Tooltip>
            <Popover content={<ColorPalette />} title="主题色" trigger="click" placement="bottomRight">
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  background: token.colorPrimary,
                  cursor: 'pointer',
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              />
            </Popover>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'api-token',
                    icon: <KeyOutlined />,
                    label: 'API Token',
                    onClick: () => {
                      setApiToken(null);
                      setTokenModalOpen(true);
                    },
                  },
                  {
                    key: 'change-password',
                    icon: <LockOutlined />,
                    label: '修改密码',
                    onClick: () => {
                      pwdForm.resetFields();
                      setPwdModalOpen(true);
                    },
                  },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
                ],
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <Avatar size="small" style={{ background: token.colorPrimary }}>
                  {user?.nickname?.[0] ?? user?.username?.[0] ?? '?'}
                </Avatar>
                <Text>{user?.nickname || user?.username}</Text>
              </div>
            </Dropdown>
          </div>
        </Header>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <Content style={{ padding: 24, flex: 1, minWidth: 0, overflow: 'auto' }}>
            <Outlet />
          </Content>
          {/* 辅助区 */}
          <AuxiliaryPanel />
        </div>
      </Layout>

      <Modal
        title="API Token（本地 DSH 插件用）"
        open={tokenModalOpen}
        onCancel={() => setTokenModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Paragraph type="secondary">
          在本地 DSH（nju-lab-student profile）的插件设置中填入此 token，插件即可代表你访问平台。
          有效期 365 天；token 与账号等权，请勿泄露。
        </Paragraph>
        {apiToken ? (
          <>
            <Input.TextArea
              value={apiToken}
              readOnly
              autoSize={{ minRows: 3, maxRows: 6 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              onFocus={(e) => e.target.select()}
            />
            <Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
              请立即复制保存。再次打开本窗口时只能重新生成（旧 token 不受影响，可多次生成）。
            </Paragraph>
          </>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <Popconfirm
            title="吊销全部 token"
            description="你名下所有 token（包括当前 Web 登录）将立即失效，需重新登录。确认？"
            onConfirm={handleRevokeTokens}
          >
            <Button danger loading={tokenBusy}>
              全部吊销
            </Button>
          </Popconfirm>
          <Button type="primary" loading={tokenBusy} onClick={handleIssueToken}>
            {apiToken ? '再生成一个' : '生成 token'}
          </Button>
        </div>
      </Modal>

      <Modal
        title="修改密码"
        open={pwdModalOpen}
        onOk={handleChangePassword}
        onCancel={() => setPwdModalOpen(false)}
        confirmLoading={pwdBusy}
        destroyOnClose
      >
        <Paragraph type="secondary">
          修改成功后，你名下所有 token（Web 登录态与本地 DSH 插件）都会失效，需重新登录并重新生成插件 token。
        </Paragraph>
        <Form form={pwdForm} layout="vertical">
          <Form.Item name="oldPassword" label="旧密码" rules={[{ required: true, message: '请输入旧密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, max: 64, message: '6-64 个字符' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || getFieldValue('newPassword') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
