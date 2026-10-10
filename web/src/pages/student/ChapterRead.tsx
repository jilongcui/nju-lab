import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  List,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  LeftOutlined,
  PlayCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { completeChapter, getChapter, getChapterSlides, getCourse } from '../../api';
import type { Chapter, ChapterSlidesResponse } from '../../types';
import StatusTag from '../../components/StatusTag';
import MarkdownView from '../../components/MarkdownView';
import SlideStage, { type SlideStageHandle } from '../../slides/SlideStage';
import { collectFileRefs, fetchFileDataUrls } from '../../slides/files';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

/**
 * 学生端章节页：**文档 ⇄ 幻灯片** 视图切换（设计文档 §10）。
 *
 * 只读：学生看不到模板清单，也不能改内容/模板（后端对学生返回 `templates: []`、写接口 403）。
 * 老师还没做幻灯片时不显示切换入口，也不打扰学生。
 *
 * 2026-10-10 学员反馈的三处修复：
 *   ① 幻灯片上方那条提示会把演示画面往下挤 —— 移到**演示下方**；
 *   ② 右侧附栏原先只有一段说明，没有课程章节目录 —— 补上（与教师端一致的"当前章"标记）；
 *   ③ 点「幻灯片」后焦点留在 antd Segmented 上，按 ←/→ 被它当成"切换选项"→ 跳回「文档」。
 *      现在切换后把焦点交给幻灯片文档（方向键直接翻页），并在幻灯片视图下拦掉 Segmented 的左右键。
 *   另外补上「放映」（全屏）与「总览」，与教师端一致。
 */
export default function ChapterRead() {
  const { chapterId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [siblings, setSiblings] = useState<Chapter[]>([]);
  const [slidesData, setSlidesData] = useState<ChapterSlidesResponse | null>(null);
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const [view, setView] = useState<'doc' | 'slides'>('doc');
  const [presenting, setPresenting] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completing, setCompleting] = useState(false);
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, string>>({});
  const stageRef = useRef<SlideStageHandle>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChapter(await getChapter(chapterId));
      // 幻灯片是"锦上添花"：取不到（没生成/无权限）不影响正文阅读
      try {
        setSlidesData(await getChapterSlides(chapterId));
        setSlidesError(null);
      } catch (error) {
        setSlidesData(null);
        setSlidesError((error as Error).message || '幻灯片加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 换章节（右栏目录点进来）时回到文档视图、页码归零 —— 新章节通常没有课件
  useEffect(() => {
    setView('doc');
    setPresenting(false);
    setCurrentIndex(0);
  }, [chapterId]);

  // 右侧附栏的章节目录：与「我的课程 → 课程详情」同一口径（courseId → 全部章节，按 order 排）
  useEffect(() => {
    const courseId = chapter?.courseId;
    if (!courseId) return;
    let cancelled = false;
    void getCourse(courseId)
      .then((course) => {
        if (!cancelled) setSiblings([...(course.chapters ?? [])].sort((a, b) => a.order - b.order));
      })
      .catch(() => {
        // 目录取不到不影响阅读，静默降级为空列表
        if (!cancelled) setSiblings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chapter?.courseId]);

  const auxContent = useMemo(
    () => (
      <>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          阅读完成后点击右上角「标记完成」。章节进度会影响后续实验的解锁。
          若老师准备了课件，可用顶部「文档 / 幻灯片」切换。
        </Paragraph>
        {siblings.length > 0 && (
          <>
            <Divider style={{ margin: '4px 0 8px' }} />
            <List
              size="small"
              dataSource={siblings}
              renderItem={(item, index) => {
                const current = item.id === chapterId;
                return (
                  <List.Item style={{ padding: '4px 0' }}>
                    <Link
                      to={`/student/chapters/${item.id}`}
                      style={{ width: '100%', fontWeight: current ? 600 : undefined }}
                    >
                      <Text style={{ fontSize: 13 }} ellipsis>
                        {index + 1}. {item.title}
                      </Text>
                      {current && (
                        <Tag color="processing" style={{ marginLeft: 6 }}>
                          当前
                        </Tag>
                      )}
                    </Link>
                  </List.Item>
                );
              }}
            />
          </>
        )}
      </>
    ),
    [siblings, chapterId],
  );

  useAuxiliaryPanel('章节学习', auxContent);

  const deck = slidesData?.deck ?? null;
  const hasSlides = !!deck?.slides?.length;

  const refs = useMemo(
    () => collectFileRefs(deck?.slides ?? [], slidesData?.template?.design?.logoFileId ?? null),
    [deck?.slides, slidesData?.template?.design?.logoFileId],
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

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeChapter(chapterId);
      await load();
    } finally {
      setCompleting(false);
    }
  };

  /** 切到幻灯片后把焦点交给演示文档：否则 ←/→ 会被 Segmented 当成切换选项（跳回「文档」） */
  const handleViewChange = (value: string) => {
    setView(value as 'doc' | 'slides');
    if (value === 'slides') {
      window.requestAnimationFrame(() => stageRef.current?.focus());
    }
  };

  /** 幻灯片视图下拦掉 Segmented 的左右键（焦点万一还在它上面时，不会误切视图） */
  const guardSegmentedKeys = (event: React.KeyboardEvent) => {
    if (view !== 'slides') return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.preventDefault();
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }
  if (!chapter) {
    return <Empty description="章节不存在" />;
  }

  const done = chapter.myProgress === 'completed';

  const stage = (
    <SlideStage
      ref={stageRef}
      slides={deck?.slides ?? []}
      template={{
        baseTheme: slidesData?.template.baseTheme ?? 'simple',
        css: slidesData?.template.css ?? '',
      }}
      slideTheme={{ id: slidesData?.template.id, design: slidesData?.template.design }}
      meta={{ chapter: chapter.title }}
      config={deck?.config}
      footerText={slidesData?.template.design?.footerText ?? null}
      logoDataUrl={
        slidesData?.template.design?.logoFileId
          ? imageDataUrls[`file:${slidesData.template.design.logoFileId}`] ?? null
          : null
      }
      imageDataUrls={imageDataUrls}
      onIndexChange={setCurrentIndex}
      presenting={presenting}
      onExitPresenting={() => setPresenting(false)}
      // 内嵌视图也接管键盘：焦点不在 sandbox iframe 里时 ←/→ 仍能翻页（见该 prop 注释）
      keyboard={!presenting}
      height={560}
    />
  );

  // 放映：整屏只留演示（与教师端一致），Esc 退出
  if (presenting && hasSlides) return stage;

  return (
    <Card
      title={
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            {chapter.title}
          </Title>
          <StatusTag status={chapter.myProgress ?? 'not_started'} />
        </Space>
      }
      extra={
        <Space>
          {hasSlides && (
            // 包一层只为拦左右键：Segmented 内部是 radiogroup，←/→ 会切换选项
            <span onKeyDown={guardSegmentedKeys}>
              <Segmented
                value={view}
                onChange={handleViewChange}
                options={[
                  { label: '文档', value: 'doc' },
                  { label: '幻灯片', value: 'slides' },
                ]}
              />
            </span>
          )}
          {done ? (
            <Button icon={<CheckCircleOutlined />} disabled>
              已完成
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={completing}
              onClick={handleComplete}
            >
              标记完成
            </Button>
          )}
        </Space>
      }
    >
      {view === 'slides' && hasSlides ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space wrap size={8}>
            <Button size="small" icon={<LeftOutlined />} onClick={() => stageRef.current?.prev()} />
            <Button size="small" icon={<RightOutlined />} onClick={() => stageRef.current?.next()} />
            <Button size="small" icon={<AppstoreOutlined />} onClick={() => stageRef.current?.overview()}>
              总览
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => setPresenting(true)}
            >
              放映
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {deck?.slides.length ?? 0} 页 · 第 {Math.min(currentIndex + 1, deck?.slides.length ?? 1)} 页
            </Text>
          </Space>
          {stage}
          {/* 提示放在演示**下方**：放上方会把演示画面往下挤（2026-10-10 反馈） */}
          <Alert
            type="info"
            showIcon
            message="这是老师为本节准备的在线演示；点开演示后可左右方向键翻页、O 看总览，也可用上方按钮控制。"
          />
        </Space>
      ) : (
        <>
          {slidesError && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="本次没能加载幻灯片（不影响正文阅读）"
              description={slidesError}
            />
          )}
          <MarkdownView content={chapter.content} emptyText="本章节暂无内容" />
        </>
      )}
    </Card>
  );
}
