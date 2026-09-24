import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Badge,
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
  Tag,
  Typography,
} from 'antd';
import { BookOutlined, FormOutlined, RightOutlined } from '@ant-design/icons';
import { listMyApplications, listMyAssignments, listMyCourses } from '../../api';
import type { Assignment, MyApplication, MyCourse } from '../../types';
import { useAuthStore } from '../../stores/auth';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

/** 学生工作台：登录后的默认落地页。概览 + 选课入口 + 待办实验。 */
export default function StudentHome() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<MyCourse[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [applications, setApplications] = useState<MyApplication[]>([]);

  useAuxiliaryPanel(
    '从这里开始',
    <div>
      <Paragraph type="secondary">
        「选课」浏览所有已公开课程并申请加入；加入后课程会出现在「我的课程」。
      </Paragraph>
      <Paragraph type="secondary">
        实验任务在申请通过后自动下发，完成实验需要在本地 DSH 客户端开发并提交证据包。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, a, app] = await Promise.all([
        listMyCourses().catch(() => [] as MyCourse[]),
        listMyAssignments().catch(() => [] as Assignment[]),
        listMyApplications().catch(() => [] as MyApplication[]),
      ]);
      setCourses(c ?? []);
      setAssignments(a ?? []);
      setApplications(app ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  const pendingAssignments = assignments.filter((a) => a.status !== 'submitted');
  const pendingApplications = applications.filter((a) => a.status === 'pending');
  const totalChapters = courses.reduce((sum, c) => sum + (c.chapters?.length ?? 0), 0);
  const doneChapters = courses.reduce((sum, c) => sum + (c.completedCount ?? 0), 0);
  const progress = totalChapters ? Math.round((doneChapters / totalChapters) * 100) : 0;

  return (
    <div>
      <Space
        style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}
        align="start"
        wrap
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            你好，{user?.nickname || user?.username}
          </Title>
          <Text type="secondary">这里汇总你的课程、待办实验与选课申请。</Text>
        </div>
        <Button type="primary" size="large" icon={<BookOutlined />} onClick={() => navigate('/browse')}>
          去选课
        </Button>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="我的课程" value={courses.length} suffix="门" />
            {courses.length === 0 ? (
              <Button type="link" style={{ paddingLeft: 0 }} onClick={() => navigate('/browse')}>
                去选课 <RightOutlined />
              </Button>
            ) : null}
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title="待办实验"
              value={pendingAssignments.length}
              suffix="个"
              valueStyle={pendingAssignments.length > 0 ? { color: '#cf1322' } : undefined}
            />
            {pendingAssignments.length > 0 ? (
              <Button type="link" style={{ paddingLeft: 0 }} onClick={() => navigate('/student/submissions')}>
                去处理 <RightOutlined />
              </Button>
            ) : null}
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title="待审批申请"
              value={pendingApplications.length}
              suffix="条"
            />
            <Button type="link" style={{ paddingLeft: 0 }} onClick={() => navigate('/student/applications')}>
              查看申请 <RightOutlined />
            </Button>
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="章节完成度" value={progress} suffix="%" />
            <Progress percent={progress} size="small" showInfo={false} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title="我的课程"
            extra={
              <Button size="small" onClick={() => navigate('/student/courses')}>
                全部
              </Button>
            }
          >
            {courses.length === 0 ? (
              <Empty
                description="还没有加入任何课程"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Button type="primary" onClick={() => navigate('/browse')}>
                  去选课
                </Button>
              </Empty>
            ) : (
              <List
                dataSource={courses.slice(0, 5)}
                renderItem={(c) => {
                  const total = c.chapters?.length ?? 0;
                  const done = c.completedCount ?? 0;
                  const percent = total ? Math.round((done / total) * 100) : 0;
                  return (
                    <List.Item
                      actions={[
                        <Button
                          key="enter"
                          type="link"
                          onClick={() => navigate(`/student/courses/${c.id}`)}
                        >
                          进入学习
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={c.title}
                        description={
                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            <Text type="secondary">{c.term || '未设置学期'}</Text>
                            <Progress percent={percent} size="small" />
                          </Space>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="待办实验">
            {pendingAssignments.length === 0 ? (
              <Empty description="暂无待办" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List
                dataSource={pendingAssignments.slice(0, 6)}
                renderItem={(a) => (
                  <List.Item
                    actions={[
                      a.unlocked ? (
                        <Button
                          key="go"
                          type="link"
                          onClick={() => navigate(`/student/projects/${a.project.id}`)}
                        >
                          查看
                        </Button>
                      ) : (
                        <Tag key="lock" color="default">
                          未解锁
                        </Tag>
                      ),
                    ]}
                  >
                    <List.Item.Meta
                      title={a.project.title}
                      description={
                        <Space size={4}>
                          <Badge
                            status={a.status === 'claimed' ? 'processing' : 'default'}
                            text={a.status === 'claimed' ? '已领取' : '未领取'}
                          />
                          {a.project.chapterTitle ? (
                            <Text type="secondary">{a.project.chapterTitle}</Text>
                          ) : null}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>

          {pendingApplications.length > 0 ? (
            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              icon={<FormOutlined />}
              message={`有 ${pendingApplications.length} 条选课申请等待教师审批`}
              action={
                <Button size="small" onClick={() => navigate('/student/applications')}>
                  查看
                </Button>
              }
            />
          ) : null}
        </Col>
      </Row>
    </div>
  );
}
