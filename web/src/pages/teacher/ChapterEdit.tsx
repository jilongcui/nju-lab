import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Segmented,
  Skeleton,
  Space,
  Tabs,
  Tag,
  theme,
  Typography,
} from 'antd';
import { PictureOutlined, PlayCircleOutlined, SaveOutlined } from '@ant-design/icons';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { getChapter, getCourse, saveChapter } from '../../api';
import type { Chapter, StoredFileInfo } from '../../types';
import MarkdownView from '../../components/MarkdownView';
import ImageLibraryPanel from '../../components/ImageLibraryPanel';
import { imageMarkdownSnippet } from '../../slides/imageActions';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';
import { useAuxiliaryStore } from '../../stores/auxiliary';

const { Paragraph, Text } = Typography;

type AuxTab = 'chapters' | 'images';

export default function ChapterEdit() {
  const { chapterId = '' } = useParams();
  const navigate = useNavigate();
  const { modal, message } = App.useApp();
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(true);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [siblings, setSiblings] = useState<Chapter[]>([]);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [auxTab, setAuxTab] = useState<AuxTab>('chapters');
  const contentAreaRef = useRef<TextAreaRef>(null);
  const [form] = Form.useForm();
  const setAuxCollapsed = useAuxiliaryStore((s) => s.setCollapsed);
  // 最近一次加载/保存成功的快照：与当前表单值比对得出「有未保存修改」
  const savedRef = useRef({ title: '', content: '' });
  // 章节 tab 里「放弃修改并切换」的导航要绕过路由守卫（已确认过丢弃）
  const allowLeaveRef = useRef(false);
  // 预览模式下渲染的是 MarkdownView，name="content" 的 Form.Item 会被卸载，
  // 字段随之注销；useWatch 默认只读「已注册字段」，此处必须 preserve 才能从 store 取值
  const content = Form.useWatch('content', { form, preserve: true }) as string | undefined;
  const title = Form.useWatch('title', { form, preserve: true }) as string | undefined;

  const dirty =
    !loading &&
    ((title ?? '') !== savedRef.current.title || (content ?? '') !== savedRef.current.content);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    setLoading(true);
    allowLeaveRef.current = false;
    try {
      const ch = await getChapter(chapterId);
      setChapter(ch);
      const values = { title: ch.title, content: ch.content ?? '' };
      form.setFieldsValue(values);
      savedRef.current = values;
      // 兄弟章节（右栏「章节」tab 的切换列表），与幻灯片页同一取法
      if (ch.courseId) {
        try {
          const course = await getCourse(ch.courseId);
          setSiblings((course.chapters ?? []).slice().sort((a, b) => a.order - b.order));
        } catch {
          setSiblings([]);
        }
      }
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
    // 预览模式下 textarea 未挂载（只能插到文末），插完切回编辑模式让插入点可见
    if (mode === 'preview') setMode('edit');
  };

  /** 右栏「章节」tab 点选切换：未保存时给 保存并切换 / 放弃修改并切换 / 取消 三个选择 */
  const switchChapter = (target: Chapter) => {
    if (target.id === chapterId) return;
    const go = () => navigate(`/teacher/chapters/${target.id}/edit`);
    if (!dirtyRef.current) {
      go();
      return;
    }
    let inst: ReturnType<typeof modal.confirm> | undefined;
    inst = modal.confirm({
      title: '当前章节有未保存的修改',
      content: `切换到「${target.title}」前要如何处理？`,
      footer: (
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={() => inst?.destroy()}>取消</Button>
          <Button
            danger
            onClick={() => {
              allowLeaveRef.current = true;
              inst?.destroy();
              go();
            }}
          >
            放弃修改并切换
          </Button>
          <Button
            type="primary"
            onClick={async () => {
              try {
                await handleSave();
              } catch {
                return; // 校验或保存失败：留在当前章节，不切换
              }
              inst?.destroy();
              go();
            }}
          >
            保存并切换
          </Button>
        </Space>
      ),
    });
  };

  // 右栏辅助区：Tabs —— 章节（兄弟章节切换）/ 图片（图片库，替代原来的 Drawer）
  useAuxiliaryPanel(
    '章节编辑',
    <Tabs
      activeKey={auxTab}
      onChange={(k) => setAuxTab(k as AuxTab)}
      items={[
        {
          key: 'chapters',
          label: '章节',
          children: (
            <>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                点选切换本章节的兄弟章节；切换前会检查是否有未保存的修改。
              </Paragraph>
              <List
                size="small"
                dataSource={siblings}
                renderItem={(item) => {
                  const current = item.id === chapterId;
                  return (
                    <List.Item
                      onClick={() => switchChapter(item)}
                      style={{
                        cursor: current ? 'default' : 'pointer',
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: current ? token.colorPrimaryBg : undefined,
                      }}
                    >
                      <Text
                        ellipsis={{ tooltip: item.title }}
                        strong={current}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        {item.order}. {item.title}
                      </Text>
                      {current && <Tag color="processing">当前</Tag>}
                    </List.Item>
                  );
                }}
              />
            </>
          ),
        },
        {
          key: 'images',
          label: '图片',
          children: (
            <ImageLibraryPanel
              active={auxTab === 'images'}
              compact
              multiple
              confirmText="插入到正文"
              onConfirm={insertImages}
            />
          ),
        },
      ]}
    />,
  );

  // 路由离开守卫：有未保存修改时拦截（左侧菜单、面包屑、「幻灯片」按钮、浏览器后退都走这里）。
  // 章节 tab 内部切换不走这里（allowLeaveRef 已单独确认过）。
  const blocker = useBlocker(() => dirtyRef.current && !allowLeaveRef.current);
  const guardOpenRef = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      guardOpenRef.current = false;
      return;
    }
    if (guardOpenRef.current) return;
    guardOpenRef.current = true;
    modal.confirm({
      title: '当前章节有未保存的修改',
      content: '离开后这些修改将丢失，确定离开吗？',
      okText: '放弃修改并离开',
      okButtonProps: { danger: true },
      cancelText: '继续编辑',
      onOk: () => {
        guardOpenRef.current = false;
        blocker.proceed();
      },
      onCancel: () => {
        guardOpenRef.current = false;
        blocker.reset();
      },
    });
  }, [blocker, modal]);

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
                  onClick={() => {
                    // 图片库已搬进右侧辅助栏的「图片」tab：展开面板并切过去
                    setAuxCollapsed(false);
                    setAuxTab('images');
                  }}
                >
                  插入图片
                </Button>
              </Space>
            }
          >
            <Input.TextArea
              ref={contentAreaRef}
              rows={18}
              placeholder="支持 Markdown：标题、列表、代码块、数学公式（行内 $E=mc^2$、独立行 $$…$$）、图片（点上方「插入图片」从图片库选或上传）、链接……"
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
