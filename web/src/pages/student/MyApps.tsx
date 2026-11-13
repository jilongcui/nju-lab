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
  Tooltip,
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
  createAppFromSubmission,
  deleteApp,
  getAppReview,
  listAppVersions,
  listMyApps,
  listSkillSubmissions,
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
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillSubs, setSkillSubs] = useState<{ submissionId: string; version: number; submittedAt: string }[] | null>(null);
  const [skillPicked, setSkillPicked] = useState<string | undefined>();
  const [skillCreating, setSkillCreating] = useState(false);
  const [form] = Form.useForm<{ title: string; scenario?: string }>();

  useAuxiliaryPanel(
    '怎么用这一页',
    <div>
      <Paragraph type="secondary">
        <Text strong>主路径</Text>：在工作台里写好 <Text code>Skill</Text>（<Text code>SKILL.md</Text> +{' '}
        <Text code>scripts/api.py</Text> + 可选 <Text code>profile.json</Text>）→ 提交 → 回来点
        「<Text strong>用我的 Skill 创建应用</Text>」→ 平台自动装包、发布，给你分享链接。
      </Paragraph>
      <Paragraph type="secondary">
        <strong>一个 Skill = 一个应用</strong>：agent 是平台提供的运行时（可定制名字/语气/签名），
        真正决定"这个应用能干什么"的是 Skill。
      </Paragraph>
      <Paragraph type="secondary">
        「预览」会拉起你的应用（第一次约 30–60 秒）；「分享链接」给的是**匿名可打开**的地址；
        下架会让链接立刻失效，但产物、版本与对话记录都留着。老师按 rubric 评分，显示在「评分」列。
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
      const app = await createApp(values);
      setCreateOpen(false);
      form.resetFields();
      await load();
      // 关键引导：产物在**远端工作台容器**里，网页选不到文件 —— 直接给出要跑的命令
      const cmd = `python3 publish_app.py --app ${app.id} --publish`;
      Modal.success({
        title: '应用已创建，下一步在工作台里交产物',
        width: 640,
        content: (
          <div>
            <Paragraph type="secondary">
              你的代码和工作区都在**平台实验环境（远端容器）**里，网页这边选不到那些文件。
              到「实验环境」里在你的 Skill 根目录执行下面这条命令即可（它会打包
              <Text code>app.json/app_host.py/harness/web/kb</Text> 并上传、发布）：
            </Paragraph>
            <Paragraph>
              <Text code copyable>{cmd}</Text>
            </Paragraph>
            <Paragraph type="secondary" style={{ fontSize: 12 }}>
              应用 id：<Text code copyable>{app.id}</Text>
            </Paragraph>
          </div>
        ),
      });
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

  /** 用"已提交的 Skill 包"一键建应用（平台装包、发布、给分享链接；学生不碰命令行） */
  const openSkillDialog = async () => {
    setSkillOpen(true);
    setSkillSubs(null);
    setSkillPicked(undefined);
    try {
      setSkillSubs((await listSkillSubmissions()) ?? []);
    } catch {
      setSkillSubs([]);
    }
  };

  const handleCreateFromSkill = async () => {
    if (!skillPicked) {
      message.warning('先选一次提交');
      return;
    }
    setSkillCreating(true);
    try {
      const app = await createAppFromSubmission({ submissionId: skillPicked });
      setSkillOpen(false);
      await load();
      Modal.success({
        title: '应用已生成并发布',
        width: 560,
        content: (
          <div>
            <Paragraph type="secondary">
              平台已把你的 Skill 装成应用（附件解析、记忆、安全兜底都由平台提供）。
              打开「预览」看看效果，点「分享链接」就能发给别人（不用登录）。
            </Paragraph>
            <Paragraph>
              应用地址：<Text code copyable>{`${window.location.origin}${appSiteUrl(app.id)}`}</Text>
            </Paragraph>
          </div>
        ),
      });
    } finally {
      setSkillCreating(false);
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

  /** 产物在工作区容器里：把"去工作台跑这条命令"的完整命令复制给学生 */
  const copyUploadCommand = async (app: AgentApp) => {
    const cmd = `python3 publish_app.py --app ${app.id} --publish`;
    try {
      await navigator.clipboard.writeText(cmd);
      message.success('已复制：到平台「实验环境」里粘贴执行（会打包并发布）');
    } catch {
      Modal.info({ title: '在实验环境里执行这条命令', content: <Text code>{cmd}</Text> });
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

  /**
   * 预览必须走**匿名分享地址**：iframe 导航带不上 JWT（浏览器不会把 localStorage 里的 token 塞进
   * iframe 请求），用登录态接口 `/apps/:id/site` 只会拿到 401（2026-11-13 实测）。
   * 所以「先发布」是预览的前提 —— 发布本身就一键，代价很低。
   */
  const previewSrc = (app: AgentApp) =>
    app.shareKey
      ? `${window.location.origin}${appShareUrl(app.shareKey)}`
      : `${window.location.origin}${appSiteUrl(app.id)}`;

  const columns: ColumnsType<AgentApp> = [
    {
      title: '标题',
      dataIndex: 'title',
      width: 260,
      ellipsis: true,
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
      width: 130,
      render: (value: string, row) => (
        <Space direction="vertical" size={2}>
          <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.text ?? value}</Tag>
          {!row.latestVersionId ? <Tag color="orange">待上传产物</Tag> : null}
        </Space>
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
      title: '操作',
      width: 400,
      fixed: 'right',
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
          <Button
            size="small"
            disabled={!row.shareKey}
            title={row.shareKey ? '匿名预览（和分享给别人的一样）' : '先发布，才能预览'}
            onClick={() => void openPreview(row)}
          >
            预览
          </Button>
          <Button size="small" onClick={() => void copyUploadCommand(row)}>
            上传命令
          </Button>
          <Button size="small" onClick={() => void openVersions(row)}>
            版本
          </Button>
          <Button
            size="small"
            disabled={!row.shareKey}
            title={row.shareKey ? '复制无需登录的分享链接' : '先上传产物并发布，才会有分享链接'}
            onClick={() => void copyShare(row)}
          >
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
          <Space>
            <Tooltip title="把你的 Skill 包（SKILL.md + scripts/）交给平台，自动装成可分享的应用">
              <Button onClick={() => void openSkillDialog()}>用我的 Skill 创建应用</Button>
            </Tooltip>
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新建空应用
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary">
          <Text strong>推荐路径</Text>：在工作台里把 Skill 写好并提交 → 回来点「<Text strong>用我的 Skill 创建应用</Text>」
          → 平台自动装包、起容器、发布 → 点「分享链接」发给别人（**不用登录就能打开**）。
          附件解析、记忆、安全兜底、前端都由平台提供，你只写 Skill。
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          下面两个按钮是给"高级用法"留的：「新建空应用」+「上传产物」适合本地已有完整产物 zip 的情况。
        </Paragraph>
        {loading ? (
          <Skeleton active />
        ) : rows.length === 0 ? (
          <Empty description="还没有应用，点右上角「新建应用」" />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 1180 }}
          />
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

      <Modal
        title="用我的 Skill 创建应用"
        open={skillOpen}
        onCancel={() => setSkillOpen(false)}
        onOk={() => void handleCreateFromSkill()}
        okText="生成并发布"
        confirmLoading={skillCreating}
        width={640}
      >
        <Paragraph type="secondary">
          选一次提交：平台会把那份 Skill 包（<Text code>SKILL.md</Text> + <Text code>scripts/</Text>）
          装进平台的 agent，生成一个能打开、能分享的应用。你不需要打包、不需要跑命令。
        </Paragraph>
        {skillSubs === null ? (
          <Skeleton active />
        ) : skillSubs.length === 0 ? (
          <Empty description="还没有可用的提交：先在工作台里提交一次 Skill 包" />
        ) : (
          <List
            dataSource={skillSubs}
            renderItem={(item) => (
              <List.Item
                onClick={() => setSkillPicked(item.submissionId)}
                style={{
                  cursor: 'pointer',
                  background: skillPicked === item.submissionId ? 'rgba(47,111,235,0.06)' : undefined,
                  borderRadius: 6,
                  paddingLeft: 8,
                }}
              >
                <List.Item.Meta
                  title={<Space><Text code>{item.submissionId.slice(0, 8)}</Text><Tag>第 {item.version} 版</Tag></Space>}
                  description={formatDateTime(item.submittedAt)}
                />
              </List.Item>
            )}
          />
        )}
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
