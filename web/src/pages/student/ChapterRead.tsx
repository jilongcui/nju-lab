import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Empty,
  Segmented,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { completeChapter, getChapter, getChapterSlides } from '../../api';
import type { Chapter, ChapterSlidesResponse } from '../../types';
import StatusTag from '../../components/StatusTag';
import MarkdownView from '../../components/MarkdownView';
import SlideStage from '../../slides/SlideStage';
import { collectFileRefs, fetchFileDataUrls } from '../../slides/files';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph } = Typography;

/**
 * 学生端章节页：**文档 ⇄ 幻灯片** 视图切换（设计文档 §10）。
 *
 * 只读：学生看不到模板清单，也不能改内容/模板（后端对学生返回 `templates: []`、写接口 403）。
 * 老师还没做幻灯片时不显示切换入口，也不打扰学生。
 */
export default function ChapterRead() {
  const { chapterId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [slidesData, setSlidesData] = useState<ChapterSlidesResponse | null>(null);
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const [view, setView] = useState<'doc' | 'slides'>('doc');
  const [completing, setCompleting] = useState(false);
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, string>>({});

  useAuxiliaryPanel(
    '章节学习',
    <Paragraph type="secondary">
      阅读完成后点击右上角「标记完成」。章节进度会影响后续实验的解锁。
      若老师准备了课件，可用顶部「文档 / 幻灯片」切换。
    </Paragraph>,
  );

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

  if (loading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }
  if (!chapter) {
    return <Empty description="章节不存在" />;
  }

  const done = chapter.myProgress === 'completed';

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
            <Segmented
              value={view}
              onChange={(value) => setView(value as 'doc' | 'slides')}
              options={[
                { label: '文档', value: 'doc' },
                { label: '幻灯片', value: 'slides' },
              ]}
            />
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
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Alert
            type="info"
            showIcon
            message="这是老师为本节准备的在线演示；左右方向键翻页，也可用底部按钮控制。"
          />
          <SlideStage
            slides={deck?.slides ?? []}
            template={{
              baseTheme: slidesData?.template.baseTheme ?? 'simple',
              css: slidesData?.template.css ?? '',
            }}
            config={deck?.config}
            footerText={slidesData?.template.design?.footerText ?? null}
            logoDataUrl={
              slidesData?.template.design?.logoFileId
                ? imageDataUrls[`file:${slidesData.template.design.logoFileId}`] ?? null
                : null
            }
            imageDataUrls={imageDataUrls}
            height={560}
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
