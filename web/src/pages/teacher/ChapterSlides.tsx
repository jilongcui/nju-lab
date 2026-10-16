import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  ColorPicker,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  List,
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
  theme,
} from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  EditOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  PictureOutlined,
  DesktopOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  ReloadOutlined,
  SaveOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import {
  createSlideTemplate,
  deleteChapterSlides,
  deleteSlideTemplate,
  deleteSlideVersion,
  generateChapterSlides,
  getChapter,
  getChapterSlides,
  getSlideVersions,
  getCourse,
  saveChapterSlides,
  syncChapterSlidesHash,
  regenerateChapterSlidePage,
  restoreSlideVersion,
  updateChapterSlidePageField,
  updateChapterSlidePageNotes,
  updateSlideTemplate,
} from '../../api';
import type { DeckVersionItem } from '../../api';
import type {
  Chapter,
  ChapterSlidesResponse,
  DeckSlide,
  SemanticIntent,
  SemanticPage,
  SlideJson,
  SlideLayout,
  SlideTemplateDesign,
  StoredFileInfo,
} from '../../types';
import { SEMANTIC_INTENT_OPTIONS } from '../../types';
import SlideStage, { type SlideStageHandle } from '../../slides/SlideStage';
import { createPresentChannel, type PresentChannel } from '../../slides/presentChannel';
import { withBase } from '../../config';
import { conflictOf, showConflictDialog } from '../../utils/content-conflict';
import { collectFileRefs, fetchFileDataUrls } from '../../slides/files';
import {
  IMAGE_LAYOUT_OPTIONS,
  SINGLE_IMAGE_LAYOUTS,
  applyImageActionToMarkdown,
  applyImageActionToSlides,
  imageMarkdownSnippet,
  splitMarkdownPages,
} from '../../slides/imageActions';
import ImagePickerDrawer from '../../components/ImagePickerDrawer';
import ImageLibraryPanel from '../../components/ImageLibraryPanel';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Text, Paragraph } = Typography;

/** 缩略图列表里的版式标签：v2 显示 intent 的中文名，v1 显示旧版式名 */
function slideTag(slide: DeckSlide): string {
  if ('intent' in slide) {
    return SEMANTIC_INTENT_OPTIONS.find((option) => option.value === slide.intent)?.label ?? slide.intent;
  }
  return LAYOUT_LABEL[slide.layout] ?? slide.layout;
}

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
  const { modal } = App.useApp();
  const { token } = theme.useToken();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** 教师本次的额外要求（可选提示词）：重生成 / 重生成当前页时随请求下发 */
  const [instruction, setInstruction] = useState('');
  /** 历史版本：每次重生成/保存前自动存档，教师可回滚（多版并存，见 DESIGN 里的版本一节） */
  const [versions, setVersions] = useState<DeckVersionItem[]>([]);
  /** 当前页讲稿草稿（讲稿不进版面，单独编辑与保存） */
  const [notesDraft, setNotesDraft] = useState('');
  const [versionsLoading, setVersionsLoading] = useState(false);
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
  /** 讲者视图（双窗口）：当前窗口显示幻灯片 + 备注面板，另开一个「观众窗口」投屏 */
  const [presenter, setPresenter] = useState(false);
  /** 讲者视图计时（毫秒），进入时归零 */
  const [elapsedMs, setElapsedMs] = useState(0);
  /** 观众窗口是否还开着（开着才显示 ✓，关掉后可一键重开） */
  const [audienceOpened, setAudienceOpened] = useState(false);
  /** 讲稿浮层的开合与高度（文档内回传）：讲者视图据此把「下一页」预告让开它 */
  const [notesBox, setNotesBox] = useState({ open: false, height: 0 });
  const stageRef = useRef<SlideStageHandle>(null);
  const audienceWinRef = useRef<Window | null>(null);
  const channelRef = useRef<PresentChannel | null>(null);
  const timerStartRef = useRef<number>(0);
  // `?audience=1` = 这一份渲染是**投给观众看的那一个窗口**：只有幻灯片，没有工具栏、没有讲稿
  const [searchParams] = useSearchParams();
  const isAudience = searchParams.get('audience') === '1';
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, string>>({});
  /** 导出 PDF 时是否把每页讲稿作为"备注页"附在后面（讲者讲义/存档用） */
  const [exportWithNotes, setExportWithNotes] = useState(false);
  /** 当前放映文档的 HTML（SlideStage 构建完成时回填）—— 导出 PDF 用 */
  const deckHtmlRef = useRef<string | null>(null);

  // 图片选择器：insert = 在当前页之后插入图片页；replace = 替换当前页的单图；
  // insert-cursor = 把图片引用插到 MD 文本光标处（凑网格页/给并排页补图都用它）
  const [picker, setPicker] = useState<
    { kind: 'insert'; layout: SlideLayout } | { kind: 'replace' } | { kind: 'insert-cursor' } | null
  >(null);
  const mdAreaRef = useRef<TextAreaRef>(null);
  const [auxTab, setAuxTab] = useState<'chapters' | 'images' | 'notes' | 'generate' | 'versions'>('chapters');
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // 章节 tab/工具栏里「放弃修改并切换」与放映态的章节跳转要绕过路由守卫
  const allowLeaveRef = useRef(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        // 整页重载（进入页面/切换章节）：编辑脏标记与守卫旁路一并复位
        setEditing(false);
        allowLeaveRef.current = false;
      }
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
  // 这两个派生值放在这里：右侧「源码编辑」tab 要用它们，而面板注入必须早于下面的 early return
  const previewSlides: DeckSlide[] = deck?.slides ?? [];
  /** v2 语义 deck：Markdown 只读、编辑面收窄为「换主题 / 换版式 / 重生成当前页」 */
  const semanticDeck = !!deck?.semantic;
  const siblingIndex = siblings.findIndex((item) => item.id === chapterId);
  const prevChapter = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
  const nextChapter =
    siblingIndex >= 0 && siblingIndex < siblings.length - 1
      ? siblings[siblingIndex + 1]
      : null;

  /**
   * 撞上并发编辑（409）：明说「被谁改了」，由老师选择刷新。
   * 返回 true 表示已处理（调用方不要再抛），false 交给外层。
   */
  const handleConflict = async (error: unknown): Promise<boolean> => {
    const conflict = conflictOf(error);
    if (!conflict) return false;
    showConflictDialog(conflict, () => {
      void load(true);
    });
    return true;
  };

  /**
   * 生成/重生成。`mode`：
   *   · `optimize`（默认）= 沿用现有页面结构，只按要求重写内容 —— 改动可控、改进可累积；
   *   · `fresh` = 从章节正文重新规划所有页面（结构会变，适合确实要重排时用）。
   * 无 deck 时两者等价（没有"上一版"可沿用）。`instruction` 是教师本次的额外要求。
   */
  const handleGenerate = async (force = false, mode: 'fresh' | 'optimize' = 'optimize') => {
    setBusy(true);
    try {
      // 带上当前版本：期间别人保存/生成过就 409，避免互相覆盖 + 白烧 token
      const result = await generateChapterSlides(chapterId, {
        templateId: templateId ?? undefined,
        force,
        version: deck?.version,
        instruction: instruction.trim() || undefined,
        mode,
      });
      message.success(
        result.cached ? '内容未变，已复用现有幻灯片' : '已开始生成，稍候即可预览',
      );
      await load(true);
    } catch (error) {
      if (!(await handleConflict(error))) throw error;
    } finally {
      setBusy(false);
    }
  };

  /** 讲稿草稿跟随当前页（翻页、切换章节、保存后重载都要同步） */
  useEffect(() => {
    const page = deck?.slides?.[currentIndex] as { notes?: string } | undefined;
    setNotesDraft(String(page?.notes ?? ''));
  }, [deck, currentIndex]);

  /** 保存当前页讲稿（走专用接口：只改 notes，不触发版式校验） */
  const handleSaveNotes = async () => {
    setBusy(true);
    try {
      await updateChapterSlidePageNotes(chapterId, currentIndex, notesDraft, deck?.version);
      message.success(`第 ${currentIndex + 1} 页讲稿已保存`);
      await load(true);
    } catch (error) {
      if (!(await handleConflict(error))) throw error;
    } finally {
      setBusy(false);
    }
  };

  /** 预览里双击改完文字 → 保存该字段（服务端白名单只放纯文本字段） */
  const handleEditText = useCallback(
    async (path: string, value: string) => {
      try {
        await updateChapterSlidePageField(chapterId, currentIndex, path, value, deck?.version);
        message.success('已保存', 1);
        await load(true);
      } catch (error) {
        if (!(await handleConflict(error))) throw error;
      }
    },
    // load/handleConflict 是稳定引用（useCallback 定义在组件内），此处只依赖真正变化的值
    [chapterId, currentIndex, deck?.version, load, handleConflict],
  );

  /** 拉历史版本（切到「版本」tab 或回滚/删除后刷新） */
  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const res = await getSlideVersions(chapterId);
      setVersions(res.versions ?? []);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, [chapterId]);

  /** 回滚到历史版本：service 会先把**当前内容**也存一版，所以来回都能换 */
  const handleRestoreVersion = async (versionId: string) => {
    setBusy(true);
    try {
      await restoreSlideVersion(chapterId, versionId, deck?.version);
      message.success('已回滚到该历史版本（当前内容已自动存为一版，可再换回）');
      await load(true);
      await loadVersions();
    } catch (error) {
      if (!(await handleConflict(error))) throw error;
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteVersion = async (versionId: string) => {
    try {
      await deleteSlideVersion(chapterId, versionId);
      message.success('已删除该历史版本');
      await loadVersions();
    } catch (error) {
      if (!(await handleConflict(error))) throw error;
    }
  };

  /** 单页重生成：只让 LLM 重写当前页（其余页与手工编辑都不动），同步等待一次调用 */
  const handleRegeneratePage = async () => {
    setBusy(true);
    try {
      const result = await regenerateChapterSlidePage(
        chapterId,
        currentIndex,
        instruction.trim() || undefined,
      );
      message.success(`第 ${currentIndex + 1} 页已重新生成`);
      if (result.warnings?.length) {
        message.warning(result.warnings.join('；'));
      }
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
      if (picker.kind === 'insert-cursor') {
        // MD 视图专用：图片引用直接插到文本光标处（取不到光标就追加到末尾）
        const area = mdAreaRef.current?.resizableTextArea?.textArea;
        const pos = area?.selectionStart ?? mdText.length;
        setMdText(mdText.slice(0, pos) + imageMarkdownSnippet(images) + mdText.slice(pos));
      } else if (mode === 'json') {
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

  const handleSaveContent = async (): Promise<boolean> => {
    // v2 语义 deck 的 Markdown 只是只读预览（服务端也会拦，这里先给出人话提示）
    if (semanticDeck && mode === 'markdown') {
      message.info('新版幻灯片不支持编辑 Markdown：改内容请用「重生成当前页」，改观感用「换主题」，换版式用 JSON 视图的版式下拉');
      return false;
    }
    if (jsonError) {
      message.error(`JSON 有问题：${jsonError}`);
      return false;
    }
    setBusy(true);
    try {
      const payload =
        mode === 'json'
          ? { slides: JSON.parse(jsonText) as SlideJson[] }
          : { markdown: mdText };
      const result = await saveChapterSlides(chapterId, {
        ...payload,
        templateId,
        version: deck?.version,
      });
      if (result.warnings?.length) message.warning(result.warnings.join('；'));
      message.success('已保存');
      setEditing(false);
      await load(true);
      return true;
    } catch (error) {
      if (!(await handleConflict(error))) throw error;
      return false;
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
    try {
      await saveChapterSlides(chapterId, {
        templateId: value,
        version: deck?.version,
      });
      message.success('已切换模板');
      await load(true);
    } catch (error) {
      if (!(await handleConflict(error))) throw error;
    }
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

  /** 切章节（右栏列表 / 工具栏 ◀▶）：编辑区有未保存内容时给 保存并切换 / 放弃修改并切换 / 取消 */
  const switchChapter = (target: Chapter) => {
    if (target.id === chapterId) return;
    const go = () => navigate(`/teacher/chapters/${target.id}/slides`);
    if (!editingRef.current) {
      go();
      return;
    }
    let inst: ReturnType<typeof modal.confirm> | undefined;
    inst = modal.confirm({
      title: '当前幻灯片有未保存的修改',
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
                const saved = await handleSaveContent();
                if (!saved) return; // JSON 有误：留在当前章节
              } catch {
                return; // 保存失败：留在当前章节
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

  /** 右栏「图片」tab：选图后在当前页后插入图片页（1 张 → 图片版式，2–4 张 → 多图网格） */
  const handleAuxInsertImages = (images: StoredFileInfo[]) => {
    if (!images.length) return;
    if (!deck) {
      message.info('请先生成幻灯片，再插入图片页');
      return;
    }
    try {
      const layout: SlideLayout = images.length > 1 ? 'image-grid' : 'image';
      if (mode === 'json') {
        const slides = JSON.parse(jsonText) as SlideJson[];
        setJsonText(
          JSON.stringify(
            applyImageActionToSlides(slides, { kind: 'insert', layout, afterIndex: currentIndex }, images),
            null,
            2,
          ),
        );
      } else {
        setMdText(applyImageActionToMarkdown(mdText, { kind: 'insert', layout, afterIndex: currentIndex }, images));
      }
      setEditing(true);
      message.success('已在当前页后插入图片页，点「保存内容」后生效');
    } catch (error) {
      message.error(`应用失败：${(error as Error).message}`);
    }
  };

  // 右栏辅助区：Tabs —— 章节（兄弟章节切换，带未保存检查）/ 实验（**当前章**的实验）/ 生成 / 图片

  // 路由离开守卫：编辑区有未保存内容时拦截（菜单、面包屑、返回章节编辑、浏览器后退）。
  // 章节 tab/工具栏的切换不走这里（allowLeaveRef 已单独确认过）。
  const blocker = useBlocker(() => editingRef.current && !allowLeaveRef.current);
  const guardOpenRef = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      guardOpenRef.current = false;
      return;
    }
    if (guardOpenRef.current) return;
    guardOpenRef.current = true;
    modal.confirm({
      title: '当前幻灯片有未保存的修改',
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

  /**
   * 导出 PDF：把当前这份**自包含文档**放进新窗口并唤起打印，由浏览器「另存为 PDF」。
   * 零服务端依赖（不需要 Chromium），分页由文档内的 @media print 负责（每页一画布）。
   */
  const exportPdf = (withNotesPages = false) => {
    const doc = deckHtmlRef.current;
    if (!doc) {
      message.warning('幻灯片还没准备好，请稍候再试');
      return;
    }
    // 讲稿页（.notes-page）默认 display:none；要"附讲稿"时加 .with-notes-pages 让打印时显示。
    // ⚠️ 不能用固定串 '<div class="deck" id="deck">' 匹配 —— 编辑态的实际 class 是
    // 'deck is-editable'，固定串永远匹配不上，会静默丢掉备注页（实测踩过：PDF 仍是 18 页）。
    let printable = doc.replace(' is-editable', '');
    if (withNotesPages) {
      // ⚠️ 必须锚定 `id="deck"`：文档前面的 <style> 里（vendored base.css 的注释与选择器）也含
      // `class="deck` 字样，用 `replace('class="deck', …)` 会改到注释里那个，body 里的 .deck 纹丝不动
      // —— 表现为「附讲稿」静默失效（实测踩过，PDF 仍是 18 页）。
      printable = printable.replace(/<div class="deck[^"]*" id="deck">/, (tag) =>
        tag.replace('class="deck', 'class="deck with-notes-pages'),
      );
    }
    printable = printable.replace(
      '</body>',
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},500)})</' + 'script></body>',
    );
    const url = URL.createObjectURL(new Blob([printable], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    if (!win) {
      message.warning('浏览器拦截了新窗口：请允许弹出窗口后重试');
      return;
    }
    message.info(
      withNotesPages
        ? '已打开打印视图（含讲稿备注页）：把「目标」选成「另存为 PDF」，纸张横向、边距选「无」'
        : '已打开打印视图：打印对话框里把「目标」选成「另存为 PDF」，纸张横向、边距选「无」',
      4,
    );
  };

  useAuxiliaryPanel(
    '章节幻灯片',
    <Tabs
      activeKey={auxTab}
      onChange={(k) => {
        setAuxTab(k as 'chapters' | 'images' | 'notes' | 'generate' | 'versions');
        if (k === 'versions') void loadVersions();
      }}
      items={[
        {
          key: 'chapters',
          label: '章节',
          children: (
            <>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                点选切换章节（留在幻灯片页）；切换前会检查是否有未保存的内容修改。
              </Paragraph>
              <List
                size="small"
                dataSource={siblings}
                renderItem={(item, index) => {
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
                        {index + 1}. {item.title}
                      </Text>
                      {current && <Tag color="processing">当前</Tag>}
                    </List.Item>
                  );
                }}
              />
              <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                放映时：<Text code>←/→</Text> 翻页、<Text code>空格</Text> 下一页、<Text code>O</Text> 总览、<Text code>S</Text> 讲稿、
                <Text code>Esc</Text> 退出。章节正文改动后只会提示，不会自动重新生成。
              </Paragraph>
            </>
          ),
        },
        {
          key: 'images',
          label: '图片',
          children: (
            <>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                选图后在当前页后插入图片页；「换图」「插图到光标」「插入图片页（选版式）」用编辑区上方按钮。
              </Paragraph>
              <ImageLibraryPanel
                active={auxTab === 'images'}
                compact
                multiple
                confirmText="在当前页后插入"
                onConfirm={handleAuxInsertImages}
              />
            </>
          ),
        },
        {
          key: 'notes',
          label: '讲稿',
          children: (
            <>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                讲稿只给讲者看，<b>不会出现在幻灯片版面</b>上（放映时按 <Text code>S</Text> 可呼出浮层）。
                下面是第 {currentIndex + 1} 页。
              </Paragraph>
              <Input.TextArea
                rows={7}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="这一页你要怎么讲？写下来，放映时能对着念。"
                style={{ marginBottom: 10 }}
              />
              <Space style={{ marginBottom: 12 }}>
                <Button
                  size="small"
                  type="primary"
                  loading={busy}
                  disabled={!deck || deck.status === 'generating'}
                  onClick={handleSaveNotes}
                >
                  保存第 {currentIndex + 1} 页讲稿
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    setNotesDraft(
                      String(
                        (deck?.slides?.[currentIndex] as { notes?: string } | undefined)?.notes ?? '',
                      ),
                    )
                  }
                >
                  还原
                </Button>
              </Space>
              <Divider style={{ margin: '4px 0 12px' }} />
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                全部讲稿（点一行跳到那一页）：
              </Paragraph>
              <List
                size="small"
                dataSource={deck?.slides ?? []}
                renderItem={(p, i) => {
                  const n = String((p as { notes?: string }).notes ?? '');
                  return (
                    <List.Item
                      onClick={() => setCurrentIndex(i)}
                      style={{
                        cursor: 'pointer',
                        paddingLeft: 0,
                        paddingRight: 0,
                        background: i === currentIndex ? token.colorPrimaryBg : undefined,
                      }}
                    >
                      <Text
                        style={{ fontSize: 12 }}
                        ellipsis={{ tooltip: n || '（本页无讲稿）' }}
                      >
                        {i + 1}. {n ? n.slice(0, 24) : '（本页无讲稿）'}
                      </Text>
                    </List.Item>
                  );
                }}
              />
            </>
          ),
        },
        {
          key: 'source',
          label: '源码',
          children: (
            <>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                JSON / Markdown 源码编辑 —— <b>高级改动</b>用。常规调整请用「生成」「讲稿」与模板调参。
              </Paragraph>
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
                    {mode === 'markdown' && (
                      <Tooltip title="把图片引用插到 MD 文本光标处（给并排页补图、凑多图网格都用它）">
                        <Button
                          size="small"
                          icon={<PictureOutlined />}
                          onClick={() => setPicker({ kind: 'insert-cursor' })}
                        >
                          插图到光标
                        </Button>
                      </Tooltip>
                    )}
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
                            {semanticDeck
                              ? '结构化编辑（v2）：intent / blocks / notes —— 换版式改 intent，内容块不用动'
                              : '结构化编辑：layout / bullets / code / quote / notes / attrs'}
                          </Text>
                          {semanticDeck && (
                            <Space size={8}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                本页版式
                              </Text>
                              <Select
                                size="small"
                                style={{ width: 156 }}
                                value={
                                  'intent' in (previewSlides[currentIndex] ?? {})
                                    ? (previewSlides[currentIndex] as SemanticPage).intent
                                    : undefined
                                }
                                options={SEMANTIC_INTENT_OPTIONS}
                                onChange={(value) => applyIntent(value as SemanticIntent)}
                              />
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                改完点「保存内容」
                              </Text>
                            </Space>
                          )}
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
                            {semanticDeck
                              ? '只读预览：新版 deck（语义模型）由「意图 + 内容块」构成，改内容请用「重生成当前页」'
                              : '日常写作：'}
                            {!semanticDeck && (
                              <>
                                <Text code>&lt;!-- .slide: layout=bullets --&gt;</Text> 设页属性、
                                <Text code>---</Text> 分页、<Text code>&lt;!-- .notes: … --&gt;</Text> 讲者备注
                              </>
                            )}
                          </Text>
                          <Input.TextArea
                            ref={mdAreaRef}
                            value={mdText}
                            readOnly={semanticDeck}
                            onChange={(e) => {
                              setMdText(e.target.value);
                              setEditing(true);
                            }}
                            autoSize={{ minRows: 16, maxRows: 24 }}
                            style={{ fontFamily: 'monospace', fontSize: 12, background: semanticDeck ? undefined : undefined }}
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
                        setJsonText(JSON.stringify(deck?.slides ?? [], null, 2));
                        setMdText(deck?.markdown ?? '');
                        setEditing(false);
                      }}
                    >
                      放弃改动
                    </Button>
                  </Space>
                )}
            </>
          ),
        },
        {
          key: 'generate',
          label: '生成',
          children: (
            <>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                工具栏的「重新生成」默认是<b>优化</b>：沿用现有页面结构与内容，只按下面的提示词改进
                （改动小、可累积）。需要重排页面组织时才用最下面的「彻底重做」。
              </Paragraph>
              <Input.TextArea
                rows={4}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={'可选提示词，例如：\n· 第 3 页改成左右对比\n· 多用图表，少用要点列表\n· 讲稿再口语化一点'}
                style={{ marginBottom: 10 }}
              />
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Button
                  block
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={busy}
                  disabled={deck?.status === 'generating'}
                  onClick={() => handleGenerate(true, 'optimize')}
                >
                  {deck ? '重新生成（优化）' : '生成幻灯片'}
                </Button>
                {deck && (
                  <Popconfirm
                    title="从章节正文重新规划所有页面？"
                    description="会重新设计页面顺序与版式，改动比优化大得多；当前内容与手工修改会被替换。"
                    onConfirm={() => handleGenerate(true, 'fresh')}
                  >
                    <Button block danger loading={busy} disabled={deck?.status === 'generating'}>
                      彻底重做（重新规划）
                    </Button>
                  </Popconfirm>
                )}
                <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                  只想改某一页：用工具栏的「重生成当前页」，它同样会带上这里的提示词。
                </Paragraph>
              </Space>
            </>
          ),
        },
        {
          key: 'versions',
          label: '版本',
          children: (
            <>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                每次重新生成或保存前，平台会自动把<b>上一版</b>存进这里（保留最近 20 版）。
                回滚时当前内容也会先存一版 —— 来回都能换，不用怕选错。
              </Paragraph>
              <List
                size="small"
                loading={versionsLoading}
                locale={{ emptyText: '还没有历史版本（下次重新生成或保存时会自动存档）' }}
                dataSource={versions}
                renderItem={(v) => (
                  <List.Item
                    style={{ paddingLeft: 0, paddingRight: 0 }}
                    actions={[
                      <Popconfirm
                        key="restore"
                        title="回滚到这一版？"
                        description="当前内容会先被存成一版，可再换回。"
                        onConfirm={() => handleRestoreVersion(v.id)}
                      >
                        <Button size="small" type="link" disabled={busy}>
                          回滚
                        </Button>
                      </Popconfirm>,
                      <Popconfirm
                        key="delete"
                        title="删除这个历史版本？"
                        description="只删这条历史记录，当前内容不受影响。"
                        onConfirm={() => handleDeleteVersion(v.id)}
                      >
                        <Button size="small" type="link" danger>
                          删
                        </Button>
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Text style={{ fontSize: 13 }}>
                          {v.label || '历史版本'}
                        </Text>
                      }
                      description={
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {v.pages} 页 · {v.reason} ·{' '}
                          {new Date(v.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </Text>
                      }
                    />
                  </List.Item>
                )}
              />
            </>
          ),
        },
      ]}
    />,
  );

  // ---------------- 讲者视图（双窗口）与观众窗口 ----------------
  //
  // 场景：教师在自己屏幕上开「讲者视图」（幻灯片 + 备注 + 计时），另开一个「观众窗口」投到投影屏。
  // 两个窗口是同源的独立页面，用 BroadcastChannel 同步页码（见 slides/presentChannel.ts）。
  // ⚠️ 本站是 HTTP（无 443），`getScreenDetails()` 这类"自动把窗口投到第二屏"的 API 不可用，
  //    所以观众窗口要**手动拖到投影屏 + F11**；拖一次浏览器会记住位置。
  /** 当前页（ref 版）：频道回调里要读最新值，又不能把 currentIndex 放进依赖数组反复重建频道 */
  const currentIndexRef = useRef(0);
  const totalPages = previewSlides.length;

  const titleOf = (i: number) =>
    (previewSlides[i] as { title?: string } | undefined)?.title ?? '';
  /** 计时显示（mm:ss） */
  const formatElapsed = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  /** 打开（或重新打开）观众窗口 —— 投屏用它，里面**只有幻灯片**，一个字的备注都没有 */
  const openAudienceWindow = useCallback(() => {
    const url = `${withBase(`teacher/chapters/${chapterId}/slides`)}?audience=1`;
    const win = window.open(url, `nju-lab-audience-${chapterId}`, 'width=1280,height=720');
    audienceWinRef.current = win;
    setAudienceOpened(!!win && !win.closed);
    if (!win) message.warning('观众窗口被浏览器拦截了：请允许本站弹窗后重试');
  }, [chapterId]);

  /** 关掉观众窗口（顶栏那个按钮是**开关**：开着时点它就是关） */
  const closeAudienceWindow = useCallback(() => {
    try {
      audienceWinRef.current?.close();
    } catch {
      /* 被浏览器拦住就算了 */
    }
    audienceWinRef.current = null;
    setAudienceOpened(false);
  }, []);

  /** 退出讲者视图：顺手关掉观众窗口，免得投影屏停在最后一页 */
  const exitPresenter = useCallback(() => {
    setPresenter(false);
    try {
      audienceWinRef.current?.close();
    } catch {
      /* 被浏览器拦住就算了，用户手动关也行 */
    }
    audienceWinRef.current = null;
    setAudienceOpened(false);
  }, []);

  /** 翻页：更新本地状态 + 广播给观众窗口 */
  const handleIndexChange = useCallback(
    (index: number) => {
      currentIndexRef.current = index;
      setCurrentIndex(index);
      channelRef.current?.send({ kind: 'index', index, total: totalPages });
    },
    [totalPages],
  );

  // 讲者窗口：建频道；观众窗口刚打开时会发 hello，把当前页补给它
  useEffect(() => {
    if (!presenter || isAudience) return;
    const channel = createPresentChannel(chapterId);
    channelRef.current = channel;
    const off = channel.onMessage((msg) => {
      if (msg.kind === 'hello') {
        channel.send({ kind: 'index', index: currentIndexRef.current, total: totalPages });
      }
    });
    return () => {
      off();
      channel.close();
      channelRef.current = null;
    };
  }, [presenter, isAudience, chapterId, totalPages]);

  // 讲者窗口：计时（进入讲者视图归零）
  useEffect(() => {
    if (!presenter) return;
    timerStartRef.current = Date.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => setElapsedMs(Date.now() - timerStartRef.current), 500);
    return () => window.clearInterval(timer);
  }, [presenter]);

  // 讲者窗口：盯着观众窗口是否被手动关掉（关了就在面板上提示"重新打开"）
  useEffect(() => {
    if (!presenter) return;
    const timer = window.setInterval(() => {
      const win = audienceWinRef.current;
      setAudienceOpened(!!win && !win.closed);
    }, 800);
    return () => window.clearInterval(timer);
  }, [presenter]);

  // 观众窗口：纯跟随 —— 收到讲者的页码就跳过去，自己不做任何判定
  useEffect(() => {
    if (!isAudience) return;
    const channel = createPresentChannel(chapterId);
    const off = channel.onMessage((msg) => {
      if (msg.kind === 'index') stageRef.current?.goto(msg.index);
    });
    // deck 构建要几百毫秒，就绪前发出的 goto 会被丢弃 —— 所以 hello 重发几次兜住
    const timers = [0, 1000, 2500].map((delay) =>
      window.setTimeout(() => channel.send({ kind: 'hello' }), delay),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      off();
      channel.close();
    };
  }, [isAudience, chapterId]);

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (!data || !chapter) return <Empty description="章节不存在" />;


  /** 「换版式」：只改当前页的 intent（内容块不动），保存后由渲染层换一套版式 */
  const applyIntent = (intent: SemanticIntent) => {
    try {
      const slides = JSON.parse(jsonText) as DeckSlide[];
      const page = slides[currentIndex];
      if (!page || !('intent' in page)) {
        message.info('这一页不是新版语义页，无法换版式');
        return;
      }
      (page as SemanticPage).intent = intent;
      setJsonText(JSON.stringify(slides, null, 2));
      setEditing(true);
      message.info('已切换本页版式，点「保存内容」生效（不花 token）');
    } catch {
      message.error('JSON 解析失败，请先修正 JSON 再换版式');
    }
  };
  /**
   * 幻灯片舞台。同一份 props 供三种场景复用：
   *   · 编辑预览（默认）；
   *   · 讲者视图（`presenter`）：左栏显示幻灯片，右栏是备注面板，键盘由父窗口接管；
   *   · 观众窗口（`opts.audience`）：投屏出去的那一个 —— **只渲染幻灯片，连控件都不渲染**。
   */
  const renderStage = (opts: { audience?: boolean } = {}) => (
    <SlideStage
      ref={stageRef}
      onDocument={(doc) => {
        deckHtmlRef.current = doc;
      }}
      slides={previewSlides}
      template={{
        baseTheme: currentTemplate?.baseTheme ?? 'simple',
        css: currentTemplate?.css ?? '',
      }}
      slideTheme={{ id: currentTemplate?.id, design: currentTemplate?.design }}
      meta={{ chapter: chapter.title }}
      config={deck?.config}
      footerText={currentTemplate?.design?.footerText ?? null}
      logoDataUrl={
        currentTemplate?.design?.logoFileId
          ? imageDataUrls[`file:${currentTemplate.design.logoFileId}`] ?? null
          : null
      }
      imageDataUrls={imageDataUrls}
      gotoIndex={gotoIndex}
      onIndexChange={handleIndexChange}
      presenting={opts.audience ? true : presenting && !presenter}
      showControls={!opts.audience}
      onExitPresenting={() => (presenter ? exitPresenter() : setPresenting(false))}
      // 讲者视图与放映态都由父窗口接管键盘（含 Esc 退出）；观众窗口什么都不接管
      keyboard={!opts.audience && (presenting || presenter)}
      // 预览态允许双击就地编辑（放映态、讲者视图、观众窗口、学生端都不开）
      editable={canEdit && !presenting && !presenter && !opts.audience}
      onEditText={handleEditText}
      onNotesChange={setNotesBox}
      height={opts.audience || presenter ? '100%' : 520}
    />
  );

  // ⚠️ 放在这里而不是 renderStage 定义之后：renderStage 内部用到了 handleIndexChange /
  // exitPresenter（都是 const），在它们初始化之前调用会撞 TDZ（"Cannot access before initialization"）
  const stage = renderStage();

  // 观众窗口：只有幻灯片（`renderStage({ audience: true })` 已把控件与 Esc 关掉）
  if (isAudience) return renderStage({ audience: true });

  // 讲者视图：幻灯片铺满，**不改动幻灯片本身的观感** ——
  //   · 讲稿照旧按 `S` 呼出（deck 自带的底部浮层，在讲者窗口里点得到、观众窗口里拿不到讲稿）；
  //   · 顶部只留「计时 + 观众窗口开关 + 退出」（浮在幻灯片上下黑边上，不压内容）；
  //   · 右下角一行「下一页：…」预告。
  // 为什么不做右栏面板：试过一版（页码/讲稿/翻页按钮一排），讲者真正的用法是"幻灯片尽量大 + 按 S 看讲稿"，
  // 右栏反而把幻灯片挤窄了（2026-10-17 用户反馈：做复杂了）。
  if (presenter) {
    const nextTitle = titleOf(currentIndex + 1);
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 1200, background: '#000', display: 'flex' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>{renderStage()}</div>

        {/* 顶部（幻灯片上下的黑边上）：左侧「下一页」预告 + 右侧「计时 / 观众窗口 / 退出」。
             半透明、hover 变亮。
             ⚠️ 预告为什么放这里而不是右下角：按 `S` 呼出的讲稿浮层是个**覆盖层**
             （`max-height:42vh`、铺满底部整行），放底部会被它压住 —— 而父窗口的元素要么压在
             浮层之上（字叠字，很乱）要么沉到 iframe 之下（直接看不见），没有中间态。 */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 0,
            display: 'flex',
            padding: '0 20px',
            opacity: 0.55,
            transition: 'opacity .2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.55')}
        >
          <Space size={10}>
            <Button
              size="small"
              onClick={() => {
                timerStartRef.current = Date.now();
                setElapsedMs(0);
              }}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              ⏱ {formatElapsed(elapsedMs)}
            </Button>
            <Tooltip
              title={
                audienceOpened
                  ? '点击关闭观众窗口'
                  : '打开观众窗口（拖到投影屏后按 F11 全屏）'
              }
            >
              <Button
                size="small"
                type={audienceOpened ? 'primary' : 'default'}
                onClick={audienceOpened ? closeAudienceWindow : openAudienceWindow}
              >
                {audienceOpened ? '观众窗口 ✓' : '打开观众窗口'}
              </Button>
            </Tooltip>
            <Button size="small" onClick={exitPresenter}>
              退出（Esc）
            </Button>
          </Space>
        </div>

        {/* 「下一页」预告：贴底，但**让开讲稿浮层** —— 浮层一打开就占住底部整行，
             压在它上面的父窗口元素会字叠字（高度由文档内回传，讲稿短的页浮层也矮）。 */}
        <div
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: notesBox.open ? notesBox.height + 12 : 12,
            display: 'flex',
            // 右下角（用户 2026-10-17 明确要求；左对齐那版是临时的）
            justifyContent: 'flex-end',
            pointerEvents: 'none',
            transition: 'bottom .3s var(--ease)',
          }}
        >
          <div
            style={{
              // 深色胶囊：预告压在幻灯片内容上（讲者视图里 iframe 底不是黑的），
              // 纯白字在浅色版面上会直接看不见（2026-10-17 截图发现）
              background: 'rgba(0,0,0,.45)',
              color: '#fff',
              fontSize: 13,
              padding: '3px 12px',
              borderRadius: 999,
              maxWidth: '70%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentIndex + 1 < totalPages
              ? `下一页：${nextTitle || '（无标题）'}`
              : '— 已是最后一页 —'}
          </div>
        </div>
      </div>
    );
  }


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
                  onClick={() => {
                    // 放映态不弹确认层（会被放映层盖住）：沿用直接切换，守卫走旁路
                    allowLeaveRef.current = true;
                    navigate(`/teacher/chapters/${prevChapter.id}/slides`);
                  }}
                />
              </Tooltip>
            )}
            {nextChapter && (
              <Tooltip title={`下一章：${nextChapter.title}`}>
                <Button
                  size="small"
                  icon={<ArrowRightOutlined />}
                  onClick={() => {
                    allowLeaveRef.current = true;
                    navigate(`/teacher/chapters/${nextChapter.id}/slides`);
                  }}
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
            <Tooltip title="上一章 / 下一章（未保存时会先询问）">
              <Space.Compact>
                <Button
                  size="small"
                  disabled={!prevChapter}
                  onClick={() => prevChapter && switchChapter(prevChapter)}
                >
                  ◀
                </Button>
                <Button
                  size="small"
                  disabled={!nextChapter}
                  onClick={() => nextChapter && switchChapter(nextChapter)}
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
            <Tooltip title="双窗口讲者视图：本窗口显示幻灯片 + 讲稿 + 计时，另开一个「观众窗口」投屏（那里只有幻灯片，不含讲稿；拖到投影屏后按 F11）">
              <Button
                size="small"
                icon={<DesktopOutlined />}
                disabled={!deck?.slides?.length}
                onClick={() => {
                  setGotoIndex(currentIndex);
                  // 必须在用户手势里先开窗口，否则会被浏览器当弹窗拦掉
                  openAudienceWindow();
                  setPresenter(true);
                }}
              >
                讲者视图
              </Button>
            </Tooltip>
            {canEdit && (
              <>
                <Checkbox
                  checked={exportWithNotes}
                  onChange={(e) => setExportWithNotes(e.target.checked)}
                >
                  附讲稿
                </Checkbox>
                <Tooltip title="在新窗口打开打印视图，用浏览器「另存为 PDF」（纸张横向、边距选无）；勾选「附讲稿」会把每页讲稿排在该页后面">
                  <Button
                    size="small"
                    icon={<FilePdfOutlined />}
                    disabled={!deck?.slides?.length}
                    onClick={() => exportPdf(exportWithNotes)}
                  >
                    导出 PDF
                  </Button>
                </Tooltip>
              </>
            )}
            {deck?.status === 'ready' && canEdit && (
              <Popconfirm
                title={`用 LLM 重写第 ${currentIndex + 1} 页？`}
                description="只重新生成当前页（消耗一次生成额度），其余页不动；会在上方提示词（若填了）的要求下改写该页。"
                onConfirm={handleRegeneratePage}
              >
                <Button size="small" icon={<RedoOutlined />} loading={busy}>
                  重生成当前页
                </Button>
              </Popconfirm>
            )}
            <Tooltip title="默认按右栏「生成」里的提示词做优化重生成：沿用现有页面结构，只改进内容；没生成过时等价于首次生成">
              <Button
                size="small"
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={busy}
                disabled={deck?.status === 'generating'}
                onClick={() => handleGenerate(true, 'optimize')}
              >
                {deck ? '重新生成' : '生成幻灯片'}
              </Button>
            </Tooltip>
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
                      {index + 1}. [{slideTag(slide)}]{' '}
                    </Text>
                    <Text style={{ fontSize: 12 }} ellipsis>
                      {slide.title ?? '（无标题）'}
                    </Text>
                  </div>
                ))}
              </div>
            </Col>
            <Col span={19}>{stage}</Col>
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
        multiple={
          picker?.kind === 'insert-cursor' ||
          (picker?.kind === 'insert' && picker.layout === 'image-grid')
        }
        title={
          picker?.kind === 'replace'
            ? '选择替换图片'
            : picker?.kind === 'insert-cursor'
              ? '插图到光标处（可多选）'
              : '选择图片'
        }
        onClose={() => setPicker(null)}
        onConfirm={handlePickerConfirm}
      />
    </Space>
  );
}
