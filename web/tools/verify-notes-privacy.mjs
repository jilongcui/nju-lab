#!/usr/bin/env node
/**
 * 讲稿（notes）隐私验证 —— 纯 API
 *
 * 背景（2026-10-17）：deck 文档里的 `notes` 只是 `display:none`，学生按 F12 能看到；
 * 放映时按 `S` 呼出的讲稿浮层同样对学生可见。改法：`getDeck` 按**观看者**裁剪 ——
 * 不能编辑这份 deck 的人，拿到的 `slides[].notes` 与 `markdown` 里的 `<!-- .notes: … -->` 都为空。
 *
 * 覆盖：
 *   ① 学生：slides[].notes 全部为空、markdown 里没有 .notes 指令
 *   ② 学生：其它内容一个不少（页数、标题、模板、canEdit=false）—— 别剥太狠
 *   ③ 教师：讲稿**仍在**（不能误伤，否则讲者视图 / 讲稿编辑都没了）
 *
 * 用法（默认打本机 3100）：
 *   node web/tools/verify-notes-privacy.mjs [chapterId]
 *   VERIFY_API=http://127.0.0.1:3101/api node web/tools/verify-notes-privacy.mjs
 */
const API = (process.env.VERIFY_API || 'http://127.0.0.1:3100/api').replace(/\/+$/, '');
const CHAPTER_ID = process.argv[2] || '7070707c-0d96-4162-aac2-5650e0e277a2';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

const login = async (username, password) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!body?.data?.accessToken) throw new Error(`${username} 登录失败`);
  return body.data.accessToken;
};

const fetchDeck = async (token) => {
  const res = await fetch(`${API}/chapters/${CHAPTER_ID}/slides`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`GET slides → ${res.status} ${JSON.stringify(body).slice(0, 160)}`);
  return body.data ?? body;
};

const studentToken = await login(
  process.env.VERIFY_STUDENT || 'student1',
  process.env.VERIFY_STUDENT_PASSWORD || 'student123',
);
const teacherToken = await login('admin', 'admin123');

const asStudent = await fetchDeck(studentToken);
const asTeacher = await fetchDeck(teacherToken);

const studentSlides = asStudent.deck?.slides ?? [];
const teacherSlides = asTeacher.deck?.slides ?? [];
const notesOf = (slides) => slides.map((s) => String(s?.notes ?? '')).filter((n) => n.trim().length > 0);

const studentNotes = notesOf(studentSlides);
const teacherNotes = notesOf(teacherSlides);

console.log(
  `章节 ${CHAPTER_ID}：学生拿到 ${studentSlides.length} 页（有讲稿 ${studentNotes.length} 页）、` +
    `教师拿到 ${teacherSlides.length} 页（有讲稿 ${teacherNotes.length} 页）\n`,
);

check('① 学生：slides[].notes 一页都没有', studentNotes.length === 0, `有讲稿的页数=${studentNotes.length}`);
check(
  '① 学生：markdown 里没有 .notes 指令',
  !/<!--\s*\.notes\s*:/.test(String(asStudent.deck?.markdown ?? '')),
);
check(
  '② 学生：其它内容没被剥掉（页数一致、有标题、canEdit=false）',
  studentSlides.length === teacherSlides.length &&
    studentSlides.length > 0 &&
    Boolean(asStudent.deck?.title) &&
    asStudent.canEdit === false,
  `页数 ${studentSlides.length}/${teacherSlides.length}、canEdit=${asStudent.canEdit}`,
);
check(
  '③ 教师：讲稿仍在（讲者视图与讲稿编辑都要用）',
  teacherNotes.length > 0,
  `有讲稿的页数=${teacherNotes.length}`,
);
check(
  '③ 教师：markdown 里仍带 .notes 指令',
  /<!--\s*\.notes\s*:/.test(String(asTeacher.deck?.markdown ?? '')),
);

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
