import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Col,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  activateAppVersion,
  appShareUrl,
  getAppReview,
  getCourseAppCosts,
  listAppMessages,
  listAppVersions,
  listCourseApps,
  listCourses,
  publishApp,
  reviewApp as submitReviewApi,
  unpublishApp,
  updateApp,
} from '../../api';
import type {
  AgentApp,
  AgentAppMessage,
  AgentAppReview,
  AgentAppVersion,
  AppCostBoard,
  Course,
} from '../../types';
import { formatDateTime } from '../../applicationState';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

/** 大数目折算：1.2k / 3.4M（看板里 token 动辄六位数，直接显示会挤爆表格） */
function formatTokens(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

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
  /** 成本看板（四期）：模型调用次数 / token 用量，落库统计，重启不清零 */
  const [costs, setCosts] = useState<AppCostBoard | null>(null);
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
        口径：教师能看到全部课程的应用；学生应用的对话记录会落库，用于教学复盘与答疑。
        评分按「总分 + 评语」记，已汇总进项目成绩单（项目详情「应用评分」列 + 成绩 CSV 的
        「应用 / 应用评分 / 应用评语」三列，取该生在该项目下的最高分）。
      </Paragraph>
      <Paragraph type="secondary">
        顶部是成本看板：学生应用的模型调用次数与 token 用量（平台代理累计、落库保存，
        重启不清零）。复验消耗的 token 在项目成绩单的「Token成本」列，两者口径不同。
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
      setCosts(await getCourseAppCosts(courseId).catch(() => null));
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
      width: 260,
      render: (value: string, row) => (
        <Space direction="vertical" size={0} style={{ maxWidth: 250 }}>
          <Text strong ellipsis={{ tooltip: value }}>
            {value}
          </Text>
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
      // 成本看板（四期）：这个应用调了多少次模型、花了多少 token（平台代理累计，落库）
      title: '模型用量',
      width: 130,
      render: (_, row) =>
        (row.llmCalls ?? 0) > 0 ? (
          <Space direction="vertical" size={0}>
            <Text>{row.llmCalls} 次</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatTokens(row.llmTokens ?? 0)} tokens
            </Text>
          </Space>
        ) : (
          <Text type="secondary">未调用</Text>
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 150,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      width: 340,
      fixed: 'right',
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
        {costs && (
          <Card size="small" style={{ marginBottom: 16, background: 'rgba(0,0,0,0.02)' }}>
            <Row gutter={24} align="middle">
              <Col span={5}>
                <Statistic title="学生应用" value={costs.totals.apps} suffix="个" />
              </Col>
              <Col span={6}>
                <Statistic title="模型调用（累计）" value={costs.totals.calls} suffix="次" />
              </Col>
              <Col span={7}>
                <Statistic title="消耗 token（累计）" value={costs.totals.tokens} />
              </Col>
              <Col span={6}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  只统计平台模型代理（应用对话）；重启不清零。
                  复验跑的 token 在项目成绩单的「Token成本」列。
                </Text>
              </Col>
            </Row>
            {costs.students.length > 0 && (
              <Table
                size="small"
                style={{ marginTop: 12 }}
                rowKey="studentId"
                pagination={false}
                dataSource={costs.students}
                columns={[
                  { title: '学生', dataIndex: 'studentName' },
                  { title: '应用数', dataIndex: 'apps', width: 90 },
                  { title: '模型调用', dataIndex: 'calls', width: 110 },
                  {
                    title: 'token',
                    dataIndex: 'tokens',
                    width: 120,
                    render: (v: number) => formatTokens(v),
                  },
                ]}
              />
            )}
          </Card>
        )}
        {loading ? (
          <Skeleton active />
        ) : rows.length === 0 ? (
          <Empty description="这门课还没有学生发布应用" />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={false}
            // 加了「模型用量」列后总宽超过内容区，不给 scroll.x 会把标题压成竖排（2026-11-13 真机踩到）
            scroll={{ x: 1320 }}
          />
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
          preview.shareKey ? (
            <>
              <Text type="secondary" style={{ fontSize: 12 }}>
                预览在沙箱里运行（学生页面拿不到平台登录态）；这是学生实际分享出去的那条链路。
              </Text>
              <iframe
                key={previewKey}
                title="teacher-app-preview"
                src={`${window.location.origin}${appShareUrl(preview.shareKey)}`}
                // 不给 allow-same-origin：学生页面在 opaque origin 里跑，读不到平台 cookie/localStorage
                sandbox="allow-scripts allow-forms allow-popups allow-downloads"
                style={{ width: '100%', height: '80vh', border: '1px solid #eee', borderRadius: 8 }}
              />
            </>
          ) : (
            <Alert
              type="warning"
              showIcon
              message="这个应用还没发布，无法预览"
              description="学生发布后才能用匿名地址预览（iframe 带不上登录凭证）。"
            />
          )
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
