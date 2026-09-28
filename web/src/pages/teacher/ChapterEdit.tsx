import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Empty, Form, Input, message, Segmented, Skeleton, Space } from 'antd';
import { PlayCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { getChapter, saveChapter } from '../../api';
import type { Chapter } from '../../types';
import MarkdownView from '../../components/MarkdownView';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';
import { Typography } from 'antd';

const { Paragraph } = Typography;

export default function ChapterEdit() {
  const { chapterId = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  // 预览模式下渲染的是 MarkdownView，name="content" 的 Form.Item 会被卸载，
  // 字段随之注销；useWatch 默认只读「已注册字段」，此处必须 preserve 才能从 store 取值
  const content = Form.useWatch('content', { form, preserve: true }) as string | undefined;

  useAuxiliaryPanel(
    '章节编辑',
    <Paragraph type="secondary">
      章节内容支持 Markdown。左侧编辑、右侧可切换预览；保存后学生端立即可见（已发布课程）。
    </Paragraph>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ch = await getChapter(chapterId);
      setChapter(ch);
      form.setFieldsValue({ title: ch.title, content: ch.content ?? '' });
    } finally {
      setLoading(false);
    }
  }, [chapterId, form]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    await form.validateFields();
    if (!chapter) return;
    // 同上：validateFields 只返回已注册字段，预览模式下 content 会缺席，
    // 若直接使用会导致本次编辑被 chapter.content（旧值）静默覆盖，故取 store 全量值
    const values = form.getFieldsValue(true) as Partial<Chapter>;
    setSaving(true);
    try {
      await saveChapter(chapter.courseId, { ...chapter, ...values });
      message.success('章节已保存');
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }
  if (!chapter) {
    return <Empty description="章节不存在" />;
  }

  return (
    <Card
      title="章节编辑"
      extra={
        <Space>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={() => navigate(`/teacher/chapters/${chapterId}/slides`)}
          >
            幻灯片
          </Button>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as 'edit' | 'preview')}
            options={[
              { label: '编辑', value: 'edit' },
              { label: '预览', value: 'preview' },
            ]}
          />
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="章节标题" rules={[{ required: true, message: '请输入章节标题' }]}>
          <Input />
        </Form.Item>
        {mode === 'edit' ? (
          <Form.Item name="content" label="章节内容（Markdown）">
            <Input.TextArea
              rows={18}
              placeholder="支持 Markdown：标题、列表、代码块、图片、链接……"
            />
          </Form.Item>
        ) : (
          <Form.Item label="内容预览">
            <div style={{ border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8, padding: '4px 16px', minHeight: 300 }}>
              <MarkdownView content={content} />
            </div>
          </Form.Item>
        )}
      </Form>
    </Card>
  );
}
