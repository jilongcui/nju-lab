import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckOutlined, ExperimentOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getSubmission,
  getSubmissionEvaluation,
  gradeSubmission,
  listAssignmentVersions,
  verifySubmission,
} from '../../api';
import type { Evaluation, RunResult, Submission } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

function pct(rate?: number) {
  return rate != null ? `${Math.round(rate * 100)}%` : '-';
}

function RunCard({ title, result }: { title: string; result?: RunResult }) {
  if (!result) {
    return (
      <Card size="small" type="inner" title={title}>
        <Text type="secondary">暂无数据</Text>
      </Card>
    );
  }
  return (
    <Card size="small" type="inner" title={title}>
      <Descriptions column={1} size="small">
        <Descriptions.Item label="成功率">{pct(result.successRate)}</Descriptions.Item>
        <Descriptions.Item label="运行次数">{result.runs ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="平均 Token/次">{result.avgTokensPerRun ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="数据集">
          <Text code style={{ fontSize: 12 }}>
            {result.dataset || '-'}
          </Text>
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

export default function Grading() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [versions, setVersions] = useState<Submission[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useAuxiliaryPanel(
    '批改说明',
    <div>
      <Paragraph type="secondary">
        评分以平台独立复验结果为准：逐用例成功率与 token 成本由服务端重跑产生。
      </Paragraph>
      <Paragraph type="secondary">
        哈希与审计事件用于印证过程真实性；一致性存疑时请人工复核后再确认评分。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sub, ev] = await Promise.all([
        getSubmission(submissionId),
        getSubmissionEvaluation(submissionId).catch(() => null),
      ]);
      setSubmission(sub);
      setEvaluation(ev ?? sub.evaluation ?? null);
      setVersions(await listAssignmentVersions(sub.assignmentId).catch(() => [] as Submission[]));
      const finalEv = ev ?? sub.evaluation;
      if (finalEv) {
        form.setFieldsValue({
          teacherScore: finalEv.teacherScore ?? finalEv.autoScoreSuggestion,
          teacherComment: finalEv.teacherComment,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [submissionId, form]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await verifySubmission(submissionId);
      message.success('已触发复验，稍后刷新查看结果');
      await load();
    } finally {
      setVerifying(false);
    }
  };

  const handleGrade = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await gradeSubmission(submissionId, values);
      message.success('评分已确认');
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }
  if (!submission) {
    return <Empty description="提交记录不存在" />;
  }

  const ic = evaluation?.integrityCheck;
  const consistent = ic?.selfReportVsRerun === 'consistent';
  const fileHashRows = Object.entries(submission.fileHashes ?? {}).map(([file, hash]) => ({ file, hash }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            批改 · v{submission.version}
          </Title>
          {versions.length > 1 && (
            <Text type="secondary">（共 {versions.length} 版）</Text>
          )}
          <StatusTag status={submission.status} />
        </Space>
        <Space>
          {versions.length > 1 && (
            <Select
              size="middle"
              style={{ width: 200 }}
              value={submission.id}
              onChange={(id) => navigate(`/teacher/submissions/${id}/grade`)}
              options={versions.map((s) => ({
                value: s.id,
                label: (
                  <Space size={4}>
                    <Text>v{s.version}</Text>
                    <StatusTag status={s.status} />
                    <Text type="secondary">{dayjs(s.submittedAt).format('YYYY-MM-DD HH:mm')}</Text>
                  </Space>
                ),
              }))}
            />
          )}
          <Popconfirm title="将在一次性容器中独立重跑验证，确认触发？" onConfirm={handleVerify}>
            <Button icon={<ReloadOutlined />} loading={verifying}>
              触发复验
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="提交详情" style={{ height: '100%' }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="学生 ID">
                <Text code>{submission.studentId}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="实验项目 ID">
                <Text code>{submission.assignment?.projectId || '-'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="提交时间">
                {submission.submittedAt ? dayjs(submission.submittedAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Skill 包（skillZipRef）">
                <Text code>{submission.skillZipRef}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Skill 包 SHA-256">
                <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {submission.skillZipSha256 || '-'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="证据包（capsuleRef）">
                <Text code>{submission.capsuleRef}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="证据包 SHA-256">
                <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {submission.capsuleSha256 || '-'}
                </Text>
              </Descriptions.Item>
            </Descriptions>

            {fileHashRows.length > 0 && (
              <>
                <Title level={5} style={{ marginTop: 16 }}>
                  文件哈希登记
                </Title>
                <Table
                  size="small"
                  rowKey="file"
                  pagination={false}
                  dataSource={fileHashRows}
                  columns={[
                    { title: '文件', dataIndex: 'file' },
                    {
                      title: 'SHA-256',
                      dataIndex: 'hash',
                      render: (v: string) => (
                        <Text code style={{ fontSize: 11 }}>
                          {v.slice(0, 16)}…
                        </Text>
                      ),
                    },
                  ]}
                />
              </>
            )}

            <Title level={5} style={{ marginTop: 16 }}>
              审计事件（auditEvents）
            </Title>
            {(submission.auditEvents ?? []).length > 0 ? (
              <pre
                style={{
                  maxHeight: 260,
                  overflow: 'auto',
                  padding: 12,
                  borderRadius: 8,
                  background: 'rgba(128,128,128,0.08)',
                  fontSize: 12,
                }}
              >
                {JSON.stringify(submission.auditEvents, null, 2)}
              </pre>
            ) : (
              <Text type="secondary">无审计事件</Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ExperimentOutlined />
                平台复验结果
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            {!evaluation ? (
              <Empty description="尚未产生复验结果，可点击右上角触发复验" />
            ) : (
              <>
                <Space size="large" wrap style={{ marginBottom: 16 }}>
                  <Statistic title="成功率" value={pct(evaluation.successRate)} />
                  <Statistic title="Token 成本" value={evaluation.tokenCost ?? 0} />
                  <Statistic title="评分建议" value={evaluation.autoScoreSuggestion ?? '-'} />
                </Space>
                {ic && (
                  <Space wrap style={{ marginBottom: 16 }}>
                    <Tag color={consistent ? 'green' : 'orange'}>
                      {consistent ? '自报与复验一致' : `证据存疑（${ic.selfReportVsRerun || '未知'}）`}
                    </Tag>
                    <Tag color={ic.capsuleHashVerified ? 'green' : 'red'}>
                      {ic.capsuleHashVerified ? '证据包哈希已验证' : '证据包哈希未通过'}
                    </Tag>
                    {ic.deviation != null && <Tag>偏差 {ic.deviation}</Tag>}
                    {ic.note && <Text type="secondary">{ic.note}</Text>}
                  </Space>
                )}
                <RunCard title="复验（使用学生的 Skill）" result={evaluation.treatmentResult} />
              </>
            )}
          </Card>
          <Card title="确认评分">
            <Form form={form} layout="vertical">
              <Form.Item
                name="teacherScore"
                label="评分"
                rules={[{ required: true, message: '请输入评分' }]}
                extra="默认填入平台评分建议，可调整（0-100）"
              >
                <InputNumber min={0} max={100} style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="teacherComment" label="评语" rules={[{ required: true, message: '请填写评语' }]}>
                <Input.TextArea rows={4} placeholder="指出亮点与改进建议" />
              </Form.Item>
              <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={handleGrade}>
                确认评分
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
