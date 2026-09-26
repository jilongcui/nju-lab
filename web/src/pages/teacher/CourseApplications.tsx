import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Descriptions,
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
import type { ColumnsType } from 'antd/es/table';
import {
  approveApplication,
  listCourseApplications,
  rejectApplication,
} from '../../api';
import type {
  ApplicationStatus,
  CourseApplicationRow,
  CourseApplicationsView,
} from '../../types';
import { STATE_META, formatDateTime } from '../../applicationState';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

const STATUS_META: Record<ApplicationStatus, { text: string; color: string }> = {
  pending: { text: '待审批', color: 'processing' },
  approved: { text: '已通过', color: 'success' },
  rejected: { text: '已驳回', color: 'error' },
};

/**
 * 教师：课程报名审批。
 * 列表按**申请时间升序**（先到先得）；逐个批准，批准即建入册并补发实验任务。
 */
export default function CourseApplications() {
  const { courseId = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CourseApplicationsView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CourseApplicationRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  useAuxiliaryPanel(
    '审批说明',
    <div>
      <Paragraph type="secondary">
        列表按申请时间升序排列（先到先得）。批准即把学生加入课程名单，并自动补发该课程
        <strong>全部已发布实验项目</strong>的任务。
      </Paragraph>
      <Paragraph type="secondary">
        名额按「已批准人数」计算；名额满后不能继续批准，但已提交的申请会保留排队
        ——有学生退课时可以继续从队列里批准。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setView(await listCourseApplications(courseId));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApprove = async (row: CourseApplicationRow) => {
    setBusyId(row.id);
    try {
      const res = await approveApplication(courseId, row.id);
      const created = (res as unknown as { assignmentsCreated?: number })
        .assignmentsCreated;
      message.success(
        created
          ? `已批准并补发 ${created} 个实验任务`
          : '已批准',
      );
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) {
      return;
    }
    setRejectBusy(true);
    try {
      await rejectApplication(courseId, rejectTarget.id, rejectNote.trim() || undefined);
      message.success('已驳回；该学生可以重新申请');
      setRejectTarget(null);
      setRejectNote('');
      await load();
    } finally {
      setRejectBusy(false);
    }
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  if (!view) {
    return (
      <Alert type="error" showIcon message="加载申请列表失败" />
    );
  }

  const meta = STATE_META[view.applicationState];
  const isFull = view.capacity != null && view.seatsLeft === 0;

  const columns: ColumnsType<CourseApplicationRow> = [
    {
      title: '学生',
      key: 'student',
      render: (_v, row) => (
        <Space>
          <Text>{row.nickname || row.username}</Text>
          <Text type="secondary">{row.username}</Text>
        </Space>
      ),
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: ApplicationStatus) => (
        <Tag color={STATUS_META[v].color}>{STATUS_META[v].text}</Tag>
      ),
    },
    {
      title: '审批说明',
      dataIndex: 'decisionNote',
      render: (v: string | null, row) =>
        row.status === 'pending' ? (
          <Text type="secondary">-</Text>
        ) : (
          <Space direction="vertical" size={0}>
            <Text>{v || '-'}</Text>
            <Text type="secondary">{formatDateTime(row.decidedAt)}</Text>
          </Space>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 170,
      render: (_v, row) =>
        row.status !== 'pending' ? null : (
          <Space>
            <Button
              type="primary"
              size="small"
              loading={busyId === row.id}
              disabled={isFull}
              onClick={() => handleApprove(row)}
            >
              批准
            </Button>
            <Button size="small" onClick={() => setRejectTarget(row)}>
              驳回
            </Button>
          </Space>
        ),
    },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>
          课程报名审批
        </Title>
        <Space>
          <Button onClick={() => navigate(`/teacher/courses/${courseId}`)}>返回课程详情</Button>
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <Space size={48} wrap>
          <Statistic title="待审批" value={view.pendingCount} />
          <Statistic title="已批准" value={view.approvedCount} />
          <Statistic
            title="剩余名额"
            value={view.capacity == null ? '不限' : (view.seatsLeft ?? 0)}
          />
          <Statistic title="名额上限" value={view.capacity ?? '不限'} />
        </Space>
        <Descriptions column={1} size="small" style={{ marginTop: 16 }}>
          <Descriptions.Item label="申请入口状态">
            <Tag color={meta.color}>{meta.text}</Tag>
          </Descriptions.Item>
        </Descriptions>
        {isFull ? (
          <Alert
            type="warning"
            showIcon
            message="名额已满"
            description="无法继续批准新申请；已提交的申请会保留在队列中，退课后可继续批准。"
          />
        ) : null}
      </Card>

      <Card>
        {view.applications.length === 0 ? (
          <Text type="secondary">还没有学生提交申请。</Text>
        ) : (
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={view.applications}
            pagination={false}
          />
        )}
      </Card>

      <Modal
        title={`驳回申请：${rejectTarget?.nickname || rejectTarget?.username || ''}`}
        open={!!rejectTarget}
        onOk={handleReject}
        confirmLoading={rejectBusy}
        onCancel={() => {
          setRejectTarget(null);
          setRejectNote('');
        }}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
      >
        <Paragraph type="secondary">
          驳回后该学生**可以重新申请**。可填写理由，学生会看到。
        </Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={500}
          showCount
          value={rejectNote}
          placeholder="例如：未修完先修课程 / 名额已满，建议下期再选（可留空）"
          onChange={(e) => setRejectNote(e.target.value)}
        />
      </Modal>
    </div>
  );
}
