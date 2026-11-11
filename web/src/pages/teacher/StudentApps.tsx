import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Empty,
  List,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  appSiteUrl,
  listAppMessages,
  listCourseApps,
  listCourses,
  publishApp,
  unpublishApp,
} from '../../api';
import type { AgentApp, AgentAppMessage, Course } from '../../types';
import { formatDateTime } from '../../applicationState';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

const STATUS_META: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  published: { text: '已发布', color: 'success' },
  archived: { text: '已下架', color: 'error' },
};

const VISIBILITY_META: Record<string, string> = {
  owner: '仅作者',
  teacher: '教师可见',
  course: '课程内可见',
};

/** 教师：学生应用管理（预览 / 对话记录 / 下架） */
export default function StudentApps() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AgentApp[]>([]);
  const [preview, setPreview] = useState<AgentApp | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [messages, setMessages] = useState<AgentAppMessage[] | null>(null);
  const [messageApp, setMessageApp] = useState<AgentApp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useAuxiliaryPanel(
    '教师视角',
    <div>
      <Paragraph type="secondary">
        学生「发布」后应用出现在这里。你可以直接预览（会拉起学生应用容器）、查看对话记录，
        必要时**下架** —— 下架只停容器并把状态改成「已下架」，产物与记录都留着。
      </Paragraph>
      <Paragraph type="secondary">
        一期口径：教师能看到全部课程的应用；学生应用的对话记录会落库，用于教学复盘与答疑。
        免登录的公开分享是二期，见 <Text code>docs/DESIGN-2026-11-agent-app-platform.md</Text>。
      </Paragraph>
    </div>,
  );

  const loadCourses = useCallback(async () => {
    const list = (await listCourses()) ?? [];
    setCourses(list);
    if (!courseId && list.length > 0) setCourseId(list[0].id);
  }, [courseId]);

  const loadApps = useCallback(async () => {
    if (!courseId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      setRows((await listCourseApps(courseId)) ?? []);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const toggle = async (app: AgentApp) => {
    setBusy(app.id);
    try {
      if (app.status === 'published') {
        await unpublishApp(app.id);
        message.success('已下架');
      } else {
        await publishApp(app.id);
        message.success('已重新发布');
      }
      await loadApps();
    } finally {
      setBusy(null);
    }
  };

  const openMessages = async (app: AgentApp) => {
    setMessageApp(app);
    setMessages(null);
    try {
      setMessages((await listAppMessages(app.id, 200)) ?? []);
    } catch {
      setMessages([]);
    }
  };

  const columns: ColumnsType<AgentApp> = [
    {
      title: '应用',
      dataIndex: 'title',
      render: (value: string, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{value}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.scenario || '未填场景'}
          </Text>
        </Space>
      ),
    },
    {
      title: '学生 ID',
      dataIndex: 'studentId',
      width: 150,
      render: (value: string) => <Text code>{value.slice(0, 8)}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => (
        <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.text ?? value}</Tag>
      ),
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      width: 110,
      render: (value: string) => VISIBILITY_META[value] ?? value,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      width: 300,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => {
            setPreview(row);
            setPreviewKey((k) => k + 1);
          }}>
            预览
          </Button>
          <Button size="small" onClick={() => void openMessages(row)}>
            对话记录
          </Button>
          <Popconfirm
            title={row.status === 'published' ? '下架这个应用？' : '重新发布这个应用？'}
            onConfirm={() => void toggle(row)}
          >
            <Button size="small" danger={row.status === 'published'} loading={busy === row.id}>
              {row.status === 'published' ? '下架' : '恢复发布'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={<Title level={4}>学生应用</Title>}
        extra={
          <Space>
            <Select
              style={{ width: 280 }}
              placeholder="选择课程"
              value={courseId}
              onChange={setCourseId}
              options={courses.map((c) => ({ label: c.title, value: c.id }))}
            />
            <Button onClick={() => void loadApps()}>刷新</Button>
          </Space>
        }
      >
        <Paragraph type="secondary">
          学生把第 20 章的 harness 做成应用后，会在这里出现。预览会拉起他的应用容器（首次约 30–60 秒）。
        </Paragraph>
        {loading ? (
          <Skeleton active />
        ) : rows.length === 0 ? (
          <Empty description="这门课还没有学生发布应用" />
        ) : (
          <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} />
        )}
      </Card>

      <Drawer
        title={preview ? `预览：${preview.title}` : '预览'}
        open={!!preview}
        onClose={() => setPreview(null)}
        width={980}
        destroyOnClose
      >
        {preview ? (
          <iframe
            key={previewKey}
            title="teacher-app-preview"
            src={appSiteUrl(preview.id)}
            style={{ width: '100%', height: '80vh', border: '1px solid #eee', borderRadius: 8 }}
          />
        ) : null}
      </Drawer>

      <Drawer
        title={messageApp ? `对话记录：${messageApp.title}` : '对话记录'}
        open={!!messageApp}
        onClose={() => setMessageApp(null)}
        width={560}
      >
        {messages === null ? (
          <Skeleton active />
        ) : messages.length === 0 ? (
          <Empty description="还没有对话记录" />
        ) : (
          <List
            dataSource={[...messages].reverse()}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space>
                    <Tag color={item.role === 'user' ? 'blue' : 'green'}>
                      {item.role === 'user' ? '学生' : '应用'}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTime(item.createdAt)}
                    </Text>
                  </Space>
                  <Text>{item.content}</Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </div>
  );
}
