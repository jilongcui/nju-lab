import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  ColorPicker,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Skeleton,
  Slider,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  EditOutlined,
  FileImageOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  createSlideTemplate,
  deleteChapterSlides,
  deleteSlideTemplate,
  generateChapterSlides,
  getChapter,
  getChapterSlides,
  getCourse,
  saveChapterSlides,
  syncChapterSlidesHash,
  updateSlideTemplate,
} from '../../api';
import type {
  Chapter,
  ChapterSlidesResponse,
  SlideJson,
  SlideLayout,
  SlideTemplateDesign,
  StoredFileInfo,
} from '../../types';
import SlideStage from '../../slides/SlideStage';
import { collectFileRefs, fetchFileDataUrls } from '../../slides/files';
import {
  IMAGE_LAYOUT_OPTIONS,
  SINGLE_IMAGE_LAYOUTS,
  applyImageActionToMarkdown,
  applyImageActionToSlides,
  splitMarkdownPages,
} from '../../slides/imageActions';
import ImagePickerDrawer from '../../components/ImagePickerDrawer';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Text, Paragraph } = Typography;

const LAYOUT_LABEL: Record<string, string> = {
  cover: '封面',
  section: '分节',
  agenda: '目录',
  bullets: '要点',
  steps: '步骤',
  stat: '数字',
  compare: '对比',
  'two-col': '两栏',
  code: '代码',
  quote: '引文',
  image: '图片',
  'image-full': '全幅图',
  'image-left': '左图右文',
  'image-right': '右图左文',
  'image-grid': '多图',
  end: '结束',
};

const DENSITY_OPTIONS = [
  { label: '紧凑', value: 'compact' },
  { label: '适中', value: 'cozy' },
  { label: '宽松', value: 'loose' },
];

const FONT_SCALE_OPTIONS = [
  { label: '小字', value: 'compact' },
  { label: '标准', value: 'standard' },
  { label: '大字', value: 'large' },
];

const CARD_STYLE_OPTIONS = [
  { label: '无', value: 'none' },
  { label: '浅色底', value: 'soft' },
  { label: '描边', value: 'outline' },
];

/**
 * 教师端：章节幻灯片（生成 / 双视图编辑 / 模板调参 / 在线放映 / 跨章节切换）。
 *
 * 关键约定：
 *   · 生成是**手动触发**的（不自动重生成），章节内容变了只提示；
 *   · 内容真源是 JSON；Markdown 是投影，保存时由后端 `mergeMarkdown` 按位次保留页级高级设置；
 *   · 换模板**不重新生成**（渲染层数据驱动），改的是 deck.templateId。
 */
export default function ChapterSlides() {
  const { chapterId = '' } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<ChapterSlidesResponse | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [siblings, setSiblings] = useState<Chapter[]>([]);

  const [mode, setMode] = useState<'json' | 'markdown'>('json');
  const [jsonText, setJsonText] = useState('');
  const [mdText, setMdText] = useState('');
  const [editing, setEditing] = useState(false);

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  const [design, setDesign] = useState<SlideTemplateDesign>({});

  const [currentIndex, setCurrentIndex] = useState(0);
  const [gotoIndex, setGotoIndex] = useState<number | undefined>(undefined);
  const [presenting, setPresenting] = useState(false);
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, string>>({});

  // 图片选择器：insert = 在当前页之后插入图片页；replace = 替换当前页的单图
  const [picker, setPicker] = useState<
    { kind: 'insert'; layout: SlideLayout } | { kind: 'replace' } | null
  >(null);

  useAuxiliaryPanel(
    '章节幻灯片',
    <Space direction="vertical" size={8}>
      <Paragraph type="secondary" style={{ margin: 0 }}>
        由大模型按章节内容生成在线演示文稿（reveal.js）。生成后可直接在线放映，也可改内容（JSON /
        Markdown）与模板。
      </Paragraph>
      <Paragraph type="secondary" style={{ margin: 0 }}>
        放映时：<Text code>←/→</Text> 翻页、<Text code>空格</Text> 下一页、<Text code>O</Text> 总览、
        <Text code>Esc</Text> 退出。
      </Paragraph>
      <Paragraph type="secondary" style={{ margin: 0 }}>
        章节正文改动后只会**提示**，不会自动重新生成（避免覆盖手工编辑与浪费额度）。
      </Paragraph>
    </Space>,
  );

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [slidesData, chapterData] = await Promise.all([
          getChapterSlides(chapterId),
          getChapter(chapterId),
        ]);
        setData(slidesData);
        setChapter(chapterData);
        setTemplateId(slidesData.deck?.templateId ?? null);
        setJsonText(JSON.stringify(slidesData.deck?.slides ?? [], null, 2));
        setMdText(slidesData.deck?.markdown ?? '');
        if (chapterData.courseId) {
          try {
            const course = await getCourse(chapterData.courseId);
            setSiblings(
              (course.chapters ?? []).slice().sort((a, b) => a.order - b.order),
            );
          } catch {
            setSiblings([]);
          }
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [chapterId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 生成中：轮询状态（不闪骨架屏）
  useEffect(() => {
    if (data?.deck?.status !== 'generating') return;
    const timer = setInterval(() => {
      void load(true);
    }, 2500);
    return () => clearInterval(timer);
  }, [data?.deck?.status, load]);

  // 预取平台图片（iframe 是 opaque origin，带不了鉴权头，只能内联成 data URL）
  const refs = useMemo(
    () => collectFileRefs(data?.deck?.slides ?? [], data?.template?.design?.logoFileId ?? null),
    [data?.deck?.slides, data?.template?.design?.logoFileId],
  );
  useEffect(() => {
    if (!refs.length) {
      setImageDataUrls({});
      return;
    }
    let cancelled = false;
    void fetchFileDataUrls(refs).then((map) => {
      if (!cancelled) setImageDataUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [refs]);

  const currentTemplate = useMemo(() => {
    if (!data) return null;
    return (
      data.templates.find((t) => t.id === templateId) ??
      data.template ??
      null
    );
  }, [data, templateId]);

  // 每次切换目标章节，模板调参面板同步到该 deck 生效的模板
  useEffect(() => {
    if (currentTemplate) setDesign(currentTemplate.design ?? {});
  }, [currentTemplate]);

  const jsonError = useMemo(() => {
    if (mode !== 'json' || !jsonText.trim()) return null;
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      return Array.isArray(parsed) ? null : 'JSON 必须是数组（每页一个对象）';
    } catch (error) {
      return (error as Error).message;
    }
  }, [mode, jsonText]);

  const deck = data?.deck ?? null;
  const canEdit = data?.canEdit ?? false;
  const siblingIndex = siblings.findIndex((item) => item.id === chapterId);
  const prevChapter = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
  const nextChapter =
    siblingIndex >= 0 && siblingIndex < siblings.length - 1
      ? siblings[siblingIndex + 1]
      : null;

  const handleGenerate = async (force = false) => {
    setBusy(true);
    try {
      const result = await generateChapterSlides(chapterId, {
        templateId: templateId ?? undefined,
        force,
      });
      message.success(
        result.cached ? '内容未变，已复用现有幻灯片' : '已开始生成，稍候即可预览',
      );
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  /** 当前页（编辑区文本口径）是否是可换图的单图版式：JSON 模式结构化判断，MD 模式看页块里有没有图片行 */
  const currentPageHasSingleImage = useMemo(() => {
    if (!deck) return false;
    if (mode === 'json') {
      try {
        const slides = JSON.parse(jsonText) as SlideJson[];
        const slide = slides[currentIndex];
        return !!slide && SINGLE_IMAGE_LAYOUTS.includes(slide.layout);
      } catch {
        return false;
      }
    }
    const pages = splitMarkdownPages(mdText);
    return /^\s*!\[/m.test(pages[currentIndex] ?? '');
  }, [deck, mode, jsonText, mdText, currentIndex]);

  /** 图片选择器确认：应用到当前编辑视图的文本里（「保存内容」后才真正生效） */
  const handlePickerConfirm = (images: StoredFileInfo[]) => {
    if (!picker) return;
    try {
      if (mode === 'json') {
        const slides = JSON.parse(jsonText) as SlideJson[];
        const action =
          picker.kind === 'insert'
            ? { kind: 'insert' as const, layout: picker.layout, afterIndex: currentIndex }
            : { kind: 'replace' as const, index: currentIndex };
        setJsonText(JSON.stringify(applyImageActionToSlides(slides, action, images), null, 2));
      } else {
        const action =
          picker.kind === 'insert'
            ? { kind: 'insert' as const, layout: picker.layout, afterIndex: currentIndex }
            : { kind: 'replace' as const, index: currentIndex };
        setMdText(applyImageActionToMarkdown(mdText, action, images));
      }
      setEditing(true);
      message.success('已应用到编辑区，点「保存内容」后生效');
    } catch (error) {
      message.error(`应用失败：${(error as Error).message}`);
    } finally {
      setPicker(null);
    }
  };

  const handleSaveContent = async () => {
    if (jsonError) {
      message.error(`JSON 有问题：${jsonError}`);
      return;
    }
    setBusy(true);
    try {
      const payload =
        mode === 'json'
          ? { slides: JSON.parse(jsonText) as SlideJson[] }
          : { markdown: mdText };
      const result = await saveChapterSlides(chapterId, { ...payload, templateId });
      if (result.warnings?.length) message.warning(result.warnings.join('；'));
      message.success('已保存');
      setEditing(false);
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  const handleTemplateChange = async (value: string) => {
    setTemplateId(value);
    if (!deck) {
      message.info('已选好模板，点「生成」即可套用');
      return;
    }
    // 换模板不重生成：模板只提供样式，deck 内容是数据驱动的
    await saveChapterSlides(chapterId, { templateId: value });
    message.success('已切换模板');
    await load(true);
  };

  const handleSaveDesign = async () => {
    if (!currentTemplate || !chapter) return;
    setBusy(true);
    try {
      if (currentTemplate.isBuiltin) {
        // 内置模板不可改，自动「另存为」课程模板再应用
        const created = await createSlideTemplate(chapter.courseId, {
          name: `${currentTemplate.name}（自定义）`,
          description: `基于内置模板 ${currentTemplate.name} 派生`,
          fromBuiltinId: currentTemplate.id,
          design,
        });
        setTemplateId(created.id);
        if (deck) await saveChapterSlides(chapterId, { templateId: created.id });
        message.success('已另存为课程模板并应用');
      } else {
        await updateSlideTemplate(currentTemplate.id, { design });
        message.success('模板已更新');
      }
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!currentTemplate || currentTemplate.isBuiltin) return;
    setBusy(true);
    try {
      const result = await deleteSlideTemplate(currentTemplate.id);
      setTemplateId(null);
      message.success(
        result.unboundDecks
          ? `模板已删除，${result.unboundDecks} 个章节已回落默认模板`
          : '模板已删除',
      );
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDeck = async () => {
    setBusy(true);
    try {
      await deleteChapterSlides(chapterId);
      message.success('幻灯片已删除');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (!data || !chapter) return <Empty description="章节不存在" />;

  const previewSlides: SlideJson[] = deck?.slides ?? [];
  const stage = (
    <SlideStage
      slides={previewSlides}
      template={{
        baseTheme: currentTemplate?.baseTheme ?? 'simple',
        css: currentTemplate?.css ?? '',
      }}
      config={deck?.config}
      footerText={currentTemplate?.design?.footerText ?? null}
      logoDataUrl={
        currentTemplate?.design?.logoFileId
          ? imageDataUrls[`file:${currentTemplate.design.logoFileId}`] ?? null
          : null
      }
      imageDataUrls={imageDataUrls}
      gotoIndex={gotoIndex}
      onIndexChange={setCurrentIndex}
      presenting={presenting}
      onExitPresenting={() => setPresenting(false)}
      height={520}
    />
  );

  if (presenting) {
    return (
      <>
        {stage}
        <div
          style={{
            position: 'fixed',
            left: 16,
            bottom: 12,
            zIndex: 1300,
            opacity: 0.5,
            // 容器绝不拦鼠标（放映态浮层纪律，§9.5 坑 3），只有按钮本身可点
            pointerEvents: 'none',
          }}
        >
          <Space style={{ pointerEvents: 'auto' }}>
            {prevChapter && (
              <Tooltip title={`上一章：${prevChapter.title}`}>
                <Button
                  size="small"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => navigate(`/teacher/chapters/${prevChapter.id}/slides`)}
                />
              </Tooltip>
            )}
            {nextChapter && (
              <Tooltip title={`下一章：${nextChapter.title}`}>
                <Button
                  size="small"
                  icon={<ArrowRightOutlined />}
                  onClick={() => navigate(`/teacher/chapters/${nextChapter.id}/slides`)}
                />
              </Tooltip>
            )}
          </Space>
        </div>
      </>
    );
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {data.chapterChanged && (
        <Alert
          type="warning"
          showIcon
          message="章节内容已变更"
          description="当前幻灯片是基于旧版章节内容生成的。可以重新生成，或保留现有内容（只把基准对齐到最新章节）。"
          action={
            <Space direction="vertical">
              <Button
                size="small"
                type="primary"
                icon={<ReloadOutlined />}
                loading={busy}
                onClick={() => handleGenerate(true)}
              >
                重新生成
              </Button>
              <Button
                size="small"
                icon={<SyncOutlined />}
                loading={busy}
                onClick={async () => {
                  await syncChapterSlidesHash(chapterId);
                  message.success('已保留现有幻灯片');
                  await load(true);
                }}
              >
                保留现有
              </Button>
            </Space>
          }
        />
      )}
      {deck?.status === 'generating' && (
        <Alert type="info" showIcon message="正在生成幻灯片…" description="生成通常需要十几秒，完成后会自动显示。" />
      )}
      {deck?.status === 'failed' && (
        <Alert
          type="error"
          showIcon
          message="生成失败"
          description={deck.error ?? '未知错误'}
          action={
            <Button size="small" onClick={() => handleGenerate(true)} loading={busy}>
              重试
            </Button>
          }
        />
      )}
      {deck?.warnings && deck.status === 'ready' && (
        <Alert type="warning" showIcon message="生成提示" description={deck.warnings} />
      )}

      <Card
        title={
          <Space>
            <span>章节幻灯片</span>
            {deck && (
              <Tag color={deck.status === 'ready' ? 'green' : deck.status === 'failed' ? 'red' : 'blue'}>
                {deck.status === 'ready' ? `${deck.slides.length} 页` : deck.status}
              </Tag>
            )}
            {deck?.generatedBy && <Tag>{deck.generatedBy === 'mock' ? '本地生成器' : deck.generatedBy === 'llm' ? '大模型' : '手工'}</Tag>}
            {data.generator.generator === 'mock' && (
              <Tooltip title="当前为 mock 生成器（不调用大模型、不消耗额度）。要接模型：后端设 SLIDES_GENERATOR=llm 并配置 key。">
                <Tag color="orange">mock 模式</Tag>
              </Tooltip>
            )}
          </Space>
        }
        extra={
          <Space wrap>
            <Select
              size="small"
              style={{ minWidth: 160 }}
              value={templateId ?? data.template.id}
              onChange={handleTemplateChange}
              options={data.templates.map((t) => ({
                label: t.isBuiltin ? `${t.name}` : `${t.name}（自定义）`,
                value: t.id,
              }))}
            />
            <Button size="small" icon={<EditOutlined />} onClick={() => setDesignOpen(true)}>
              模板调参
            </Button>
            <Tooltip title="上一章 / 下一章（保留放映态）">
              <Space.Compact>
                <Button
                  size="small"
                  disabled={!prevChapter}
                  onClick={() => navigate(`/teacher/chapters/${prevChapter?.id}/slides`)}
                >
                  ◀
                </Button>
                <Button
                  size="small"
                  disabled={!nextChapter}
                  onClick={() => navigate(`/teacher/chapters/${nextChapter?.id}/slides`)}
                >
                  ▶
                </Button>
              </Space.Compact>
            </Tooltip>
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              disabled={!deck?.slides?.length}
              onClick={() => {
                setGotoIndex(currentIndex);
                setPresenting(true);
              }}
            >
              放映
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={busy}
              onClick={() => handleGenerate(false)}
            >
              {deck ? '重新生成' : '生成幻灯片'}
            </Button>
            {deck && (
              <Popconfirm title="删除该章节的幻灯片？" onConfirm={handleDeleteDeck}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        }
      >
        {!deck ? (
          <Empty
            description={
              canEdit ? '还没有幻灯片，点右上角「生成幻灯片」开始' : '老师还没有为该章节准备幻灯片'
            }
          />
        ) : (
          <Row gutter={12}>
            <Col span={5}>
              <div style={{ maxHeight: 560, overflow: 'auto' }}>
                {deck.slides.map((slide, index) => (
                  <div
                    key={slide.id}
                    onClick={() => setGotoIndex(index)}
                    style={{
                      cursor: 'pointer',
                      padding: '6px 8px',
                      borderRadius: 6,
                      marginBottom: 4,
                      background: index === currentIndex ? 'rgba(22,119,255,0.12)' : 'transparent',
                      border:
                        index === currentIndex
                          ? '1px solid rgba(22,119,255,0.4)'
                          : '1px solid transparent',
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {index + 1}. [{LAYOUT_LABEL[slide.layout] ?? slide.layout}]{' '}
                    </Text>
                    <Text style={{ fontSize: 12 }} ellipsis>
                      {slide.title ?? '（无标题）'}
                    </Text>
                  </div>
                ))}
              </div>
            </Col>
            <Col span={8}>
              {canEdit && (
                <Space size={8} style={{ marginBottom: 8 }} wrap>
                  <Dropdown
                    menu={{
                      items: IMAGE_LAYOUT_OPTIONS.map((opt) => ({
                        key: opt.value,
                        label: opt.label,
                      })),
                      onClick: ({ key }) =>
                        setPicker({ kind: 'insert', layout: key as SlideLayout }),
                    }}
                  >
                    <Button size="small" icon={<FileImageOutlined />}>
                      插入图片页
                    </Button>
                  </Dropdown>
                  <Tooltip title="替换当前页的图片（当前编辑区文本生效；多图页请直接在文本里改）">
                    <Button
                      size="small"
                      disabled={!currentPageHasSingleImage}
                      onClick={() => setPicker({ kind: 'replace' })}
                    >
                      换图
                    </Button>
                  </Tooltip>
                </Space>
              )}
              <Tabs
                size="small"
                activeKey={mode}
                onChange={(key) => setMode(key as 'json' | 'markdown')}
                items={[
                  {
                    key: 'json',
                    label: 'JSON',
                    children: (
                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          结构化编辑：layout / bullets / code / quote / notes / attrs
                        </Text>
                        <Input.TextArea
                          value={jsonText}
                          onChange={(e) => {
                            setJsonText(e.target.value);
                            setEditing(true);
                          }}
                          autoSize={{ minRows: 16, maxRows: 24 }}
                          style={{ fontFamily: 'monospace', fontSize: 12 }}
                        />
                        {jsonError && <Alert type="error" showIcon message={jsonError} />}
                      </Space>
                    ),
                  },
                  {
                    key: 'markdown',
                    label: 'Markdown',
                    children: (
                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          日常写作：<Text code>&lt;!-- .slide: layout=bullets --&gt;</Text> 设页属性、
                          <Text code>---</Text> 分页、<Text code>&lt;!-- .notes: … --&gt;</Text> 讲者备注
                        </Text>
                        <Input.TextArea
                          value={mdText}
                          onChange={(e) => {
                            setMdText(e.target.value);
                            setEditing(true);
                          }}
                          autoSize={{ minRows: 16, maxRows: 24 }}
                          style={{ fontFamily: 'monospace', fontSize: 12 }}
                        />
                      </Space>
                    ),
                  },
                ]}
              />
              {canEdit && (
                <Space>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={busy}
                    disabled={!editing || !!jsonError}
                    onClick={handleSaveContent}
                  >
                    保存内容
                  </Button>
                  <Button
                    disabled={!editing}
                    onClick={() => {
                      setJsonText(JSON.stringify(deck.slides, null, 2));
                      setMdText(deck.markdown);
                      setEditing(false);
                    }}
                  >
                    放弃改动
                  </Button>
                </Space>
              )}
            </Col>
            <Col span={11}>{stage}</Col>
          </Row>
        )}
      </Card>

      <Card size="small">
        <Space split={<Divider type="vertical" />} wrap>
          <Link to={`/teacher/chapters/${chapterId}/edit`}>返回章节编辑</Link>
          <Text type="secondary">
            章节：{chapter.title}
          </Text>
          {deck?.tokensUsed ? (
            <Text type="secondary">上次生成消耗：{deck.tokensUsed} tokens</Text>
          ) : null}
          {deck?.model ? <Text type="secondary">模型：{deck.model}</Text> : null}
        </Space>
      </Card>

      <Drawer
        title={`模板调参${currentTemplate ? `：${currentTemplate.name}` : ''}`}
        width={420}
        open={designOpen}
        onClose={() => setDesignOpen(false)}
        extra={
          <Button type="primary" loading={busy} onClick={handleSaveDesign}>
            保存模板
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="只调参数，不写 CSS"
          description="模板值是受校验的参数（颜色/字体/页脚/圆角/疏密），由服务端编译成 CSS 后注入演示文档 —— 这样不会把任意 CSS 带进学生浏览器。"
        />
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text>主色</Text>
            <ColorPicker
              showText
              style={{ marginLeft: 8 }}
              value={design.primary ?? '#1677ff'}
              onChange={(color) => setDesign((d) => ({ ...d, primary: color.toHexString() }))}
            />
          </div>
          <div>
            <Text>背景色</Text>
            <ColorPicker
              showText
              style={{ marginLeft: 8 }}
              value={design.background ?? '#ffffff'}
              onChange={(color) => setDesign((d) => ({ ...d, background: color.toHexString() }))}
            />
          </div>
          <div>
            <Text>正文颜色</Text>
            <ColorPicker
              showText
              style={{ marginLeft: 8 }}
              value={design.text ?? '#1f2328'}
              onChange={(color) => setDesign((d) => ({ ...d, text: color.toHexString() }))}
            />
          </div>
          <div>
            <Text>强调色</Text>
            <ColorPicker
              showText
              style={{ marginLeft: 8 }}
              value={design.accent ?? '#0958d9'}
              onChange={(color) => setDesign((d) => ({ ...d, accent: color.toHexString() }))}
            />
          </div>
          <div>
            <Text>字体栈</Text>
            <Input
              style={{ marginTop: 4 }}
              placeholder="'PingFang SC', 'Microsoft YaHei', sans-serif"
              value={design.fontFamily ?? ''}
              onChange={(e) => setDesign((d) => ({ ...d, fontFamily: e.target.value }))}
            />
          </div>
          <div>
            <Text>页脚文案</Text>
            <Input
              style={{ marginTop: 4 }}
              placeholder="如：南京大学 · 人工智能基础"
              value={design.footerText ?? ''}
              onChange={(e) => setDesign((d) => ({ ...d, footerText: e.target.value }))}
            />
          </div>
          <div>
            <Text>圆角：{design.radius ?? 8}px</Text>
            <Slider
              min={0}
              max={48}
              value={design.radius ?? 8}
              onChange={(value) => setDesign((d) => ({ ...d, radius: value }))}
            />
          </div>
          <div>
            <Text>疏密</Text>
            <Segmented
              style={{ marginTop: 4 }}
              options={DENSITY_OPTIONS}
              value={design.density ?? 'cozy'}
              onChange={(value) =>
                setDesign((d) => ({ ...d, density: value as SlideTemplateDesign['density'] }))
              }
            />
          </div>
          <div>
            <Text>字号</Text>
            <Segmented
              style={{ marginTop: 4 }}
              options={FONT_SCALE_OPTIONS}
              value={design.fontScale ?? 'standard'}
              onChange={(value) =>
                setDesign((d) => ({ ...d, fontScale: value as SlideTemplateDesign['fontScale'] }))
              }
            />
          </div>
          <div>
            <Text>要点卡片</Text>
            <Segmented
              style={{ marginTop: 4 }}
              options={CARD_STYLE_OPTIONS}
              value={design.cardStyle ?? 'none'}
              onChange={(value) =>
                setDesign((d) => ({ ...d, cardStyle: value as SlideTemplateDesign['cardStyle'] }))
              }
            />
          </div>
          <Divider style={{ margin: '4px 0' }} />
          {currentTemplate && !currentTemplate.isBuiltin && (
            <Popconfirm
              title="删除该模板？引用它的章节会自动回落默认模板"
              onConfirm={handleDeleteTemplate}
            >
              <Button danger block icon={<DeleteOutlined />}>
                删除该模板
              </Button>
            </Popconfirm>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            内置模板不可直接修改：点「保存模板」会先另存为课程模板再套用。
          </Text>
        </Space>
      </Drawer>

      <ImagePickerDrawer
        open={!!picker}
        multiple={picker?.kind === 'insert' && picker.layout === 'image-grid'}
        title={picker?.kind === 'replace' ? '选择替换图片' : '选择图片'}
        onClose={() => setPicker(null)}
        onConfirm={handlePickerConfirm}
      />
    </Space>
  );
}
