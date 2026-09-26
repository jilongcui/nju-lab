import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Empty,
  message,
  Popconfirm,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { listMyApplications, withdrawApplication } from '../../api';
import type { ApplicationStatus, MyApplication } from '../../types';
import { STATE_META, formatDateTime } from '../../applicationState';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

const STATUS_META: Record<ApplicationStatus, { text: string; color: string }> = {
  pending: { text: '待审批', color: 'processing' },
  approved: { text: '已通过', color: 'success' },
  rejected: { text: '未通过', color: 'error' },
};

/** 学生：我的课程申请 */
export default function MyApplications() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MyApplication[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useAuxiliaryPanel(
    '申请说明',
    <div>
      <Paragraph type="secondary">
        热门课程可能设置了申请开放时间，未开放时无法提交，到点后刷新即可申请。
      </Paragraph>
      <Paragraph type="secondary">
        被驳回后可以重新申请。教师按申请时间先后逐个审批，名额满后不再受理新申请。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await listMyApplications()) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleWithdraw = async (row: MyApplication) => {
    if (!row.course) {
      return;
    }
    setBusyId(row.id);
    try {
      await withdrawApplication(row.course.id, row.id);
      message.success('已撤回申请');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const columns: ColumnsType<MyApplication> = [
    {
      title: '课程',
      dataIndex: ['course', 'title'],
      render: (_v, row) =>
        row.course?.slug ? (
          <a onClick={() => navigate(`/course/${row.course?.slug}`)}>{row.course?.title}</a>
        ) : (
          <Text>{row.course?.title ?? '课程已删除'}</Text>
        ),
    },
    {
      title: '学期',
      dataIndex: ['course', 'term'],
      width: 120,
      render: (v: string) => v || '-',
    },
    {
      title: '申请状态',
      dataIndex: 'status',
      width: 110,
      render: (v: ApplicationStatus) => (
        <Tag color={STATUS_META[v].color}>{STATUS_META[v].text}</Tag>
      ),
    },
    {
      title: '课程申请开放',
      dataIndex: 'applicationState',
      width: 150,
      render: (v: MyApplication['applicationState'], row) => {
        const meta = STATE_META[v];
        return (
          <Space direction="vertical" size={0}>
            <Tag color={meta.color}>{meta.text}</Tag>
            {row.enrolled ? <Text type="success">已入册</Text> : null}
          </Space>
        );
      },
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '审批说明',
      dataIndex: 'decisionNote',
      render: (v: string | null, row) =>
        row.status === 'pending' ? (
          <Text type="secondary">等待教师审批</Text>
        ) : (
          <Text type={row.status === 'rejected' ? 'danger' : 'secondary'}>{v || '-'}</Text>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_v, row) => {
        if (row.enrolled) {
          return (
            <Button
              size="small"
              type="primary"
              ghost
              onClick={() => row.course && navigate(`/student/courses/${row.course.id}`)}
            >
              进入学习
            </Button>
          );
        }
        if (row.status === 'pending') {
          return (
            <Popconfirm title="确认撤回这条申请？" onConfirm={() => handleWithdraw(row)}>
              <Button size="small" loading={busyId === row.id}>
                撤回
              </Button>
            </Popconfirm>
          );
        }
        return null;
      },
    },
  ];

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>
          我的课程申请
        </Title>
        <Button type="primary" onClick={() => navigate('/browse')}>
          浏览课程目录
        </Button>
      </Space>
      <Card>
        {rows.length === 0 ? (
          <Empty description="你还没有提交过课程申请">
            <Button type="primary" onClick={() => navigate('/browse')}>
              去看看有哪些课程
            </Button>
          </Empty>
        ) : (
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={false}
          />
        )}
      </Card>
    </div>
  );
}
