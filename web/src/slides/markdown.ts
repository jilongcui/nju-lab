import { marked } from 'marked';

/**
 * 幻灯片内容的 Markdown → 安全 HTML。
 *
 * **内容禁用原始 HTML**（设计文档 §11）：教师写的内容会在学生浏览器里渲染，
 * 一旦允许 `<script>` / `onerror=` / `javascript:` 就是一条通往学生会话的 XSS 链。
 *
 * 实现选择：**不靠"转义输入"，也不只改 marked 的某几个 renderer**，而是
 *   解析器（marked）→ DOM 解析 → 白名单清理 → 序列化
 * 因为实测 marked@12 默认行为是把 `<script>alert(1)</script>`、`<img onerror=…>`、
 * `[x](javascript:…)` **原样输出**，而正则清理 HTML 很容易被绕过；用 DOMParser 遍历属性逐项判断
 * 才挡得住各种变体（且解析出的内容不会执行、不会加载资源）。
 *
 * 注意：DOMParser 只存在于浏览器（幻灯片渲染本来就发生在浏览器），Node 侧测试用 jsdom。
 */

marked.setOptions({ gfm: true, breaks: true });

/** 危险标签：直接连同内容删掉（svg/math 也能挂脚本，一并移除） */
const DANGEROUS_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'svg',
  'math',
];

const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'poster'];

/** 允许的 URL 形态：站内相对路径、https/http/mailto，以及图片 data URL */
function isSafeUrl(raw: string): boolean {
  const value = raw.trim().replace(/[\u0000-\u001f\s]/g, '').toLowerCase();
  if (!value) return false;
  if (/^(https?:|mailto:|#|\/)/.test(value)) return true;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(value)) return true;
  // 其余一律拒绝：javascript:、vbscript:、data:text/html、file: 等
  return false;
}

function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const { body } = parsed;

  for (const tag of DANGEROUS_TAGS) {
    body.querySelectorAll(tag).forEach((node) => node.remove());
  }

  body.querySelectorAll('*').forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.includes(name) && !isSafeUrl(attr.value)) {
        element.removeAttribute(attr.name);
        continue;
      }
      // 内联样式是另一条注入面（内容不该改幻灯片的观感），直接去掉
      if (name === 'style') {
        element.removeAttribute(attr.name);
      }
    }
  });

  return body.innerHTML;
}

/** 块级 Markdown → 安全 HTML（用于两栏内容等） */
export function renderMarkdownSafe(source: string | undefined | null): string {
  const text = (source ?? '').trim();
  if (!text) return '';
  const html = marked.parse(text, { async: false }) as string;
  return sanitizeHtml(html);
}

/** 行内 Markdown → 安全 HTML（用于要点、标题这类单行文本） */
export function renderInlineSafe(source: string | undefined | null): string {
  const text = (source ?? '').trim();
  if (!text) return '';
  const html = marked.parseInline(text, { async: false }) as string;
  return sanitizeHtml(html);
}

/** 纯文本转义（用于标题、备注等不解析 Markdown 的位置） */
export function escapeHtml(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 属性值转义 */
export function escapeAttribute(value: string | undefined | null): string {
  return escapeHtml(value);
}
