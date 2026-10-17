/**
 * 讲稿（notes）里的**备课提示**：半角方括号 `[ …… ]`（兼容全角 `［ ］`）**内联在口播里**。
 *
 * 为什么分两层（2026-10-17，prompt v12）：实测 v11 的讲稿混着两种东西 ——
 *   ① 可以照着念的**口播**；② 「先给学员一个隐喻」「提醒学员留意」「思考题第一题就是从这儿出的」
 *      这类**面向讲者的备课提示**（227 页里 44 页出现第三人称"学员/学生"）。
 * 教师反馈"那更像老师的思考，不是能念的稿子"。v12 于是把方向钉死：
 *   · 主体是能照读的第一人称口播（把 `[ … ]` 整段删掉后仍要通顺）；
 *   · 念不出来的话一律进 `[ ]`，渲染时弱化成 `.notes-cue` —— 讲者一眼分得清哪些要念、哪些别念。
 *
 * 两条渲染路径共用（v2 语义渲染 `semantic/render.ts`、v1 reveal 渲染 `renderDeck.ts`），
 * 讲稿浮层（按 `S` 呼出）读的就是 `<div class="notes">` 的 innerHTML，所以样式自动跟着走。
 * ⚠️ 正则与生成侧 `server/src/slides/semantic.schema.ts` 的 `NOTES_CUE_RE` 必须一致
 *（那边用它把 `[ ]` 剔掉后判断口播里是否混进了面向讲者的话）。
 */
export const NOTES_CUE_RE = /[\[［][^\[\]［］\n]{1,120}[\]］]/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 讲稿文本 → HTML：`[ …… ]` 包成 `<span class="notes-cue">`，其余原样转义输出。
 * 先切分再逐段转义（不能先转义再匹配 —— `&quot;` 之类会干扰判断）。
 */
export function renderNotesHtml(text: string): string {
  const source = String(text ?? '');
  let out = '';
  let last = 0;
  NOTES_CUE_RE.lastIndex = 0;
  for (let match = NOTES_CUE_RE.exec(source); match; match = NOTES_CUE_RE.exec(source)) {
    out += escapeHtml(source.slice(last, match.index));
    out += `<span class="notes-cue">${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return out + escapeHtml(source.slice(last));
}
