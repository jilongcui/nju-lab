import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, Empty, message, Skeleton, Space, Typography } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { completeChapter, getChapter } from '../../api';
import type { Chapter } from '../../types';
import StatusTag from '../../components/StatusTag';
import MarkdownView from '../../components/MarkdownView';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph } = Typography;

export default function ChapterRead() {
  const { chapterId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [completing, setCompleting] = useState(false);

  useAuxiliaryPanel(
    '章节学习',
    <Paragraph type="secondary">
      阅读完成后点击右上角「标记完成」。章节进度会影响后续实验的解锁。
    </Paragraph>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChapter(await getChapter(chapterId));
    } finally {
      setLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeChapter(chapterId);
      message.success('本章已标记完成');
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
        done ? (
          <Button icon={<CheckCircleOutlined />} disabled>
            已完成
          </Button>
        ) : (
          <Button type="primary" icon={<CheckCircleOutlined />} loading={completing} onClick={handleComplete}>
            标记完成
          </Button>
        )
      }
    >
      <MarkdownView content={chapter.content} emptyText="本章节暂无内容" />
    </Card>
  );
}
