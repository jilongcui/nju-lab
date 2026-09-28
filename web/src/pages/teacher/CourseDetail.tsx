import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  Statistic,
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
  approveApplication,
  createProject,
  deleteChapter,
  getCourse,
  getCourseProgress,
  listCourseApplications,
  listEnrollments,
  listStudents,
  rejectApplication,
  removeEnrollment,
  saveChapter,
  updateCourse,
} from '../../api';
import type {
  Chapter,
  Course,
  CourseApplicationRow,
  CourseApplicationsView,
  CourseProgress,
  Enrollment,
  StudentUser,
} from '../../types';
import { STATE_META, formatDateTime, formatSeats } from '../../applicationState';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

/** 统一名单行的状态：报名申请（待审批/已通过/已驳回）+ 直接入册 */
type RosterState = 'pending' | 'approved' | 'rejected' | 'enrolled';

const ROSTER_META: Record<RosterState, { text: string; color: string }> = {
  pending: { text: '待审批', color: 'processing' },
  approved: { text: '已通过', color: 'success' },
  enrolled: { text: '已入册', color: 'cyan' },
  rejected: { text: '已驳回', color: 'error' },
};

/** 一名学生一行：由报名申请与选课名单聚合而来 */
interface RosterRow {
  key: string;
  studentId: string;
  nickname: string;
  username: string;
  state: RosterState;
  /** 最近一次申请时间 */
  appliedAt: string | null;
  /** 入册时间（未入册为 null） */
  joinedAt: string | null;
  /** 最近一次审批说明（驳回理由） */
  decisionNote: string | null;
  decidedAt: string | null;
  /** 待审批申请 id，批准/驳回时使用 */
  applicationId: string | null;
  /** 历史被驳回次数（重复申请时会 >0） */
  rejectedCount: number;
}

export default function CourseDetail() {
  const { courseId = '' } = useParams();
  const [activeTab, setActiveTab] = useState('chapters');
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [applicationsView, setApplicationsView] = useState<CourseApplicationsView | null>(null);
  const [allStudents, setAllStudents] = useState<StudentUser[]>([]);
  const [chapterModal, setChapterModal] = useState(false);
  const [projectModal, setProjectModal] = useState<Chapter | null>(null);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RosterRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [chapterForm] = Form.useForm();
  const [projectForm] = Form.useForm();
  const [enrollForm] = Form.useForm();

  useAuxiliaryPanel(
    '课程详情说明',
    <div>
      <Paragraph type="secondary">
        「章节与实验」页签维护章节大纲、章节下实验卡片与班级学习进度；「学生管理」页签在同一张表里
        处理报名申请与学生名单（批准即入册，也可直接添加/移出学生）。
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
      const [c, p, e, a] = await Promise.all([
        getCourse(courseId),
        getCourseProgress(courseId).catch(() => null),
        listEnrollments(courseId).catch(() => [] as Enrollment[]),
        listCourseApplications(courseId).catch(() => null),
      ]);
      setCourse(c);
      setProgress(p);
      setEnrollments(e ?? []);
      setApplicationsView(a);
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

  // ---------- 报名 + 名单（统一视图） ----------
  /** 报名申请与选课名单按学生聚合成一行：一名学生一行 */
  const roster = useMemo<RosterRow[]>(() => {
    const applications = applicationsView?.applications ?? [];
    const enrolledMap = new Map(enrollments.map((e) => [e.studentId, e]));
    const appsByStudent = new Map<string, CourseApplicationRow[]>();
    for (const a of applications) {
      const list = appsByStudent.get(a.studentId);
      if (list) {
        list.push(a);
      } else {
        appsByStudent.set(a.studentId, [a]);
      }
    }

    const rows: RosterRow[] = [];
    const studentIds = new Set<string>([...enrolledMap.keys(), ...appsByStudent.keys()]);
    for (const studentId of studentIds) {
      const enrollment = enrolledMap.get(studentId);
      const mine = (appsByStudent.get(studentId) ?? [])
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const pending = mine.find((a) => a.status === 'pending') ?? null;
      const approvedApp = mine.find((a) => a.status === 'approved') ?? null;
      const latest = mine[0] ?? null;
      const contact = enrollment ?? latest;

      let state: RosterState;
      if (enrollment) {
        // 在册：区分「申请通过」与「教师直接添加」
        state = approvedApp ? 'approved' : 'enrolled';
      } else if (pending) {
        state = 'pending';
      } else if (latest?.status === 'approved') {
        // 曾批准入册、后被移出
        state = 'approved';
      } else {
        state = 'rejected';
      }

      const decided = latest && latest.status !== 'pending' ? latest : null;
      rows.push({
        key: studentId,
        studentId,
        nickname: contact?.nickname ?? '',
        username: contact?.username ?? '',
        state,
        appliedAt: (pending ?? latest)?.createdAt ?? null,
        joinedAt: enrollment?.enrolledAt ?? null,
        decisionNote: decided?.decisionNote ?? null,
        decidedAt: decided?.decidedAt ?? null,
        applicationId: pending?.id ?? null,
        rejectedCount: mine.filter((a) => a.status === 'rejected').length,
      });
    }

    // 待审批排最前（申请时间升序＝先到先得），其后已入册，最后已驳回
    const weight: Record<RosterState, number> = {
      pending: 0,
      approved: 1,
      enrolled: 2,
      rejected: 3,
    };
    return rows.sort((a, b) => {
      if (weight[a.state] !== weight[b.state]) {
        return weight[a.state] - weight[b.state];
      }
      const at = new Date(a.appliedAt ?? a.joinedAt ?? 0).getTime();
      const bt = new Date(b.appliedAt ?? b.joinedAt ?? 0).getTime();
      return at - bt;
    });
  }, [applicationsView, enrollments]);

  const isFull =
    !!applicationsView &&
    applicationsView.capacity != null &&
    applicationsView.seatsLeft === 0;

  /** 批准 = 建入册 + 补发该课程全部已发布项目的任务 */
  const handleApprove = async (row: RosterRow) => {
    if (!row.applicationId) {
      return;
    }
    setBusyStudentId(row.studentId);
    try {
      const res = await approveApplication(courseId, row.applicationId);
      const created = (res as unknown as { assignmentsCreated?: number }).assignmentsCreated;
      message.success(created ? `已批准并补发 ${created} 个实验任务` : '已批准');
      await load();
    } finally {
      setBusyStudentId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget?.applicationId) {
      return;
    }
    setRejectBusy(true);
    try {
      await rejectApplication(courseId, rejectTarget.applicationId, rejectNote.trim() || undefined);
      message.success('已驳回；该学生可以重新申请');
      setRejectTarget(null);
      setRejectNote('');
      await load();
    } finally {
      setRejectBusy(false);
    }
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
    <div>
      {applicationsView ? (
        <Card style={{ marginBottom: 16 }}>
          <Space size={32} wrap>
            <Statistic title="待审批" value={applicationsView.pendingCount} />
            <Statistic title="已批准" value={applicationsView.approvedCount} />
            <Statistic
              title="剩余名额"
              value={applicationsView.capacity == null ? '不限' : (applicationsView.seatsLeft ?? 0)}
            />
            <Statistic title="名额上限" value={applicationsView.capacity ?? '不限'} />
          </Space>
          {isFull ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              message="名额已满"
              description="无法继续批准新申请；已提交的申请会保留在队列中，退课后可继续批准。"
            />
          ) : null}
        </Card>
      ) : null}

      <Card
        title={`报名与名单（${roster.length} 人）`}
        extra={
          <Button type="primary" size="small" icon={<UserAddOutlined />} onClick={openAddStudent}>
            添加学生
          </Button>
        }
      >
        <Table<RosterRow>
          rowKey="key"
          dataSource={roster}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无报名申请或学生" /> }}
          columns={[
            {
              title: '学生',
              key: 'student',
              render: (_, r) => (
                <Space>
                  <Text>{r.nickname || r.username}</Text>
                  <Text type="secondary">{r.username}</Text>
                </Space>
              ),
            },
            {
              title: '状态',
              dataIndex: 'state',
              width: 120,
              render: (state: RosterState, r) => (
                <Space direction="vertical" size={0}>
                  <Tag color={ROSTER_META[state].color}>{ROSTER_META[state].text}</Tag>
                  {r.rejectedCount > 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      曾驳回 {r.rejectedCount} 次
                    </Text>
                  ) : null}
                </Space>
              ),
            },
            {
              title: '申请时间',
              dataIndex: 'appliedAt',
              width: 170,
              render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
            },
            {
              title: '加入时间',
              dataIndex: 'joinedAt',
              width: 170,
              render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
            },
            {
              title: '审批说明',
              key: 'note',
              render: (_, r) =>
                r.decisionNote || r.decidedAt ? (
                  <Space direction="vertical" size={0}>
                    <Text>{r.decisionNote || '-'}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTime(r.decidedAt)}
                    </Text>
                  </Space>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
            {
              title: '操作',
              key: 'action',
              width: 180,
              render: (_, r) => {
                if (r.state === 'pending') {
                  return (
                    <Space>
                      <Button
                        type="primary"
                        size="small"
                        loading={busyStudentId === r.studentId}
                        disabled={isFull}
                        onClick={() => handleApprove(r)}
                      >
                        批准
                      </Button>
                      <Button size="small" onClick={() => setRejectTarget(r)}>
                        驳回
                      </Button>
                    </Space>
                  );
                }
                if (r.state === 'approved' || r.state === 'enrolled') {
                  return (
                    <Popconfirm
                      title="移出学生"
                      description={`确认将 ${r.nickname || r.username} 移出本课程？`}
                      onConfirm={() => handleRemoveStudent(r.studentId)}
                    >
                      <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                        移出
                      </Button>
                    </Popconfirm>
                  );
                }
                return <Text type="secondary">-</Text>;
              },
            },
          ]}
        />
      </Card>
    </div>
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
              <Button onClick={() => setActiveTab('students')}>去处理报名申请</Button>
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
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'chapters', label: '章节与实验', children: chaptersTab },
          { key: 'students', label: `学生管理（${roster.length}）`, children: studentsTab },
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

      <Modal
        title={`驳回申请：${rejectTarget?.nickname || rejectTarget?.username || ''}`}
        open={!!rejectTarget}
        onOk={handleReject}
        confirmLoading={rejectBusy}
        onCancel={() => {
          setRejectTarget(null);
          setRejectNote('');
        }}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
      >
        <Paragraph type="secondary">
          驳回后该学生可以重新申请。可填写理由，学生会看到。
        </Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={500}
          showCount
          value={rejectNote}
          placeholder="例如：未修完先修课程 / 名额已满，建议下期再选（可留空）"
          onChange={(e) => setRejectNote(e.target.value)}
        />
      </Modal>
    </div>
  );
}
