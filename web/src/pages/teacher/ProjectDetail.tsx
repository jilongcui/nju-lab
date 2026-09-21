import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Typography,
  Upload,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined, SendOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  deleteProject,
  downloadGradesCsv,
  downloadStoredFile,
  getProject,
  getProjectDashboard,
  listProjectSubmissions,
  publishProject,
  updateProject,
  uploadFile,
} from '../../api';
import type { ExperimentProject, ProjectDashboard, ProjectSubmissionRow, RubricItem, StoredFileInfo } from '../../types';
import StatusTag from '../../components/StatusTag';
import MarkdownView from '../../components/MarkdownView';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

// DeepSeek 官方实测（2026-09-21）：reasoning_effort 合法值 none|minimal|low|medium|high|xhigh|max
const EFFORT_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((v) => ({ label: v, value: v }));

function percent(rate?: number) {
  return rate != null ? Math.round(rate * 100) : null;
}

/** 模板/数据集上传控件：上传即调用 POST /api/files，本地持有 StoredFileInfo */
function FilePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: StoredFileInfo | null;
  onChange: (info: StoredFileInfo | null) => void;
}) {
  return (
    <Form.Item label={label}>
      <Space wrap>
        <Upload
          showUploadList={false}
          customRequest={async ({ file, onSuccess, onError }) => {
            try {
              onChange(await uploadFile(file as File));
              onSuccess?.({});
            } catch (err) {
              onError?.(err as Error);
            }
          }}
        >
          <Button icon={<UploadOutlined />}>{value ? '重新上传' : '上传文件'}</Button>
        </Upload>
        {value ? (
          <>
            <Text>
              {value.originalName}
              <Text type="secondary" style={{ fontSize: 12 }}>
                （sha256: {value.sha256.slice(0, 12)}…）
              </Text>
            </Text>
            <Button type="link" danger size="small" onClick={() => onChange(null)}>
              移除
            </Button>
          </>
        ) : (
          <Text type="secondary">未上传</Text>
        )}
      </Space>
    </Form.Item>
  );
}

export default function ProjectDetail() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ExperimentProject | null>(null);
  const [rows, setRows] = useState<ProjectSubmissionRow[]>([]);
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateFile, setTemplateFile] = useState<StoredFileInfo | null>(null);
  const [datasetFile, setDatasetFile] = useState<StoredFileInfo | null>(null);
  const [form] = Form.useForm();

  useAuxiliaryPanel(
    '实验项目说明',
    <div>
      <Paragraph type="secondary">
        本页是数字化实验指导书：目标、背景、任务要求、评估条件（模型与推理档位）、评分维度、截止时间与解锁规则。
      </Paragraph>
      <Paragraph type="secondary">
        发布后学生方可按解锁规则领取；提交后可在下方表格进入批改。注意：保存为整体替换，请确认各字段完整。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, subs, dash] = await Promise.all([
        getProject(projectId),
        listProjectSubmissions(projectId).catch(() => [] as ProjectSubmissionRow[]),
        getProjectDashboard(projectId).catch(() => null),
      ]);
      setProject(p);
      setRows(subs ?? []);
      setDashboard(dash);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = () => {
    if (!project) return;
    setTemplateFile(project.skillTemplate ?? null);
    setDatasetFile(project.testDataset ?? null);
    form.setFieldsValue({
      title: project.title,
      objectives: project.objectives,
      background: project.background,
      description: project.description,
      references: project.references,
      faq: project.faq,
      evalModel: project.evalConfig?.model,
      evalEffort: project.evalConfig?.reasoningEffort,
      evalTools: project.evalConfig?.tools ?? [],
      evalTimeout: project.evalConfig?.timeoutSeconds,
      rubric: project.rubric ?? [],
      unlockType: project.unlockRule?.type ?? 'default',
      deadline: project.deadline ? dayjs(project.deadline) : undefined,
    });
    setEditOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      // 后端 PATCH 为整体替换，必须提交完整字段集
      await updateProject(projectId, {
        title: values.title,
        objectives: values.objectives ?? null,
        background: values.background ?? null,
        description: values.description ?? null,
        skillTemplateFileId: templateFile?.fileId ?? null,
        testDatasetFileId: datasetFile?.fileId ?? null,
        references: values.references ?? null,
        faq: values.faq ?? null,
        evalConfig: {
          model: values.evalModel,
          reasoningEffort: values.evalEffort,
          tools: values.evalTools ?? [],
          timeoutSeconds: values.evalTimeout,
        },
        rubric: (values.rubric ?? []) as RubricItem[],
        unlockRule: { type: values.unlockType ?? 'default' },
        deadline: values.deadline ? (values.deadline as dayjs.Dayjs).toISOString() : null,
      });
      message.success('项目信息已保存');
      setEditOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    await publishProject(projectId);
    message.success('项目已发布');
    await load();
  };

  const handleDelete = async () => {
    if (!project) return;
    await deleteProject(projectId);
    message.success('实验项目已删除');
    navigate(`/teacher/courses/${project.courseId}`, { replace: true });
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }
  if (!project) {
    return <Empty description="实验项目不存在" />;
  }

  const sp = dashboard?.submissionProgress;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            {project.title}
          </Title>
          <StatusTag status={project.status} />
        </Space>
        <Space>
          <Button icon={<EditOutlined />} onClick={openEdit}>
            编辑项目信息
          </Button>
          {project.status === 'draft' && (
            <Popconfirm title="发布后学生可按解锁规则领取，确认发布？" onConfirm={handlePublish}>
              <Button type="primary" icon={<SendOutlined />}>
                发布
              </Button>
            </Popconfirm>
          )}
          <Popconfirm
            title="删除实验项目"
            description="相关任务与学生提交将一并删除且不可恢复，确认？"
            onConfirm={handleDelete}
          >
            <Button danger icon={<DeleteOutlined />}>
              删除实验
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {dashboard && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space size="large" wrap>
            <Statistic title="任务总数" value={sp?.totalAssignments ?? 0} />
            <Statistic title="已提交" value={sp?.submittedCount ?? 0} />
            <Statistic title="已复验评分" value={dashboard.evaluatedCount ?? 0} />
            <Statistic title="平均 Token 成本" value={Math.round(dashboard.tokenCostDistribution?.avg ?? 0)} />
          </Space>
        </Card>
      )}

      <Card title="项目信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="截止时间">
            {project.deadline ? dayjs(project.deadline).format('YYYY-MM-DD HH:mm') : '未设置'}
          </Descriptions.Item>
          <Descriptions.Item label="解锁规则">
            {project.unlockRule?.type === 'none' ? '无限制' : '完成之前全部已发布章节（默认）'}
          </Descriptions.Item>
          <Descriptions.Item label="评估模型">{project.evalConfig?.model || '-'}</Descriptions.Item>
          <Descriptions.Item label="推理档位">{project.evalConfig?.reasoningEffort || '-'}</Descriptions.Item>
          <Descriptions.Item label="工具集白名单">
            {(project.evalConfig?.tools ?? []).length > 0 ? project.evalConfig!.tools!.join(', ') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="超时（秒）">{project.evalConfig?.timeoutSeconds ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Skill 模板">
            {project.skillTemplate ? (
              <a onClick={() => void downloadStoredFile(project.skillTemplate!)}>
                {project.skillTemplate.originalName}
              </a>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="测试数据集">
            {project.testDataset ? (
              <a onClick={() => void downloadStoredFile(project.testDataset!)}>
                {project.testDataset.originalName}
              </a>
            ) : (
              '-'
            )}
          </Descriptions.Item>
        </Descriptions>

        <Title level={5}>实验目标</Title>
        <MarkdownView content={project.objectives ?? undefined} />
        <Title level={5}>背景知识</Title>
        <MarkdownView content={project.background ?? undefined} />
        <Title level={5}>任务要求</Title>
        <MarkdownView content={project.description ?? undefined} />
        <Title level={5}>评分要求（Rubric）</Title>
        {(project.rubric ?? []).length === 0 ? (
          <Text type="secondary">暂未配置评分维度</Text>
        ) : (
          <Table<RubricItem>
            size="small"
            rowKey="name"
            pagination={false}
            dataSource={project.rubric}
            columns={[
              { title: '维度', dataIndex: 'name' },
              { title: '权重（%）', dataIndex: 'weight', width: 120 },
            ]}
          />
        )}
        <Title level={5}>参考资料</Title>
        <MarkdownView content={project.references ?? undefined} />
        <Title level={5}>常见问题</Title>
        <MarkdownView content={project.faq ?? undefined} />
      </Card>

      <Card
        title="学生任务与提交"
        extra={
          <Button
            icon={<DownloadOutlined />}
            onClick={() => void downloadGradesCsv(project.id, project.title)}
          >
            导出成绩 CSV
          </Button>
        }
      >
        <Table<ProjectSubmissionRow>
          rowKey="assignmentId"
          dataSource={rows}
          locale={{ emptyText: <Empty description="暂无任务分发（发布后自动生成）" /> }}
          columns={[
            {
              title: '学生',
              render: (_, r) => (
                <Space size={4}>
                  <Text>{r.student.nickname}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {r.student.username}
                  </Text>
                </Space>
              ),
            },
            { title: '任务状态', dataIndex: 'assignmentStatus', render: (v) => <StatusTag status={v} /> },
            {
              title: '提交状态',
              render: (_, r) =>
                r.submission ? <StatusTag status={r.submission.status} /> : <Text type="secondary">未提交</Text>,
            },
            {
              title: '提交时间',
              render: (_, r) =>
                r.submission?.submittedAt ? dayjs(r.submission.submittedAt).format('YYYY-MM-DD HH:mm') : '-',
            },
            {
              title: '成功率',
              render: (_, r) => {
                const p = percent(r.submission?.evaluation?.successRate);
                return p != null ? `${p}%` : '-';
              },
            },
            {
              title: '评分',
              render: (_, r) => r.submission?.evaluation?.teacherScore ?? '-',
            },
            {
              title: '操作',
              render: (_, r) =>
                r.submission ? <Link to={`/teacher/submissions/${r.submission.id}/grade`}>批改</Link> : '-',
            },
          ]}
        />
      </Card>

      <Modal
        title="编辑实验项目信息"
        open={editOpen}
        onOk={handleSave}
        onCancel={() => setEditOpen(false)}
        confirmLoading={saving}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="实验标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="objectives" label="实验目标">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="background" label="背景知识">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="description" label="任务要求">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Space size={16} wrap>
            <Form.Item
              name="evalModel"
              label="评估模型"
              extra="必须是学生本地 provider 支持的模型名（DSH 默认是 deepseek-flash）"
            >
              <Input placeholder="如 deepseek-flash" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="evalEffort"
              label="推理档位"
              extra="留空：DeepSeek provider 不支持推理档位，填了会让学生端 claim 后每个请求都失败"
            >
              <Select options={EFFORT_OPTIONS} allowClear style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="evalTimeout" label="超时（秒）">
              <InputNumber min={1} style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="evalTools" label="工具集白名单">
            <Select mode="tags" placeholder="输入工具名后回车" />
          </Form.Item>
          <Form.Item label="评分维度与权重">
            <Form.List name="rubric">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" wrap style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item name={[field.name, 'name']} rules={[{ required: true, message: '维度' }]} noStyle>
                        <Input placeholder="维度，如：实测有效性" style={{ width: 240 }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'weight']} rules={[{ required: true, message: '权重' }]} noStyle>
                        <InputNumber placeholder="权重%" min={0} max={100} style={{ width: 110 }} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(field.name)} />
                    </Space>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} block>
                    添加维度
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Space size={16} wrap>
            <Form.Item name="deadline" label="截止时间">
              <DatePicker showTime />
            </Form.Item>
            <Form.Item name="unlockType" label="解锁规则">
              <Select
                style={{ width: 240 }}
                options={[
                  { label: '完成之前全部已发布章节（默认）', value: 'default' },
                  { label: '无限制', value: 'none' },
                ]}
              />
            </Form.Item>
          </Space>
          <FilePicker
            label="Skill 模板（ZIP）"
            value={templateFile}
            onChange={setTemplateFile}
          />
          <FilePicker
            label="标准测试数据集"
            value={datasetFile}
            onChange={setDatasetFile}
          />
          <Form.Item name="references" label="参考资料">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="faq" label="常见问题">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
