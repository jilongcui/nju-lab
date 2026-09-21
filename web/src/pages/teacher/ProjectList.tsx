import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Segmented, Skeleton, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { listProjects } from '../../api';
import type { TeacherProjectRow } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

const STATUS_FILTERS = [
  { label: '全部', value: 'all' },
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' },
  { label: '已关闭', value: 'closed' },
];

export default function ProjectList() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TeacherProjectRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useAuxiliaryPanel(
    '实验项目管理',
    <div>
      <Paragraph type="secondary">
        这里汇总你全部课程下的实验项目。新建实验请进入「课程管理 → 课程详情 → 章节」下创建；点击项目标题进入数字化实验指导书与批改入口。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listProjects());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  );

  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          实验项目
        </Title>
        <Segmented options={STATUS_FILTERS} value={statusFilter} onChange={(v) => setStatusFilter(v as string)} />
      </div>

      <Card>
        <Table<TeacherProjectRow>
          rowKey="id"
          dataSource={filtered}
          locale={{ emptyText: <Empty description="暂无实验项目，请到课程章节下创建" /> }}
          columns={[
            {
              title: '实验标题',
              dataIndex: 'title',
              render: (v, r) => <Link to={`/teacher/projects/${r.id}`}>{v}</Link>,
            },
            {
              title: '所属课程',
              dataIndex: 'courseTitle',
              render: (v, r) => <Link to={`/teacher/courses/${r.courseId}`}>{v ?? '-'}</Link>,
            },
            { title: '所属章节', dataIndex: 'chapterTitle', render: (v) => v ?? '-' },
            { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} />, width: 100 },
            {
              title: '提交进度',
              width: 110,
              render: (_, r) =>
                r.assignmentCount > 0 ? (
                  <Text>
                    {r.submittedCount} / {r.assignmentCount}
                  </Text>
                ) : (
                  <Text type="secondary">未分发</Text>
                ),
            },
            {
              title: '截止时间',
              dataIndex: 'deadline',
              width: 150,
              render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '未设置'),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 120,
              render: (v) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
            },
          ]}
        />
      </Card>
    </div>
  );
}
