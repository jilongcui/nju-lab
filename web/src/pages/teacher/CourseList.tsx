import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { createCourse, deleteCourse, listCourses, listTeachers, publishCourse, updateCourse } from '../../api';
import type { Course, TeacherUser } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';
import { useAuthStore } from '../../stores/auth';

const { Title, Paragraph, Text } = Typography;

interface CourseFormValues {
  title: string;
  term?: string;
  description?: string;
  /** 仅管理员可见该表单项：把课程转让给其他教师 */
  teacherId?: string;
}

export default function CourseList() {
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<Course[]>([]);
  const [editing, setEditing] = useState<Course | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [teachers, setTeachers] = useState<TeacherUser[]>([]);
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';
  const [form] = Form.useForm<CourseFormValues>();

  useAuxiliaryPanel(
    '课程管理',
    <Paragraph type="secondary">
      课程是章节与实验的容器。创建课程后进入详情页编排章节、添加实验并维护选课学生；发布后学生可见。
    </Paragraph>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCourses((await listCourses()) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 管理员可转让课程 → 预取教师名单（接口本身仅管理员可见）
  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    listTeachers()
      .then((t) => setTeachers(t ?? []))
      .catch(() => setTeachers([]));
  }, [isAdmin]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (c: Course) => {
    setEditing(c);
    form.setFieldsValue({
      title: c.title,
      term: c.term,
      description: c.description,
      ...(isAdmin ? { teacherId: c.teacherId } : {}),
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await updateCourse(editing.id, values);
        message.success('课程已更新');
      } else {
        await createCourse(values);
        message.success('课程已创建');
      }
      setModalOpen(false);
      form.resetFields();
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublish = async (id: string) => {
    await publishCourse(id);
    message.success('课程已发布');
    await load();
  };

  const handleDelete = async (id: string) => {
    await deleteCourse(id);
    message.success('课程已删除');
    await load();
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          课程管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建课程
        </Button>
      </div>

      {courses.length === 0 ? (
        <Card>
          <Empty description="还没有课程" />
        </Card>
      ) : (
        <Row gutter={[16, 16]} align="stretch">
          {courses.map((c) => (
            <Col xs={24} sm={12} lg={8} key={c.id} style={{ display: 'flex' }}>
              <Card
                title={<span title={c.title}>{c.title}</span>}
                extra={<StatusTag status={c.status} />}
                style={{ width: '100%', display: 'flex', flexDirection: 'column' }}
                styles={{ body: { flex: 1 } }}
                actions={[
                  <Link key="detail" to={`/teacher/courses/${c.id}`}>
                    管理
                  </Link>,
                  <span key="edit" onClick={() => openEdit(c)}>
                    <EditOutlined /> 编辑
                  </span>,
                  ...(c.status === 'draft'
                    ? [
                        <Popconfirm
                          key="publish"
                          title="发布后学生可见，确认发布？"
                          onConfirm={() => handlePublish(c.id)}
                        >
                          <span>发布</span>
                        </Popconfirm>,
                      ]
                    : []),
                  <Popconfirm
                    key="del"
                    title="删除课程"
                    description="课程下的章节、实验与提交将级联删除且不可恢复，确认？"
                    onConfirm={() => handleDelete(c.id)}
                  >
                    <span style={{ color: '#ff4d4f' }}>
                      <DeleteOutlined /> 删除
                    </span>
                  </Popconfirm>,
                ]}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Text type="secondary">授课教师：{c.teacherName || '-'}</Text>
                  <Text type="secondary">学期：{c.term || '-'}</Text>
                  <Paragraph
                    ellipsis={{ rows: 2, tooltip: c.description ? { title: c.description } : false }}
                    type="secondary"
                    /* 简介不足两行也占满两行高度，保证整排卡片底边对齐 */
                    style={{ marginBottom: 0, minHeight: '3.15em' }}
                  >
                    {c.description || '暂无课程简介'}
                  </Paragraph>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title={editing ? '编辑课程' : '新建课程'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}>
            <Input placeholder="如：Skill 工程导论" maxLength={128} />
          </Form.Item>
          <Form.Item name="term" label="学期">
            <Input placeholder="如：2026 秋" />
          </Form.Item>
          <Form.Item name="description" label="课程简介">
            <Input.TextArea rows={3} placeholder="课程目标与内容简介" />
          </Form.Item>
          {editing && isAdmin ? (
            <Form.Item
              name="teacherId"
              label="授课教师（转让课程）"
              extra="仅管理员可改；转让后课程归新教师所有，不再出现在原教师的课程列表中。"
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择新的授课教师"
                options={teachers.map((t) => ({
                  value: t.id,
                  label: `${t.nickname || t.username}（${t.username}）`,
                }))}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
