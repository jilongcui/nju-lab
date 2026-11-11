import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  activateAppVersion,
  appShareUrl,
  appSiteUrl,
  createApp,
  deleteApp,
  getAppReview,
  listAppVersions,
  listMyApps,
  publishApp,
  startApp,
  unpublishApp,
  updateApp,
  uploadAppVersion,
} from '../../api';
import type { AgentApp, AgentAppReview, AgentAppVersion } from '../../types';
import { formatDateTime } from '../../applicationState';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

const STATUS_META: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  published: { text: '已发布', color: 'success' },
  archived: { text: '已下架', color: 'error' },
};

const VISIBILITY_OPTIONS = [
  { value: 'owner', label: '仅自己' },
  { value: 'teacher', label: '教师可见' },
  { value: 'course', label: '课程内可见' },
];

/** 学生：我的应用（第 20 章 —— 把 harness 做成可分享的应用） */
export default function MyApps() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgentApp[]>([]);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [preview, setPreview] = useState<AgentApp | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<Record<string, AgentAppReview | null>>({});
  const [versionApp, setVersionApp] = useState<AgentApp | null>(null);
  const [versions, setVersions] = useState<AgentAppVersion[] | null>(null);
  const [form] = Form.useForm<{ title: string; scenario?: string }>();

  useAuxiliaryPanel(
    '怎么用这一页',
    <div>
      <Paragraph type="secondary">
        一个应用 = 一版产物（zip：根目录下有 <Text code>app.json</Text> 与{' '}
        <Text code>harness/api.py</Text>）+ 一个按需启动的运行容器。
      </Paragraph>
      <Paragraph type="secondary">
        先「上传产物」，再「发布」；「预览」会拉起你的应用（第一次约 30–60 秒）。
        <strong>发布后可以「分享链接」</strong>发给别人（不需要登录也能打开）；
        下架会立刻让分享链接失效，但产物、版本与对话记录都留着。
      </Paragraph>
      <Paragraph type="secondary">
        老师看完会给分（总分 + 评语），评分显示在列表的「评分」列。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await listMyApps()) ?? [];
      setRows(list);
      const entries = await Promise.all(
        list.map(async (app) => [app.id, await getAppReview(app.id).catch(() => null)] as const),
      );
      setReview(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const values = await form.validateFields();
    setCreating(true);
    try {
      await createApp(values);
      message.success('已创建，接着上传一版产物');
      setCreateOpen(false);
      form.resetFields();
      await load();
    } finally {
      setCreating(false);
    }
  };

  const handleUpload = async (app: AgentApp, file: UploadFile) => {
    if (!file.originFileObj) return;
    setUploading(app.id);
    try {
      await uploadAppVersion(app.id, file.originFileObj as File);
      message.success('产物已上传（记得点发布）');
      await load();
    } finally {
      setUploading(null);
    }
  };

  const handlePublish = async (app: AgentApp) => {
    setBusy(app.id);
    try {
      await publishApp(app.id);
      message.success('已发布：可以复制分享链接了');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleUnpublish = async (app: AgentApp) => {
    setBusy(app.id);
    try {
      await unpublishApp(app.id);
      message.success('已下架（分享链接同时失效；产物与记录保留）');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (app: AgentApp) => {
    setBusy(app.id);
    try {
      await deleteApp(app.id);
      message.success('已删除');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleVisibility = async (app: AgentApp, visibility: string) => {
    setBusy(app.id);
    try {
      await updateApp(app.id, { visibility: visibility as AgentApp['visibility'] });
      message.success('可见性已更新');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const copyShare = async (app: AgentApp) => {
    if (!app.shareKey) {
      message.warning('先发布，才会有分享链接');
      return;
    }
    const url = `${window.location.origin}${appShareUrl(app.shareKey)}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('分享链接已复制（无需登录即可打开）');
    } catch {
      Modal.info({ title: '分享链接', content: url });
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
      message.success('已切到该版本（下次预览用新版本重建容器）');
      await openVersions(versionApp);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const openPreview = async (app: AgentApp) => {
    setPreview(app);
    setPreviewKey((k) => k + 1);
    setPreviewLoading(true);
    try {
      await startApp(app.id);
    } catch {
      // 起容器失败时 iframe 会显示错误页，这里不额外弹窗
    } finally {
      setPreviewLoading(false);
    }
  };

  /** 预览走登录态地址（作者能看未发布的）；「分享链接」按钮给的是匿名地址 */
  const previewSrc = (app: AgentApp) => `${window.location.origin}${appSiteUrl(app.id)}`;

  const columns: ColumnsType<AgentApp> = [
    {
      title: '标题',
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
      width: 150,
      render: (value: string, row) => (
        <Select
          size="small"
          style={{ width: 120 }}
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
        review[id] ? <Text strong>{review[id]?.total} 分</Text> : <Text type="secondary">未评</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      width: 400,
      render: (_, row) => (
        <Space wrap>
          <Upload
            accept=".zip"
            showUploadList={false}
            beforeUpload={() => false}
            onChange={({ file }) => void handleUpload(row, file)}
          >
            <Button size="small" loading={uploading === row.id}>
              上传产物
            </Button>
          </Upload>
          <Button size="small" onClick={() => void openPreview(row)}>
            预览
          </Button>
          <Button size="small" onClick={() => void openVersions(row)}>
            版本
          </Button>
          <Button size="small" disabled={!row.shareKey} onClick={() => void copyShare(row)}>
            分享链接
          </Button>
          <Popconfirm
            title="删除这个应用？产物、版本与对话记录都会删掉，不可恢复（只想停用就点下架）"
            onConfirm={() => void handleDelete(row)}
          >
            <Button size="small" danger loading={busy === row.id}>
              删除
            </Button>
          </Popconfirm>
          {row.status === 'published' ? (
            <Popconfirm title="下架这个应用？（分享链接会失效）" onConfirm={() => void handleUnpublish(row)}>
              <Button size="small" danger loading={busy === row.id}>
                下架
              </Button>
            </Popconfirm>
          ) : (
            <Button
              size="small"
              type="primary"
              disabled={!row.latestVersionId}
              loading={busy === row.id}
              onClick={() => void handlePublish(row)}
            >
              发布
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={<Title level={4}>我的应用</Title>}
        extra={
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建应用
          </Button>
        }
      >
        <Paragraph type="secondary">
          把第 19 章的 harness 接到前端上，做成一个能给别人用的小应用：上传产物 → 发布 →
          复制分享链接（匿名可打开）→ 老师评分。
        </Paragraph>
        {loading ? (
          <Skeleton active />
        ) : rows.length === 0 ? (
          <Empty description="还没有应用，点右上角「新建应用」" />
        ) : (
          <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} />
        )}
      </Card>

      <Modal
        title="新建应用"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        confirmLoading={creating}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：门诊数据整理助手" maxLength={120} />
          </Form.Item>
          <Form.Item name="scenario" label="场景（一句话）">
            <Input placeholder="例如：把 PDF / Word 里的检验数据按口径整理成报告" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={preview ? `预览：${preview.title}` : '预览'}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
        width={980}
        destroyOnClose
      >
        {previewLoading ? (
          <Alert type="info" showIcon message="正在启动应用容器（首次约 30–60 秒）…" />
        ) : null}
        {preview ? (
          <>
            <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="状态">
                {STATUS_META[preview.status]?.text ?? preview.status}
              </Descriptions.Item>
              <Descriptions.Item label="入口">{preview.entry}</Descriptions.Item>
              <Descriptions.Item label="评分">
                {review[preview.id] ? `${review[preview.id]?.total} 分` : '未评'}
              </Descriptions.Item>
            </Descriptions>
            <iframe
              key={previewKey}
              title="app-preview"
              src={previewSrc(preview)}
              style={{ width: '100%', height: 560, border: '1px solid #eee', borderRadius: 8 }}
            />
          </>
        ) : null}
      </Modal>

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
                    <Space direction="vertical" size={0}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(item.createdAt)} · sha256 {item.sha256.slice(0, 12)}
                      </Text>
                      {item.note ? <Text type="secondary">{item.note}</Text> : null}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </div>
  );
}
