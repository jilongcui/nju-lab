import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  Col,
  Empty,
  Input,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { ReadOutlined, TeamOutlined } from '@ant-design/icons';
import { listPublicCourses } from '../../api';
import type { PublicCourseBrief } from '../../types';
import { STATE_META, formatDateTime, formatSeats } from '../../applicationState';

const { Title, Paragraph, Text } = Typography;

/** 公开课程目录：无需登录（登录时后端会附带我的申请状态） */
export default function CourseBrowse() {
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<PublicCourseBrief[]>([]);

  const load = useCallback(async (keyword?: string) => {
    setLoading(true);
    try {
      const data = await listPublicCourses(keyword ? { keyword } : undefined);
      setCourses(data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        课程目录
      </Title>
      <Paragraph type="secondary">
        这里列出所有已公开的课程。课程可申请时可直接报名，教师审批通过后即可进入学习并完成实验。
      </Paragraph>

      <Input.Search
        allowClear
        size="large"
        placeholder="搜索课程名称或简介"
        enterButton="搜索"
        style={{ maxWidth: 480, marginBottom: 20 }}
        onSearch={(v) => void load(v.trim() || undefined)}
      />

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : courses.length === 0 ? (
        <Card>
          <Empty description="暂无已公开的课程" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {courses.map((c) => {
            const meta = STATE_META[c.applicationState];
            return (
              <Col xs={24} sm={12} lg={8} key={c.id}>
                <Card
                  hoverable
                  title={
                    <Link to={`/course/${c.slug}`} style={{ whiteSpace: 'normal' }}>
                      {c.title}
                    </Link>
                  }
                  extra={<Tag color={meta.color}>{meta.text}</Tag>}
                >
                  <Space size={4} wrap>
                    <Text type="secondary">{c.teacherName || '未署名教师'}</Text>
                    {c.term ? <Text type="secondary">· {c.term}</Text> : null}
                  </Space>
                  <Paragraph
                    type="secondary"
                    ellipsis={{ rows: 3 }}
                    style={{ marginTop: 8, minHeight: 66 }}
                  >
                    {c.description || '暂无课程简介'}
                  </Paragraph>
                  <Space size={16} wrap>
                    <Text type="secondary">
                      <ReadOutlined /> {c.chapterCount} 章
                    </Text>
                    <Text type="secondary">
                      <TeamOutlined /> {formatSeats(c.capacity, c.seatsLeft, c.approvedCount)}
                    </Text>
                  </Space>
                  {c.applicationState === 'not_open_yet' && c.applicationOpenAt ? (
                    <div style={{ marginTop: 8 }}>
                      <Text type="warning">
                        申请开放时间：{formatDateTime(c.applicationOpenAt)}
                      </Text>
                    </div>
                  ) : null}
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
}
