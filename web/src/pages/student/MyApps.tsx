import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
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
  appSiteUrl,
  createApp,
  listMyApps,
  publishApp,
  startApp,
  unpublishApp,
  uploadAppVersion,
} from '../../api';
import type { AgentApp } from '../../types';
import { formatDateTime } from '../../applicationState';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

const STATUS_META: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  published: { text: '已发布', color: 'success' },
  archived: { text: '已下架', color: 'error' },
};

const VISIBILITY_META: Record<string, string> = {
  owner: '仅自己',
  teacher: '教师可见',
  course: '课程内可见',
};

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
  const [form] = Form.useForm<{ title: string; scenario?: string }>();

  useAuxiliaryPanel(
    '怎么用这一页',
    <div>
      <Paragraph type="secondary">
        一个应用 = 一版产物（zip：根目录下有 <Text code>app.json</Text> 与{' '}
        <Text code>harness/api.py</Text>）+ 一个按需启动的运行容器。
      </Paragraph>
      <Paragraph type="secondary">
        先「上传产物」，再「发布」；「预览」会拉起你的应用（第一次约 30–60 秒）。下架会停掉容器，
        但产物与对话记录都留着，可以再发布回来。
      </Paragraph>
      <Paragraph type="secondary">
        在实验环境里做完全部自测后，把整个 Skill 根打成 zip 上传即可。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await listMyApps()) ?? []);
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
      message.success('已发布：教师可以在「学生应用」里看到它');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleUnpublish = async (app: AgentApp) => {
    setBusy(app.id);
    try {
      await unpublishApp(app.id);
      message.success('已下架（容器已停，产物保留）');
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
      width: 120,
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
      width: 320,
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
          {row.status === 'published' ? (
            <Popconfirm title="下架这个应用？" onConfirm={() => void handleUnpublish(row)}>
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
          把第 19 章的 harness 接到前端上，做成一个能给别人用的小应用：上传产物 → 发布 → 分享给老师。
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
              <Descriptions.Item label="可见性">
                {VISIBILITY_META[preview.visibility] ?? preview.visibility}
              </Descriptions.Item>
              <Descriptions.Item label="入口">{preview.entry}</Descriptions.Item>
            </Descriptions>
            <iframe
              key={previewKey}
              title="app-preview"
              src={appSiteUrl(preview.id)}
              style={{ width: '100%', height: 560, border: '1px solid #eee', borderRadius: 8 }}
            />
          </>
        ) : null}
      </Modal>
    </div>
  );
}
