import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getSubmission,
  getSubmissionEvaluation,
  listMyAssignments,
  submitAssignment,
} from '../../api';
import type { Assignment, Evaluation, Submission } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function pct(rate?: number) {
  return rate != null ? `${Math.round(rate * 100)}%` : '-';
}

interface SubmitFormValues {
  skillZipRef: string;
  skillZipSha256: string;
  capsuleRef: string;
  capsuleSha256: string;
  auditEvents?: string;
}

export default function MySubmissions() {
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submitTarget, setSubmitTarget] = useState<Assignment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ open: boolean; submission: Submission | null; evaluation: Evaluation | null }>({
    open: false,
    submission: null,
    evaluation: null,
  });
  const [form] = Form.useForm<SubmitFormValues>();

  useAuxiliaryPanel(
    '提交须知',
    <div>
      <Paragraph type="secondary">
        提交内容包含：完整 Skill 目录包（ZIP）、.dshc 证据包、两者的 SHA-256 哈希，以及会话审计事件（JSON）。
      </Paragraph>
      <Paragraph type="secondary">评分以平台独立复验为准，学生自报结果仅作参考。</Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAssignments((await listMyAssignments()) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (!submitTarget) return;
    let auditEvents: unknown[] | undefined;
    if (values.auditEvents?.trim()) {
      try {
        const parsed: unknown = JSON.parse(values.auditEvents);
        auditEvents = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        message.error('审计事件不是合法 JSON，请检查后重试');
        return;
      }
    }
    setSubmitting(true);
    try {
      await submitAssignment(submitTarget.id, {
        skillZipRef: values.skillZipRef,
        skillZipSha256: values.skillZipSha256,
        capsuleRef: values.capsuleRef,
        capsuleSha256: values.capsuleSha256,
        auditEvents,
      });
      message.success('提交成功，平台将进行独立复验');
      setSubmitTarget(null);
      form.resetFields();
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const openFeedback = async (a: Assignment) => {
    const submissionId = a.submission?.id;
    if (!submissionId) {
      message.info('该任务还没有提交记录');
      return;
    }
    setFeedback({ open: true, submission: null, evaluation: null });
    setFeedbackLoading(true);
    try {
      const [sub, ev] = await Promise.all([
        getSubmission(submissionId),
        getSubmissionEvaluation(submissionId).catch(() => null),
      ]);
      setFeedback({ open: true, submission: sub, evaluation: ev ?? sub.evaluation ?? null });
    } finally {
      setFeedbackLoading(false);
    }
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        我的提交与反馈
      </Title>
      <Card>
        <Table<Assignment>
          rowKey="id"
          dataSource={assignments}
          locale={{ emptyText: <Empty description="暂无实验任务" /> }}
          columns={[
            {
              title: '实验项目',
              render: (_, a) => <Link to={`/student/projects/${a.project.id}`}>{a.project.title}</Link>,
            },
            { title: '所属章节', render: (_, a) => a.project.chapterTitle || '-' },
            {
              title: '截止时间',
              render: (_, a) => (a.project.deadline ? dayjs(a.project.deadline).format('YYYY-MM-DD HH:mm') : '-'),
            },
            { title: '任务状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
            {
              title: '提交状态',
              render: (_, a) =>
                a.submission ? <StatusTag status={a.submission.status} /> : <Text type="secondary">未提交</Text>,
            },
            {
              title: '操作',
              render: (_, a) => (
                <Space>
                  {a.status === 'pending' && (
                    <Link to={`/student/projects/${a.project.id}`}>
                      <Button size="small">{a.unlocked ? '去领取' : '未解锁'}</Button>
                    </Link>
                  )}
                  {a.status === 'claimed' && (
                    <Button size="small" type="primary" icon={<UploadOutlined />} onClick={() => setSubmitTarget(a)}>
                      提交
                    </Button>
                  )}
                  {a.submission && (
                    <Button size="small" onClick={() => openFeedback(a)}>
                      查看反馈
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={`提交实验：${submitTarget?.project.title ?? ''}`}
        open={!!submitTarget}
        onOk={handleSubmit}
        onCancel={() => setSubmitTarget(null)}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="skillZipRef"
            label="Skill 包引用（skillZipRef）"
            rules={[{ required: true, message: '请填写 Skill 包引用' }]}
            extra="完整 Skill 目录 ZIP 的存储引用"
          >
            <Input placeholder="如：oss://sub/student1/skill.zip" />
          </Form.Item>
          <Form.Item
            name="skillZipSha256"
            label="Skill 包 SHA-256"
            rules={[
              { required: true, message: '请填写 Skill 包哈希' },
              { pattern: SHA256_PATTERN, message: '必须是 64 位十六进制 SHA-256' },
            ]}
          >
            <Input placeholder="64 位十六进制" />
          </Form.Item>
          <Form.Item
            name="capsuleRef"
            label="证据包引用（capsuleRef）"
            rules={[{ required: true, message: '请填写证据包引用' }]}
            extra=".dshc 证据包的存储引用"
          >
            <Input placeholder="如：oss://sub/student1/run.dshc" />
          </Form.Item>
          <Form.Item
            name="capsuleSha256"
            label="证据包 SHA-256"
            rules={[
              { required: true, message: '请填写证据包哈希' },
              { pattern: SHA256_PATTERN, message: '必须是 64 位十六进制 SHA-256' },
            ]}
          >
            <Input placeholder="64 位十六进制" />
          </Form.Item>
          <Form.Item name="auditEvents" label="审计事件（auditEvents，JSON 数组，可选）">
            <Input.TextArea
              rows={4}
              placeholder='[{"type":"approval/asked","tool":"shell"},{"type":"approval/decided","decision":"allow"}]'
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="复验结果与教师反馈"
        open={feedback.open}
        onClose={() => setFeedback({ open: false, submission: null, evaluation: null })}
        width={480}
      >
        {feedbackLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : !feedback.submission ? (
          <Empty description="暂无数据" />
        ) : (
          <>
            <Space style={{ marginBottom: 16 }}>
              <Text>提交状态：</Text>
              <StatusTag status={feedback.submission.status} />
            </Space>
            {!feedback.evaluation ? (
              <Empty description="尚未产生复验结果，请耐心等待平台复验" />
            ) : (
              <>
                <Space size="large" wrap style={{ marginBottom: 16 }}>
                  <Statistic title="成功率" value={pct(feedback.evaluation.successRate)} />
                  <Statistic title="Token 成本" value={feedback.evaluation.tokenCost ?? 0} />
                  <Statistic title="教师评分" value={feedback.evaluation.teacherScore ?? '-'} />
                </Space>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="证据一致性">
                    {feedback.evaluation.integrityCheck?.selfReportVsRerun === 'consistent' ? (
                      <Tag color="green">自报与复验一致</Tag>
                    ) : (
                      <Tag color="orange">证据存疑</Tag>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Baseline 成功率">
                    {pct(feedback.evaluation.baselineResult?.successRate)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Treatment 成功率">
                    {pct(feedback.evaluation.treatmentResult?.successRate)}
                  </Descriptions.Item>
                  <Descriptions.Item label="教师评语">
                    {feedback.evaluation.teacherComment || '教师暂未填写评语'}
                  </Descriptions.Item>
                </Descriptions>
              </>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
