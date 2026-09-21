import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Empty,
  List,
  Progress,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Typography,
  theme,
} from 'antd';
import { AuditOutlined, BookOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getCourseDashboard, getTeacherSummary, listCourses } from '../../api';
import type { Course, CourseDashboard, PendingGradingItem, TeacherSummary } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

export default function TeacherDashboard() {
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<Course[]>([]);
  const [summary, setSummary] = useState<TeacherSummary | null>(null);
  const [dashboards, setDashboards] = useState<Map<string, CourseDashboard>>(new Map());
  const { token } = theme.useToken();

  useAuxiliaryPanel(
    '工作台说明',
    <div>
      <Paragraph type="secondary">
        顶部为课程规模与待批改概览；「待批改」列表中的提交已经平台复验，点击即可进入批改页确认评分。
      </Paragraph>
      <Paragraph type="secondary">快捷操作：</Paragraph>
      <Link to="/teacher/courses">
        <Button size="small" type="primary" ghost icon={<PlusOutlined />}>
          新建课程
        </Button>
      </Link>
    </div>,
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [list, sum] = await Promise.all([
          listCourses().catch(() => [] as Course[]),
          getTeacherSummary().catch(() => null),
        ]);
        setCourses(list ?? []);
        setSummary(sum);
        const entries = await Promise.all(
          (list ?? []).map(async (c) => {
            const d = await getCourseDashboard(c.id).catch(() => null);
            return [c.id, d] as const;
          }),
        );
        setDashboards(new Map(entries.filter((e): e is readonly [string, CourseDashboard] => !!e[1])));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  if (courses.length === 0 && !summary) {
    return (
      <Card>
        <Empty description="还没有课程，先去创建一门课程吧">
          <Link to="/teacher/courses">
            <Button type="primary" icon={<PlusOutlined />}>
              新建课程
            </Button>
          </Link>
        </Empty>
      </Card>
    );
  }

  const pending = (summary?.pendingGrading ?? []).slice(0, 10);
  const pendingCount = summary?.pendingGradingCount ?? 0;

  const cards = [
    { title: '课程数', value: summary?.courseCount ?? courses.length, icon: <BookOutlined />, color: token.colorPrimary },
    { title: '学生总数', value: summary?.studentCount ?? 0, icon: <TeamOutlined />, color: token.colorSuccess },
    {
      title: '待批改提交',
      value: pendingCount,
      icon: <AuditOutlined />,
      color: pendingCount > 0 ? token.colorError : token.colorTextTertiary,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        工作台
      </Title>
      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col xs={24} sm={12} lg={8} key={c.title}>
            <Card>
              <Statistic
                title={
                  <Text type="secondary">
                    <span style={{ color: c.color, marginRight: 8 }}>{c.icon}</span>
                    {c.title}
                  </Text>
                }
                value={c.value}
                valueStyle={c.title === '待批改提交' && pendingCount > 0 ? { color: token.colorError, fontWeight: 600 } : undefined}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card title={`待批改（${pendingCount}）`} style={{ marginTop: 16 }}>
        <Table<PendingGradingItem>
          rowKey="submissionId"
          size="middle"
          dataSource={pending}
          pagination={false}
          locale={{ emptyText: <Empty description="没有待批改的提交，都处理完啦" /> }}
          columns={[
            {
              title: '学生',
              render: (_, r) => (
                <Space size={4}>
                  <Text>{r.studentNickname}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {r.studentUsername}
                  </Text>
                </Space>
              ),
            },
            {
              title: '实验项目',
              render: (_, r) => <Link to={`/teacher/projects/${r.projectId}`}>{r.projectTitle}</Link>,
            },
            { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
            {
              title: '提交时间',
              dataIndex: 'submittedAt',
              render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
            },
            {
              title: '操作',
              width: 90,
              render: (_, r) => <Link to={`/teacher/submissions/${r.submissionId}/grade`}>去批改</Link>,
            },
          ]}
        />
        {pendingCount > pending.length && (
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            仅显示前 {pending.length} 条，共 {pendingCount} 条待批改
          </Text>
        )}
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {courses.map((c) => {
          const dash = dashboards.get(c.id);
          return (
            <Col xs={24} lg={12} key={c.id}>
              <Card
                title={
                  <Space size={8}>
                    <Text strong>{c.title}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dash ? `${dash.studentCount} 名学生` : ''}
                    </Text>
                  </Space>
                }
                extra={<Link to={`/teacher/courses/${c.id}`}>进入课程</Link>}
              >
                {!dash || (dash.chapters ?? []).length === 0 ? (
                  <Text type="secondary">暂无章节数据</Text>
                ) : (
                  <List
                    size="small"
                    dataSource={[...dash.chapters].sort((a, b) => a.order - b.order)}
                    renderItem={(ch) => (
                      <List.Item style={{ paddingLeft: 0, paddingRight: 0 }}>
                        <div style={{ width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Text style={{ fontSize: 13 }}>{ch.title}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {ch.completedCount}/{ch.studentCount} 完成 · {ch.inProgressCount} 学习中
                            </Text>
                          </div>
                          <Progress percent={Math.round((ch.completionRate ?? 0) * 100)} size="small" />
                        </div>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
