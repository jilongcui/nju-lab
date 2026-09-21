import { useMemo } from 'react';
import { marked } from 'marked';
import { Typography } from 'antd';

marked.setOptions({ gfm: true, breaks: true });

interface Props {
  content?: string;
  emptyText?: string;
}

/** 轻量 Markdown 渲染（marked），用于章节内容与项目信息预览 */
export default function MarkdownView({ content, emptyText = '暂无内容' }: Props) {
  const html = useMemo(() => {
    if (!content?.trim()) return '';
    return marked.parse(content, { async: false }) as string;
  }, [content]);

  if (!html) {
    return <Typography.Text type="secondary">{emptyText}</Typography.Text>;
  }
  return (
    <Typography>
      {/* 内容由教师/系统录入；学生输入不进入此渲染路径 */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </Typography>
  );
}
