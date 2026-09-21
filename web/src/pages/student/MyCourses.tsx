import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Col, Empty, Progress, Row, Skeleton, Typography } from 'antd';
import { listMyCourses } from '../../api';
import type { MyCourse } from '../../types';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

export default function MyCourses() {
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<MyCourse[]>([]);

  useAuxiliaryPanel(
    '学习指引',
    <div>
      <Paragraph type="secondary">按章节顺序学习课程内容并标记完成；满足解锁规则后即可领取章节下的实验。</Paragraph>
      <Paragraph type="secondary">
        本地环境准备：安装 Node ≥ 22 与 DSH，并按课程指引配置 nju-lab-student profile。
      </Paragraph>
    </div>,
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setCourses((await listMyCourses()) ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        我的课程
      </Title>
      {courses.length === 0 ? (
        <Card>
          <Empty description="你还没有加入任何课程，请联系任课教师" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {courses.map((c) => {
            const total = c.chapters?.length ?? 0;
            const done = c.completedCount ?? c.chapters?.filter((ch) => ch.status === 'completed').length ?? 0;
            const percent = total ? Math.round((done / total) * 100) : 0;
            return (
              <Col xs={24} sm={12} lg={8} key={c.id}>
                <Card
                  title={c.title}
                  extra={
                    <Link to={`/student/courses/${c.id}`}>
                      <Button size="small" type="primary" ghost>
                        进入学习
                      </Button>
                    </Link>
                  }
                >
                  <Text type="secondary">{c.term || ''}</Text>
                  <div style={{ marginTop: 12 }}>
                    <Progress percent={percent} size="small" format={(p) => `${p}%（${done}/${total} 章）`} />
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
}
