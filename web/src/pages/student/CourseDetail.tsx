import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Empty, List, Skeleton, Space, Tag, Typography } from 'antd';
import { ExperimentOutlined, LockOutlined, ReadOutlined } from '@ant-design/icons';
import { getCourse, listMyAssignments, listMyCourses } from '../../api';
import type { Assignment, ChapterProgressStatus, Course, MyCourse } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

export default function StudentCourseDetail() {
  const { courseId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState<Course | null>(null);
  const [myCourse, setMyCourse] = useState<MyCourse | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  useAuxiliaryPanel(
    '课程学习',
    <Paragraph type="secondary">
      点击章节进入阅读，读完后标记完成；章节下的实验标签显示解锁状态，未解锁的实验需先完成前置章节。
    </Paragraph>,
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [c, myCourses, asgs] = await Promise.all([
          getCourse(courseId),
          listMyCourses().catch(() => [] as MyCourse[]),
          listMyAssignments().catch(() => [] as Assignment[]),
        ]);
        setCourse(c);
        setMyCourse((myCourses ?? []).find((m) => m.id === courseId) ?? null);
        setAssignments(asgs ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId]);

  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }
  if (!course) {
    return <Empty description="课程不存在或你未加入该课程" />;
  }

  const chapterStatusOf = (chapterId: string): ChapterProgressStatus =>
    myCourse?.chapters.find((ch) => ch.id === chapterId)?.status ?? 'not_started';

  const assignmentOf = (projectId: string) => assignments.find((a) => a.project.id === projectId);

  const chapters = [...(course.chapters ?? [])].sort((a, b) => a.order - b.order);

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        {course.title}
      </Title>
      {chapters.length === 0 ? (
        <Card>
          <Empty description="本课程还没有章节" />
        </Card>
      ) : (
        <List
          grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3 }}
          dataSource={chapters}
          renderItem={(ch, idx) => (
            <List.Item>
              <Card
                title={
                  <Space>
                    <ReadOutlined />
                    第 {idx + 1} 章 · {ch.title}
                  </Space>
                }
                extra={<StatusTag status={chapterStatusOf(ch.id)} />}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Link to={`/student/chapters/${ch.id}`}>进入学习</Link>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      本章实验：
                    </Text>
                    {(ch.projects ?? []).length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        暂无
                      </Text>
                    ) : (
                      <Space wrap style={{ marginTop: 4 }}>
                        {(ch.projects ?? []).map((p) => {
                          const asg = assignmentOf(p.id);
                          const unlocked = asg?.unlocked ?? false;
                          return (
                            <Link key={p.id} to={`/student/projects/${p.id}`}>
                              <Tag
                                icon={unlocked ? <ExperimentOutlined /> : <LockOutlined />}
                                color={unlocked ? 'blue' : 'default'}
                                style={{ cursor: 'pointer' }}
                              >
                                {p.title}
                                {!unlocked && '（未解锁）'}
                                {asg && asg.status !== 'pending' && <StatusTag status={asg.status} />}
                              </Tag>
                            </Link>
                          );
                        })}
                      </Space>
                    )}
                  </div>
                </Space>
              </Card>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
