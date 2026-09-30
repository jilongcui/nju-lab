import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { Typography } from 'antd';
import { fetchFileDataUrls } from '../slides/files';

marked.setOptions({ gfm: true, breaks: true });

interface Props {
  content?: string;
  emptyText?: string;
}

/** marked 输出里平台图片引用的形态：<img src="file:<uuid>" …> */
const FILE_SRC_RE = /src="(file:[0-9a-fA-F-]{36})"/g;

/** 轻量 Markdown 渲染（marked），用于章节内容与项目信息预览 */
export default function MarkdownView({ content, emptyText = '暂无内容' }: Props) {
  const rawHtml = useMemo(() => {
    if (!content?.trim()) return '';
    return marked.parse(content, { async: false }) as string;
  }, [content]);

  // 正文里的平台图片（file:<fileId>）浏览器直接请求会 401（无鉴权头）——
  // 与幻灯片同一条管线：父页面带 JWT 取回 → data URL 替换，取不到就保留原样（alt 兜底）
  const [html, setHtml] = useState(rawHtml);
  useEffect(() => {
    setHtml(rawHtml);
    const refs = Array.from(
      new Set(Array.from(rawHtml.matchAll(FILE_SRC_RE), (m) => m[1])),
    );
    if (!refs.length) return;
    let cancelled = false;
    void fetchFileDataUrls(refs).then((dataUrls) => {
      if (cancelled) return;
      setHtml(
        rawHtml.replace(FILE_SRC_RE, (whole, ref: string) =>
          dataUrls[ref] ? `src="${dataUrls[ref]}"` : whole,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [rawHtml]);

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
