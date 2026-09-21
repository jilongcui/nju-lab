import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
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
} from '../../api';
import type { Chapter, Course, CourseProgress, Enrollment, StudentUser } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

export default function CourseDetail() {
  const { courseId = '' } = useParams();
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

  useAuxiliaryPanel(
    '课程详情说明',
    <div>
      <Paragraph type="secondary">
        「章节与实验」页签维护章节大纲、章节下实验卡片与班级学习进度；「学生管理」页签维护选课名单。
      </Paragraph>
      <Paragraph type="secondary">
        实验默认解锁规则：完成所属章节之前的全部已发布章节。章节下线后学生不可见。
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
