import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  message,
  Segmented,
  Skeleton,
  Space,
} from 'antd';
import { PictureOutlined, PlayCircleOutlined, SaveOutlined } from '@ant-design/icons';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { getChapter, saveChapter } from '../../api';
import type { Chapter, StoredFileInfo } from '../../types';
import MarkdownView from '../../components/MarkdownView';
import ImagePickerDrawer from '../../components/ImagePickerDrawer';
import { imageMarkdownSnippet } from '../../slides/imageActions';
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const contentAreaRef = useRef<TextAreaRef>(null);
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

  /** 图片库确认：把选中的图片（可多选，按点选顺序）以 `![名称](file:<id>)` 插到光标处 */
  const insertImages = (images: StoredFileInfo[]) => {
    if (!images.length) return;
    const current = (form.getFieldValue('content') as string | undefined) ?? '';
    const area = contentAreaRef.current?.resizableTextArea?.textArea;
    const pos = area?.selectionStart ?? current.length;
    form.setFieldsValue({
      content: current.slice(0, pos) + imageMarkdownSnippet(images) + current.slice(pos),
    });
    message.success(images.length > 1 ? `已插入 ${images.length} 张图片` : '已插入图片');
    setPickerOpen(false);
  };

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
          <Form.Item
            name="content"
            label={
              <Space size="middle">
                <span>章节内容（Markdown）</span>
                <Button
                  size="small"
                  icon={<PictureOutlined />}
                  onClick={() => setPickerOpen(true)}
                >
                  插入图片
                </Button>
              </Space>
            }
          >
            <Input.TextArea
              ref={contentAreaRef}
              rows={18}
              placeholder="支持 Markdown：标题、列表、代码块、图片（点上方「插入图片」从图片库选或上传）、链接……"
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

      <ImagePickerDrawer
        open={pickerOpen}
        multiple
        title="插入图片到正文（可多选，按点选顺序插入）"
        onClose={() => setPickerOpen(false)}
        onConfirm={insertImages}
      />
    </Card>
  );
}
