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
  Skeleton,
  Space,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { createCourse, deleteCourse, listCourses, publishCourse, updateCourse } from '../../api';
import type { Course } from '../../types';
import StatusTag from '../../components/StatusTag';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

interface CourseFormValues {
  title: string;
  term?: string;
  description?: string;
}

export default function CourseList() {
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<Course[]>([]);
  const [editing, setEditing] = useState<Course | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (c: Course) => {
    setEditing(c);
    form.setFieldsValue({ title: c.title, term: c.term, description: c.description });
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
        <Row gutter={[16, 16]}>
          {courses.map((c) => (
            <Col xs={24} sm={12} lg={8} key={c.id}>
              <Card
                title={c.title}
                extra={<StatusTag status={c.status} />}
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
                <Space direction="vertical" size={4}>
                  <Text type="secondary">学期：{c.term || '-'}</Text>
                  <Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ marginBottom: 0 }}>
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
        </Form>
      </Modal>
    </div>
  );
}
