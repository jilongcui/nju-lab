import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, Col, Empty, Row, Skeleton, Space, Typography } from 'antd';
import { ExperimentOutlined, FilePptOutlined, ReadOutlined } from '@ant-design/icons';
import { getCourse, listMyCourses } from '../../api';
import type { ChapterProgressStatus, Course, MyCourse } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

/**
 * 学生端课程页：**章节列表**。
 *
 * 2026-10-13（学员反馈）：这里原先每章卡片里堆着一串实验标签（还嵌着状态标签），
 * 既乱、又不是进实验的好位置 —— 因为学生上完章节还得退出课程、回本页才能点实验。
 * 现在本页只给**概览信息**（本章实验几个 / 有没有课件），实验入口移到章节课右栏的
 * 「实验」tab（`ChapterRead`），从章节里直接切换过去。
 */
export default function StudentCourseDetail() {
  const { courseId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState<Course | null>(null);
  const [myCourse, setMyCourse] = useState<MyCourse | null>(null);

  useAuxiliaryPanel(
    '课程学习',
    <Paragraph type="secondary">
      点击章节进入阅读，读完后标记完成。实验在章节页右侧的「实验」tab 里进入；
      未解锁的实验需先完成本实验所属章节。可以跳级学习，不必从头按顺序。
    </Paragraph>,
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [c, myCourses] = await Promise.all([
          getCourse(courseId),
          listMyCourses().catch(() => [] as MyCourse[]),
        ]);
        setCourse(c);
        setMyCourse((myCourses ?? []).find((m) => m.id === courseId) ?? null);
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

  const chapters = [...(course.chapters ?? [])].sort((a, b) => a.order - b.order);
  const experimentTotal = chapters.reduce((sum, ch) => sum + (ch.projects?.length ?? 0), 0);
  const slideChapterCount = chapters.filter((ch) => (ch.slideCount ?? 0) > 0).length;

  return (
    <div>
      <Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
        {course.title}
      </Title>
      <Text type="secondary" style={{ display: 'block' }}>
        授课教师：{myCourse?.teacherNames?.join('、') || myCourse?.teacherName || '未署名'}
        {course.term || myCourse?.term ? ` · ${course.term || myCourse?.term}` : ''}
      </Text>
      {chapters.length > 0 && (
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 16 }}>
          共 {chapters.length} 章 · 实验 {experimentTotal} 个 ·{' '}
          {slideChapterCount > 0 ? `${slideChapterCount} 章有课件` : '暂无课件'}
        </Text>
      )}
      {chapters.length === 0 ? (
        <Card style={{ marginTop: 16 }}>
          <Empty description="本课程还没有章节" />
        </Card>
      ) : (
        <Row gutter={[16, 16]} align="stretch">
          {chapters.map((ch, idx) => {
            const experimentCount = ch.projects?.length ?? 0;
            const slideCount = ch.slideCount ?? 0;
            return (
              <Col xs={24} md={12} xl={8} key={ch.id} style={{ display: 'flex' }}>
                <Card
                  style={{ width: '100%', display: 'flex', flexDirection: 'column' }}
                  styles={{
                    body: {
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: 16,
                    },
                  }}
                  title={
                    <span title={`第 ${idx + 1} 章 · ${ch.title}`}>
                      <ReadOutlined style={{ marginRight: 8 }} />
                      第 {idx + 1} 章 · {ch.title}
                    </span>
                  }
                >
                  <Space size={12} wrap>
                    <StatusTag status={chapterStatusOf(ch.id)} />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <ExperimentOutlined style={{ marginRight: 4 }} />
                      本章实验 {experimentCount} 个
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <FilePptOutlined style={{ marginRight: 4 }} />
                      {slideCount > 0 ? `课件 ${slideCount} 页` : '无课件'}
                    </Text>
                  </Space>
                  <Link to={`/student/chapters/${ch.id}`}>
                    <Button type="primary" ghost size="small">
                      进入学习
                    </Button>
                  </Link>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
}
