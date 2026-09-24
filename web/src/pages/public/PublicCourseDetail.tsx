import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  List,
  message,
  Popconfirm,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { applyCourse, getPublicCourse, withdrawApplication } from '../../api';
import type { PublicCourseDetail } from '../../types';
import { STATE_META, formatDateTime, formatSeats } from '../../applicationState';
import { rememberReturnTo } from '../../session';
import { useAuthStore } from '../../stores/auth';

const { Title, Paragraph, Text } = Typography;

/**
 * 课程公开页 —— 无需登录。
 * 展示课程公开信息与章节大纲（**不含教学内容**），并承载申请入口。
 */
export default function PublicCourseDetailPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [course, setCourse] = useState<PublicCourseDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCourse(await getPublicCourse(slug));
      setNotFound(false);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 未登录时先记下目标页再走登录（CAS 的 service 固定，只能靠 sessionStorage 回跳） */
  const handleApply = async () => {
    if (!course) {
      return;
    }
    if (!token) {
      rememberReturnTo(location.pathname);
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setBusy(true);
    try {
      await applyCourse(course.id);
      message.success('申请已提交，请等待教师审批');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!course?.myApplication) {
      return;
    }
    setBusy(true);
    try {
      await withdrawApplication(course.id, course.myApplication.id);
      message.success('已撤回申请');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  if (notFound || !course) {
    return (
      <Result
        status="404"
        title="课程不存在或未公开"
        extra={
          <Button type="primary" onClick={() => navigate('/browse')}>
            返回课程目录
          </Button>
        }
      />
    );
  }

  const meta = STATE_META[course.applicationState];
  const myApp = course.myApplication;

  /** 申请区：按「已入册 → 已申请 → 可申请 → 其它状态」的优先级渲染 */
  const renderApplyArea = () => {
    if (course.myEnrollment) {
      return (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="success" showIcon message="你已是该课程的学生" />
          <Button type="primary" onClick={() => navigate(`/student/courses/${course.id}`)}>
            进入学习
          </Button>
        </Space>
      );
    }

    if (myApp?.status === 'pending') {
      return (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="申请已提交，等待教师审批"
            description={`提交时间：${formatDateTime(myApp.createdAt)}`}
          />
          <Popconfirm title="确认撤回这条申请？" onConfirm={handleWithdraw}>
            <Button loading={busy}>撤回申请</Button>
          </Popconfirm>
        </Space>
      );
    }

    if (course.applicationState === 'open') {
      return (
        <Space direction="vertical" style={{ width: '100%' }}>
          {myApp?.status === 'rejected' ? (
            <Alert
              type="warning"
              showIcon
              message="上次申请未通过，可以重新申请"
              description={
                myApp.decisionNote ? `教师说明：${myApp.decisionNote}` : undefined
              }
            />
          ) : null}
          {!token ? (
            <Text type="secondary">申请加入需要先登录（南大统一认证）。</Text>
          ) : null}
          <Button type="primary" size="large" loading={busy} onClick={handleApply}>
            申请加入
          </Button>
        </Space>
      );
    }

    if (course.applicationState === 'not_open_yet') {
      return (
        <Alert
          type="info"
          showIcon
          message="申请尚未开放"
          description={`将于 ${formatDateTime(course.applicationOpenAt)} 开放申请`}
        />
      );
    }

    if (course.applicationState === 'full') {
      return (
        <Alert
          type="warning"
          showIcon
          message="名额已满"
          description="该课程当前名额已满，暂时无法申请。"
        />
      );
    }

    return (
      <Alert
        type="info"
        showIcon
        message="暂不接受申请"
        description="该课程当前为纯展示，未开放报名。"
      />
    );
  };

  return (
    <div>
      <Card>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space align="center" wrap>
            <Title level={3} style={{ margin: 0 }}>
              {course.title}
            </Title>
            <Tag color={meta.color}>{meta.text}</Tag>
          </Space>
          <Text type="secondary">
            授课教师：{course.teacherName || '未署名'} {course.term ? `· ${course.term}` : ''}
          </Text>
        </Space>
        <Paragraph style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>
          {course.description || '暂无课程简介'}
        </Paragraph>
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="章节数">{course.chapters.length}</Descriptions.Item>
          <Descriptions.Item label="名额">
            {formatSeats(course.capacity, course.seatsLeft, course.approvedCount)}
          </Descriptions.Item>
          {course.capacity != null ? (
            <Descriptions.Item label="已批准">{course.approvedCount} 人</Descriptions.Item>
          ) : null}
          {course.applicationCloseAt ? (
            <Descriptions.Item label="申请截止">
              {formatDateTime(course.applicationCloseAt)}
            </Descriptions.Item>
          ) : null}
        </Descriptions>
        {renderApplyArea()}
      </Card>

      <Card title="课程大纲" style={{ marginTop: 16 }}>
        {course.chapters.length === 0 ? (
          <Empty description="课程尚未发布章节" />
        ) : (
          <List
            dataSource={course.chapters}
            renderItem={(ch) => (
              <List.Item>
                <Space>
                  <Text type="secondary">第 {ch.order} 章</Text>
                  <Text>{ch.title}</Text>
                </Space>
              </List.Item>
            )}
          />
        )}
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          章节正文与实验内容需加入课程后可见。
        </Text>
      </Card>
    </div>
  );
}
