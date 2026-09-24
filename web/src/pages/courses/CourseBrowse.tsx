import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Empty, Input, Row, Skeleton, Space, Tag, Typography } from 'antd';
import { ReadOutlined, TeamOutlined } from '@ant-design/icons';
import { listCatalogCourses } from '../../api';
import type { CatalogCourseBrief } from '../../types';
import { STATE_META, formatDateTime, formatSeats } from '../../applicationState';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

/** 选课：已公开的课程目录 + 检索。需登录（平台内容登录后可见）。 */
export default function CourseBrowse() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<CatalogCourseBrief[]>([]);

  useAuxiliaryPanel(
    '选课说明',
    <div>
      <Paragraph type="secondary">
        这里列出所有已公开的课程。点课程卡片查看大纲与名额，可申请时直接报名。
      </Paragraph>
      <Paragraph type="secondary">
        热门课程可能设置了申请开放时间，未开放时无法提交；被驳回后可以重新申请。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async (keyword?: string) => {
    setLoading(true);
    try {
      const data = await listCatalogCourses(keyword ? { keyword } : undefined);
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
      <Title level={4} style={{ marginTop: 0 }}>
        选课
      </Title>
      <Paragraph type="secondary">
        浏览已公开的课程并申请加入；教师审批通过后即可进入课程学习与实验。
      </Paragraph>

      <Input.Search
        allowClear
        placeholder="搜索课程名称或简介"
        enterButton="搜索"
        style={{ maxWidth: 420, marginBottom: 16 }}
        onSearch={(v) => void load(v.trim() || undefined)}
      />

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : courses.length === 0 ? (
        <Card>
          <Empty description="暂无可选课程" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {courses.map((c) => {
            const meta = STATE_META[c.applicationState];
            return (
              <Col xs={24} sm={12} lg={8} key={c.id}>
                <Card
                  hoverable
                  onClick={() => navigate(`/course/${c.slug}`)}
                  title={c.title}
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
                        申请开放：{formatDateTime(c.applicationOpenAt)}
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
