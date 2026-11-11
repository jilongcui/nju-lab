import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
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
  activateAppVersion,
  appSiteUrl,
  getAppReview,
  listAppMessages,
  listAppVersions,
  listCourseApps,
  listCourses,
  publishApp,
  reviewApp as submitReviewApi,
  unpublishApp,
  updateApp,
} from '../../api';
import type { AgentApp, AgentAppMessage, AgentAppReview, AgentAppVersion, Course } from '../../types';
import { formatDateTime } from '../../applicationState';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

const STATUS_META: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  published: { text: '已发布', color: 'success' },
  archived: { text: '已下架', color: 'error' },
};

const VISIBILITY_OPTIONS = [
  { value: 'owner', label: '仅作者' },
  { value: 'teacher', label: '教师可见' },
  { value: 'course', label: '课程内可见' },
];

/** 教师：学生应用管理（预览 / 对话记录 / 版本回滚 / 评分 / 下架） */
export default function StudentApps() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AgentApp[]>([]);
  const [preview, setPreview] = useState<AgentApp | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [messages, setMessages] = useState<AgentAppMessage[] | null>(null);
  const [messageApp, setMessageApp] = useState<AgentApp | null>(null);
  const [versionApp, setVersionApp] = useState<AgentApp | null>(null);
  const [versions, setVersions] = useState<AgentAppVersion[] | null>(null);
  const [reviewTarget, setReviewTarget] = useState<AgentApp | null>(null);
  const [reviews, setReviews] = useState<Record<string, AgentAppReview | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [form] = Form.useForm<{ total: number; comment?: string }>();

  useAuxiliaryPanel(
    '教师视角',
    <div>
      <Paragraph type="secondary">
        学生「发布」后应用出现在这里。你可以直接预览（会拉起学生应用容器）、查看对话记录、
        回滚到历史版本、评分，必要时**下架** —— 下架只停容器 + 让分享链接失效，产物与记录都留着。
      </Paragraph>
      <Paragraph type="secondary">
        一期口径：教师能看到全部课程的应用；学生应用的对话记录会落库，用于教学复盘与答疑。
        评分按「总分 + 评语」记（维度明细可在二期接入现有成绩单）。
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
      const list = (await listCourseApps(courseId)) ?? [];
      setRows(list);
      const entries = await Promise.all(
        list.map(async (app) => [app.id, await getAppReview(app.id).catch(() => null)] as const),
      );
      setReviews(Object.fromEntries(entries));
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
        message.success('已下架（分享链接同时失效）');
      } else {
        await publishApp(app.id);
        message.success('已重新发布');
      }
      await loadApps();
    } finally {
      setBusy(null);
    }
  };

  const handleVisibility = async (app: AgentApp, visibility: string) => {
    setBusy(app.id);
    try {
      await updateApp(app.id, { visibility: visibility as AgentApp['visibility'] });
      message.success('可见性已更新');
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

  const openVersions = async (app: AgentApp) => {
    setVersionApp(app);
    setVersions(null);
    try {
      setVersions((await listAppVersions(app.id)) ?? []);
    } catch {
      setVersions([]);
    }
  };

  const activate = async (version: AgentAppVersion) => {
    if (!versionApp) return;
    setBusy(versionApp.id);
    try {
      await activateAppVersion(versionApp.id, version.id);
      message.success('已切到该版本');
      await openVersions(versionApp);
      await loadApps();
    } finally {
      setBusy(null);
    }
  };

  const openReview = async (app: AgentApp) => {
    setReviewTarget(app);
    const existing = reviews[app.id] ?? (await getAppReview(app.id).catch(() => null));
    form.setFieldsValue({ total: existing?.total ?? 80, comment: existing?.comment ?? '' });
  };

  const submitReview = async () => {
    if (!reviewTarget) return;
    const values = await form.validateFields();
    setBusy(reviewTarget.id);
    try {
      await submitReviewApi(reviewTarget.id, { total: values.total, comment: values.comment });
      message.success('评分已保存');
      setReviewTarget(null);
      await loadApps();
    } finally {
      setBusy(null);
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
      width: 130,
      render: (value: string) => <Text code>{value.slice(0, 8)}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: string) => (
        <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.text ?? value}</Tag>
      ),
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      width: 130,
      render: (value: string, row) => (
        <Select
          size="small"
          style={{ width: 110 }}
          value={value}
          options={VISIBILITY_OPTIONS}
          disabled={busy === row.id}
          onChange={(next) => void handleVisibility(row, next)}
        />
      ),
    },
    {
      title: '评分',
      dataIndex: 'id',
      width: 90,
      render: (id: string) =>
        reviews[id] ? <Text strong>{reviews[id]?.total} 分</Text> : <Text type="secondary">未评</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 150,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      width: 380,
      render: (_, row) => (
        <Space wrap>
          <Button
            size="small"
            onClick={() => {
              setPreview(row);
              setPreviewKey((k) => k + 1);
            }}
          >
            预览
          </Button>
          <Button size="small" onClick={() => void openMessages(row)}>
            对话记录
          </Button>
          <Button size="small" onClick={() => void openVersions(row)}>
            版本
          </Button>
          <Button size="small" onClick={() => void openReview(row)}>
            评分
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
            src={`${window.location.origin}${appSiteUrl(preview.id)}`}
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

      <Drawer
        title={versionApp ? `版本：${versionApp.title}` : '版本'}
        open={!!versionApp}
        onClose={() => setVersionApp(null)}
        width={560}
      >
        {versions === null ? (
          <Skeleton active />
        ) : versions.length === 0 ? (
          <Empty description="还没有版本" />
        ) : (
          <List
            dataSource={versions}
            renderItem={(item) => (
              <List.Item
                actions={[
                  item.id === versionApp?.latestVersionId ? (
                    <Tag color="green">当前版本</Tag>
                  ) : (
                    <Button
                      size="small"
                      loading={busy === versionApp?.id}
                      onClick={() => void activate(item)}
                    >
                      切到这一版
                    </Button>
                  ),
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Text code>{item.id.slice(0, 8)}</Text>
                      <Text type="secondary">{(item.size / 1024).toFixed(1)} KB</Text>
                    </Space>
                  }
                  description={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTime(item.createdAt)} · sha256 {item.sha256.slice(0, 12)}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      <Modal
        title={reviewTarget ? `评分：${reviewTarget.title}` : '评分'}
        open={!!reviewTarget}
        onCancel={() => setReviewTarget(null)}
        onOk={() => void submitReview()}
        confirmLoading={busy === reviewTarget?.id}
        okText="保存评分"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="total"
            label="总分（0~100）"
            rules={[{ required: true, message: '请输入总分' }]}
          >
            <InputNumber min={0} max={100} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="comment" label="评语（学生能看到）">
            <Input.TextArea rows={4} maxLength={500} showCount placeholder="例如：主题改得不错，报告口径清楚；建议补一条危急值话术" />
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>
          参考口径：托管可用 30 / 前端体验 20 / 分享与权限 10 / 场景完成度 30 / 演示答辩 10。
        </Text>
      </Modal>
    </div>
  );
}
