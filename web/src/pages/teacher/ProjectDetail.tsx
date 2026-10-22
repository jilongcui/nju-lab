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
  getCourse,
  getProject,
  getProjectDashboard,
  listProjectSubmissions,
  resetAssignment,
  publishProject,
  updateProject,
  uploadFile,
} from '../../api';
import type { Chapter, ExperimentProject, ProjectDashboard, ProjectSubmissionRow, RubricItem, StoredFileInfo } from '../../types';
import StatusTag from '../../components/StatusTag';
import MarkdownView from '../../components/MarkdownView';
import { DEFAULT_DIFFICULTY, DIFFICULTY_FORM_OPTIONS, DifficultyTag } from '../../utils/difficulty';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

/**
 * 推理档位可选值 —— 必须与 dsh `dsh-llm-deepseek` **实际接受**的集合一致。
 *
 * 2026-10-01 在 pkg2 镜像内实测：`off` / `low` / `high` / `max` 均可跑通复验；
 * 其余取值会在学生 claim 之后**每个请求**上、于网络 I/O 之前抛
 * `UNSUPPORTED_REASONING_EFFORT`（源码里是 `["low","high","max"].includes(effort) ||
 * thinking === "disabled" && effort === "off"` 的判定）。
 *
 * ⚠️ 这**不是** DeepSeek 官方 API 的 `reasoning_effort`（none|minimal|low|medium|high|xhigh|max），
 * 早先误按官方取值给的下拉框会把学生端整个实验卡死。
 * 留空 = 用 provider 默认（verify profile 里钉的是 low）。
 */
const EFFORT_OPTIONS = ['off', 'low', 'high', 'max'].map((v) => ({ label: v, value: v }));

function percent(rate?: number) {
  return rate != null ? Math.round(rate * 100) : null;
}

/** 模板/题目包上传控件：上传即调用 POST /api/files，本地持有 StoredFileInfo */
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
  const [problemFile, setProblemFile] = useState<StoredFileInfo | null>(null);
  /** 所属章节候选（同课程内的章节）—— 用于纠正"实验挂错章节" */
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [form] = Form.useForm();

  useAuxiliaryPanel(
    '实验项目说明',
    <div>
      <Paragraph type="secondary">
        本页分三块：<b>实验内容</b>（学生详情页首屏看到的"这个实验做什么"）、
        <b>实验指导</b>（背景、任务口径、评分维度 —— 学生展开折叠看）、
        <b>运行环境与评估配置</b>（模型与推理档位、超时、解锁规则、材料文件）。
      </Paragraph>
      <Paragraph type="secondary">
        发布后学生方可按解锁规则领取；提交后可在下方表格进入批改。注意：保存为整体替换，请确认各字段完整。
      </Paragraph>
    </div>,
  );

  /** 教师替某个学生重置领取状态（历史提交保留，学生需要重新领取） */
  const handleResetAssignment = async (assignmentId: string) => {
    try {
      await resetAssignment(assignmentId);
      message.success('已重置为未领取（历史提交仍保留）');
      await load();
    } catch {
      /* 错误已由 axios 拦截器统一提示 */
    }
  };

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

  // 章节候选：只在课程变化时拉一次（getCourse 返回的 chapters 已带 order/title）
  useEffect(() => {
    if (!project?.courseId) return;
    void getCourse(project.courseId)
      .then((c) => setChapters([...(c.chapters ?? [])].sort((a, b) => a.order - b.order)))
      .catch(() => setChapters([]));
  }, [project?.courseId]);

  const openEdit = () => {
    if (!project) return;
    setTemplateFile(project.skillTemplate ?? null);
    setProblemFile(project.problem ?? null);
    form.setFieldsValue({
      title: project.title,
      chapterId: project.chapterId,
      content: project.content,
      difficulty: project.difficulty ?? DEFAULT_DIFFICULTY,
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
        // 所属章节：允许纠正"实验挂错章节"（后端校验限同一课程内）
        chapterId: values.chapterId,
        content: values.content ?? null,
        // 难度不允许为空：没选就是「中等」（后端列默认值一致）
        difficulty: values.difficulty ?? DEFAULT_DIFFICULTY,
        objectives: values.objectives ?? null,
        background: values.background ?? null,
        description: values.description ?? null,
        skillTemplateFileId: templateFile?.fileId ?? null,
        problemFileId: problemFile?.fileId ?? null,
        references: values.references ?? null,
        faq: values.faq ?? null,
        evalConfig: {
          model: values.evalModel,
          reasoningEffort: values.evalEffort,
          tools: values.evalTools ?? [],
          timeoutSeconds: values.evalTimeout,
          // 下面两项不在本表单里编辑，但要原样带回去 —— 否则每次保存都会把它们抹掉
          // （平台侧可用它们做成本控制；缺省时由题目包的 manifest 决定）
          ...(project?.evalConfig?.judgeMode ? { judgeMode: project.evalConfig.judgeMode } : {}),
          ...(project?.evalConfig?.maxCases ? { maxCases: project.evalConfig.maxCases } : {}),
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
          <DifficultyTag difficulty={project.difficulty} />
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

      {/* ① 实验内容：学生详情页首屏看到的东西 */}
      <Card
        title="实验内容（学生详情页首屏）"
        extra={<DifficultyTag difficulty={project.difficulty} />}
        style={{ marginBottom: 16 }}
      >
        <MarkdownView
          content={project.content ?? undefined}
          emptyText="还没填写实验内容 —— 学生详情页首屏会是空的。建议从题目包的 task.md 提炼「这个实验做什么」。"
        />
        {(project.objectives ?? '').trim() && (
          <>
            <Title level={5} style={{ marginTop: 24 }}>
              实验目标
            </Title>
            <MarkdownView content={project.objectives ?? undefined} />
          </>
        )}
      </Card>

      {/* ② 实验指导：学生展开折叠看的内容 */}
      <Card title="实验指导（学生端收在折叠区）" style={{ marginBottom: 16 }}>
        <Title level={5}>背景知识</Title>
        <MarkdownView content={project.background ?? undefined} />
        <Title level={5}>任务要求（口径）</Title>
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

      {/* ③ 运行环境与评估配置：老师要了解的技术细节 */}
      <Card title="运行环境与评估配置" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="截止时间">
            {project.deadline ? dayjs(project.deadline).format('YYYY-MM-DD HH:mm') : '未设置'}
          </Descriptions.Item>
          <Descriptions.Item label="解锁规则">
            {project.unlockRule?.type === 'none' ? '无限制' : '完成本实验所属章节（默认）'}
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
          <Descriptions.Item label="题目包">
            {project.problem ? (
              <a onClick={() => void downloadStoredFile(project.problem!)}>
                {project.problem.originalName}
              </a>
            ) : (
              '-'
            )}
          </Descriptions.Item>
        </Descriptions>
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
                r.submission ? (
                  <Space size={4}>
                    <Text>v{r.submission.version}</Text>
                    <StatusTag status={r.submission.status} />
                    {(r.versionCount ?? 0) > 1 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        共 {r.versionCount} 版
                      </Text>
                    )}
                  </Space>
                ) : (
                  <Text type="secondary">未提交</Text>
                ),
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
              render: (_, r) => (
                <Space size={8}>
                  {r.submission ? (
                    <Link to={`/teacher/submissions/${r.submission.id}/grade`}>批改</Link>
                  ) : null}
                  {r.assignmentStatus !== 'pending' ? (
                    <Popconfirm
                      title="重置这个学生的领取状态？"
                      description="重置后他需要重新领取（会重新下发模板）；历史提交仍保留。"
                      okText="重置"
                      cancelText="取消"
                      onConfirm={() => void handleResetAssignment(r.assignmentId)}
                    >
                      <Button size="small" type="link" danger>
                        重置领取
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      未领取
                    </Text>
                  )}
                </Space>
              ),
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
          <Form.Item
            name="chapterId"
            label="所属章节"
            extra="用于纠正「实验挂错章节」：只可在本课程内移动。默认解锁规则按新章节重新判定（需完成它所属的章节）"
          >
            <Select
              style={{ width: 360 }}
              options={chapters.map((c, i) => ({ label: `${i + 1}. ${c.title}`, value: c.id }))}
            />
          </Form.Item>
          <Form.Item
            name="content"
            label="实验内容（学生详情页首屏）"
            extra="学生第一眼看到的就是它：这个实验做什么（业务背景 / 要交付什么）。建议从题目包 task.md 提炼；技术口径放「任务要求」，别堆在这里。"
          >
            <Input.TextArea rows={8} placeholder={'例如：\n## 业务背景\n…\n\n## 你的任务\n…'} />
          </Form.Item>
          <Space size={16} wrap>
            <Form.Item
              name="difficulty"
              label="难度等级"
              extra="学生可按难度挑选：容易 / 中等 / 提高（默认「中等」；难度总有一个值，不能为空）"
              rules={[{ required: true, message: '请选择难度' }]}
            >
              <Select options={DIFFICULTY_FORM_OPTIONS} style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item name="objectives" label="实验目标（学生详情页首屏，紧随实验内容）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="background" label="背景知识（学生端「实验指导」折叠区）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="description" label="任务要求 / 技术口径（学生端「实验指导」折叠区）">
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
              extra="off / low / high / max（dsh 实际支持的集合）；留空 = 用 provider 默认（low）。填其他值（如官方 API 的 medium/xhigh）会让学生端每个请求都失败"
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
                  { label: '完成本实验所属章节（默认）', value: 'default' },
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
            label="题目包"
            value={problemFile}
            onChange={setProblemFile}
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
