import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  DownCircleOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
  UpCircleOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  addEnrollments,
  createProject,
  deleteChapter,
  getCourse,
  getCourseProgress,
  listEnrollments,
  listStudents,
  removeEnrollment,
  saveChapter,
  updateCourse,
} from '../../api';
import type { Chapter, Course, CourseProgress, Enrollment, StudentUser } from '../../types';
import { STATE_META, formatDateTime, formatSeats } from '../../applicationState';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

export default function CourseDetail() {
  const { courseId = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [allStudents, setAllStudents] = useState<StudentUser[]>([]);
  const [chapterModal, setChapterModal] = useState(false);
  const [projectModal, setProjectModal] = useState<Chapter | null>(null);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [chapterForm] = Form.useForm();
  const [projectForm] = Form.useForm();
  const [enrollForm] = Form.useForm();

  useAuxiliaryPanel(
    '课程详情说明',
    <div>
      <Paragraph type="secondary">
        「章节与实验」页签维护章节大纲、章节下实验卡片与班级学习进度；「学生管理」页签维护选课名单。
      </Paragraph>
      <Paragraph type="secondary">
        实验默认解锁规则：完成所属章节之前的全部已发布章节。章节下线后学生不可见。
      </Paragraph>
      <Paragraph type="secondary">
        「公开报名」页签控制课程是否出现在公开目录、名额上限与申请开放时间。
        发布课程只表示「公开可见」，能否申请由开放时间独立决定。
      </Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p, e] = await Promise.all([
        getCourse(courseId),
        getCourseProgress(courseId).catch(() => null),
        listEnrollments(courseId).catch(() => [] as Enrollment[]),
      ]);
      setCourse(c);
      setProgress(p);
      setEnrollments(e ?? []);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 报名设置表单与课程数据同步（时间字段用 dayjs 供 DatePicker 使用）
  useEffect(() => {
    if (!course) {
      return;
    }
    enrollForm.setFieldsValue({
      capacity: course.capacity ?? undefined,
      applicationOpenAt: course.applicationOpenAt ? dayjs(course.applicationOpenAt) : null,
      applicationCloseAt: course.applicationCloseAt ? dayjs(course.applicationCloseAt) : null,
    });
  }, [course, enrollForm]);

  /** 保存公开报名设置 */
  const handleSaveEnrollmentSetting = async () => {
    const values = await enrollForm.validateFields();
    setSubmitting(true);
    try {
      await updateCourse(courseId, {
        capacity: values.capacity ?? null,
        applicationOpenAt: values.applicationOpenAt
          ? values.applicationOpenAt.toISOString()
          : null,
        applicationCloseAt: values.applicationCloseAt
          ? values.applicationCloseAt.toISOString()
          : null,
      } as Partial<Course>);
      message.success('公开报名设置已保存');
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- 章节 ----------
  const handleCreateChapter = async () => {
    const values = await chapterForm.validateFields();
    setSubmitting(true);
    try {
      await saveChapter(courseId, values);
      message.success('章节已创建');
      setChapterModal(false);
      chapterForm.resetFields();
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleChapterStatus = async (ch: Chapter) => {
    const next = ch.status === 'published' ? 'draft' : 'published';
    await saveChapter(courseId, { id: ch.id, title: ch.title, order: ch.order, status: next });
    message.success(next === 'published' ? '章节已发布' : '章节已下线');
    await load();
  };

  const handleDeleteChapter = async (ch: Chapter) => {
    await deleteChapter(ch.id);
    message.success('章节已删除');
    await load();
  };

  // ---------- 实验 ----------
  const handleCreateProject = async () => {
    const values = await projectForm.validateFields();
    if (!projectModal) return;
    setSubmitting(true);
    try {
      await createProject({ ...values, courseId, chapterId: projectModal.id });
      message.success('实验项目已创建，可进入详情页完善项目信息');
      setProjectModal(null);
      projectForm.resetFields();
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- 学生管理 ----------
  const openAddStudent = async () => {
    setAddStudentOpen(true);
    setSelectedStudentIds([]);
    try {
      setAllStudents((await listStudents()) ?? []);
    } catch {
      // 拦截器已提示
    }
  };

  const candidateOptions = useMemo(() => {
    const enrolled = new Set(enrollments.map((e) => e.studentId));
    return allStudents
      .filter((s) => !enrolled.has(s.id))
      .map((s) => ({ label: `${s.nickname}（${s.username}）`, value: s.id }));
  }, [allStudents, enrollments]);

  const handleAddStudents = async () => {
    if (selectedStudentIds.length === 0) {
      message.warning('请选择要添加的学生');
      return;
    }
    setSubmitting(true);
    try {
      await addEnrollments(courseId, selectedStudentIds);
      message.success('学生已加入课程');
      setAddStudentOpen(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveStudent = async (studentId: string) => {
    await removeEnrollment(courseId, studentId);
    message.success('已移出学生');
    await load();
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }
  if (!course) {
    return <Empty description="课程不存在" />;
  }

  const chapters = [...(course.chapters ?? [])].sort((a, b) => a.order - b.order);

  const chaptersTab = (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={15}>
        <Card
          title="章节大纲"
          extra={
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setChapterModal(true)}>
              新建章节
            </Button>
          }
        >
          {chapters.length === 0 ? (
            <Empty description="还没有章节，点击右上角新建" />
          ) : (
            <List
              dataSource={chapters}
              renderItem={(ch, idx) => (
                <List.Item
                  actions={[
                    <Link key="edit" to={`/teacher/chapters/${ch.id}/edit`}>
                      <EditOutlined /> 编辑内容
                    </Link>,
                    <Button
                      key="toggle"
                      size="small"
                      type="link"
                      icon={ch.status === 'published' ? <DownCircleOutlined /> : <UpCircleOutlined />}
                      onClick={() => handleToggleChapterStatus(ch)}
                    >
                      {ch.status === 'published' ? '下线' : '发布'}
                    </Button>,
                    <Button
                      key="add"
                      size="small"
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => setProjectModal(ch)}
                    >
                      添加实验
                    </Button>,
                    <Popconfirm
                      key="del"
                      title="删除章节"
                      description="章节下的实验项目将一并删除，确认？"
                      onConfirm={() => handleDeleteChapter(ch)}
                    >
                      <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong>
                          第 {idx + 1} 章 · {ch.title}
                        </Text>
                        <StatusTag status={ch.status} />
                      </Space>
                    }
                    description={
                      (ch.projects ?? []).length === 0 ? (
                        <Text type="secondary">本章节暂无实验项目</Text>
                      ) : (
                        <Space wrap style={{ marginTop: 8 }}>
                          {(ch.projects ?? []).map((p) => (
                            <Link key={p.id} to={`/teacher/projects/${p.id}`}>
                              <Card size="small" hoverable style={{ minWidth: 220 }}>
                                <Space>
                                  <ExperimentOutlined />
                                  <Text>{p.title}</Text>
                                  <StatusTag status={p.status} />
                                </Space>
                              </Card>
                            </Link>
                          ))}
                        </Space>
                      )
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </Col>
      <Col xs={24} lg={9}>
        <Card title={`班级学习进度（${progress?.studentCount ?? 0} 人）`}>
          {!progress || progress.students.length === 0 ? (
            <Empty description="暂无学生进度数据" />
          ) : (
            <List
              dataSource={progress.students}
              renderItem={(s) => {
                const percent = s.totalChapters > 0 ? Math.round((s.completedCount / s.totalChapters) * 100) : 0;
                return (
                  <List.Item>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text>
                          {s.nickname}
                          <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                            {s.username}
                          </Text>
                        </Text>
                        <Text type="secondary">
                          {s.completedCount}/{s.totalChapters} 章
                        </Text>
                      </div>
                      <Progress percent={percent} size="small" />
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </Card>
      </Col>
    </Row>
  );

  const studentsTab = (
    <Card
      title={`选课学生（${enrollments.length} 人）`}
      extra={
        <Button type="primary" size="small" icon={<UserAddOutlined />} onClick={openAddStudent}>
          添加学生
        </Button>
      }
    >
      <Table<Enrollment>
        rowKey="id"
        dataSource={enrollments}
        pagination={false}
        locale={{ emptyText: <Empty description="暂无选课学生" /> }}
        columns={[
          { title: '昵称', dataIndex: 'nickname' },
          { title: '用户名', dataIndex: 'username' },
          {
            title: '加入时间',
            dataIndex: 'enrolledAt',
            render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
          },
          {
            title: '操作',
            width: 100,
            render: (_, r) => (
              <Popconfirm
                title="移出学生"
                description={`确认将 ${r.nickname} 移出本课程？`}
                onConfirm={() => handleRemoveStudent(r.studentId)}
              >
                <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                  移出
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </Card>
  );

  /** 公开报名设置：控制课程是否可被申请、名额上限与申请开放时间 */
  const enrollmentTab = (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={14}>
        <Card title="公开报名设置">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="「已发布」只表示课程对外可见"
            description="能否申请由下面的开放时间与名额共同决定。留空表示不开放申请（纯展示）。"
          />
          <Form form={enrollForm} layout="vertical">
            <Form.Item
              name="capacity"
              label="名额上限"
              extra="留空表示不限名额。名额按「已批准人数」计算，满后不再受理新申请。"
            >
              <InputNumber min={0} style={{ width: 200 }} placeholder="不限" />
            </Form.Item>
            <Form.Item
              name="applicationOpenAt"
              label="申请开放时间"
              extra="留空则始终不开放申请；设为未来时间可实现「先展示、到点开放申请」。"
            >
              <DatePicker showTime allowClear style={{ width: 260 }} placeholder="不开放申请" />
            </Form.Item>
            <Form.Item name="applicationCloseAt" label="申请截止时间" extra="留空表示不设截止。">
              <DatePicker showTime allowClear style={{ width: 260 }} placeholder="不设截止" />
            </Form.Item>
            <Space>
              <Button
                type="primary"
                loading={submitting}
                onClick={handleSaveEnrollmentSetting}
              >
                保存设置
              </Button>
              <Button onClick={() => navigate(`/teacher/courses/${courseId}/applications`)}>
                去审批报名
              </Button>
            </Space>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={10}>
        <Card title="当前报名状态">
          {(() => {
            const meta = STATE_META[course.applicationState ?? 'not_published'];
            const approvedCount = enrollments.length;
            return (
              <Descriptions column={1} size="small">
                <Descriptions.Item label="课程可见性">
                  <StatusTag status={course.status} />
                </Descriptions.Item>
                <Descriptions.Item label="申请入口">
                  <Tag color={meta.color}>{meta.text}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="名额">
                  {formatSeats(course.capacity ?? null, null, approvedCount)}
                </Descriptions.Item>
                <Descriptions.Item label="申请开放时间">
                  {course.applicationOpenAt
                    ? formatDateTime(course.applicationOpenAt)
                    : '未开放申请'}
                </Descriptions.Item>
                <Descriptions.Item label="申请截止时间">
                  {course.applicationCloseAt
                    ? formatDateTime(course.applicationCloseAt)
                    : '不设截止'}
                </Descriptions.Item>
                <Descriptions.Item label="公开页链接">
                  {course.slug ? (
                    <a href={`${import.meta.env.BASE_URL}course/${course.slug}`} target="_blank" rel="noreferrer">
                      /course/{course.slug}
                    </a>
                  ) : (
                    <Text type="secondary">已发布后自动生成</Text>
                  )}
                </Descriptions.Item>
              </Descriptions>
            );
          })()}
          <Divider style={{ margin: '12px 0' }} />
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            提示：课程发布后公开链接标识会锁定，保证已分享的链接不失效。
          </Paragraph>
        </Card>
      </Col>
    </Row>
  );

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {course.title}
        </Title>
        <StatusTag status={course.status} />
        <Text type="secondary">{course.term || ''}</Text>
      </Space>

      <Tabs
        defaultActiveKey="chapters"
        items={[
          { key: 'chapters', label: '章节与实验', children: chaptersTab },
          { key: 'students', label: `学生管理（${enrollments.length}）`, children: studentsTab },
          { key: 'enrollment', label: '公开报名', children: enrollmentTab },
        ]}
      />

      <Modal
        title="新建章节"
        open={chapterModal}
        onOk={handleCreateChapter}
        onCancel={() => setChapterModal(false)}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={chapterForm} layout="vertical">
          <Form.Item name="title" label="章节标题" rules={[{ required: true, message: '请输入章节标题' }]}>
            <Input placeholder="如：Skill 工程入门" maxLength={128} />
          </Form.Item>
          <Form.Item name="order" label="排序号" initialValue={chapters.length + 1}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`在「${projectModal?.title ?? ''}」下新建实验项目`}
        open={!!projectModal}
        onOk={handleCreateProject}
        onCancel={() => setProjectModal(null)}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={projectForm} layout="vertical">
          <Form.Item name="title" label="实验标题" rules={[{ required: true, message: '请输入实验标题' }]}>
            <Input placeholder="如：编写你的第一个 Skill" />
          </Form.Item>
          <Form.Item name="objectives" label="实验目标（可稍后在详情页完善）">
            <Input.TextArea rows={3} placeholder="学生完成本实验应掌握的能力点" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="添加学生"
        open={addStudentOpen}
        onOk={handleAddStudents}
        onCancel={() => setAddStudentOpen(false)}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Paragraph type="secondary">从全部学生中选择，已在本课程的学生不会出现在选项中。</Paragraph>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="选择学生（可多选）"
          options={candidateOptions}
          value={selectedStudentIds}
          onChange={setSelectedStudentIds}
          optionFilterProp="label"
          notFoundContent="没有可添加的学生"
        />
      </Modal>
    </div>
  );
}
