import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import { Typography } from 'antd';
import { fetchFileDataUrls } from '../slides/files';
import { useThemeStore } from '../stores/theme';
import './MarkdownView.css';

marked.setOptions({ gfm: true, breaks: true });
// marked 12 已移除内置 highlight 选项，语法高亮走官方 marked-highlight 扩展；
// 语言不在 common 集里时按纯文本处理（不高亮也不报错）
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);

interface Props {
  content?: string;
  emptyText?: string;
}

/** marked 输出里平台图片引用的形态：<img src="file:<uuid>" …> */
const FILE_SRC_RE = /src="(file:[0-9a-fA-F-]{36})"/g;
/** 上屏 HTML 里图片引用的暂存形态（无 src 的 img 不发任何请求） */
const FILE_REF_RE = /data-file-ref="(file:[0-9a-fA-F-]{36})"/g;

/** 轻量 Markdown 渲染（marked + hljs 高亮），用于章节内容与项目信息预览 */
export default function MarkdownView({ content, emptyText = '暂无内容' }: Props) {
  const dark = useThemeStore((s) => s.dark);
  const rawHtml = useMemo(() => {
    if (!content?.trim()) return '';
    const parsed = marked.parse(content, { async: false }) as string;
    // 先把 file: 引用的 src 摘下来存进 data-file-ref：原始 src 直接上屏会被浏览器当成
    // file:// 本地文件拦截（Console 报 "Not allowed to load local resource"），
    // 无 src 的 img 不发请求，alt 文本兜底展示（2026-09-30 学生端实测踩到）
    return parsed.replace(FILE_SRC_RE, (_whole, ref: string) => `data-file-ref="${ref}"`);
  }, [content]);

  // 正文里的平台图片（file:<fileId>）浏览器直接请求会 401（无鉴权头）——
  // 与幻灯片同一条管线：父页面带 JWT 取回 → data URL 补 src；取不到保持无 src（alt 兜底，不再报错）
  const [html, setHtml] = useState(rawHtml);
  useEffect(() => {
    setHtml(rawHtml);
    const refs = Array.from(
      new Set(Array.from(rawHtml.matchAll(FILE_REF_RE), (m) => m[1])),
    );
    if (!refs.length) return;
    let cancelled = false;
    void fetchFileDataUrls(refs).then((dataUrls) => {
      if (cancelled) return;
      setHtml(
        rawHtml.replace(FILE_REF_RE, (whole, ref: string) =>
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
      <div className={dark ? 'markdown-view md-dark' : 'markdown-view'} dangerouslySetInnerHTML={{ __html: html }} />
    </Typography>
  );
}
