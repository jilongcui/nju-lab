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
 *   ④ 学生端 UI：连讲稿浮层的**容器**都不渲染，按 `S` 没有任何反应
 *      （2026-10-17 实测发现：数据剥了但快捷键还在，学生会弹出一个「（本页没有讲稿）」空浮层）
 *
 * 用法：
 *   node web/tools/verify-notes-privacy.mjs [chapterId]                 # 打线上 /lab（默认）
 *   VERIFY_BASE=http://127.0.0.1:5199 VERIFY_API=http://127.0.0.1:3100/api node web/tools/verify-notes-privacy.mjs
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

const API = (process.env.VERIFY_API || 'http://127.0.0.1:3100/api').replace(/\/+$/, '');
const BASE = (process.env.VERIFY_BASE || 'http://medai.nju.edu.cn/lab').replace(/\/+$/, '');
const SITE_HOST = 'medai.nju.edu.cn';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= join(homedir(), '.cache', 'ms-playwright');
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

// ---------------- ④ 学生端 UI：讲稿功能本身不存在 ----------------
const studentAuth = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.VERIFY_STUDENT || 'student1',
    password: process.env.VERIFY_STUDENT_PASSWORD || 'student123',
  }),
}).then((r) => r.json());

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  args: BASE.includes(SITE_HOST)
    ? [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors']
    : [],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await context.addInitScript(
  ([tk, u]) => {
    if (window.top !== window) return;
    localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: tk, user: u }, version: 0 }));
  },
  [studentAuth.data.accessToken, studentAuth.data.user],
);
const page = await context.newPage();
await page.goto(`${BASE}/student/chapters/${CHAPTER_ID}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const slideTab = page.locator('.ant-segmented-item:has-text("幻灯片")');
if (await slideTab.count()) {
  await slideTab.first().click();
  await page.waitForTimeout(2500);
}
// 让焦点落进幻灯片 iframe（学生真实的操作路径），再按 S
const deckFrame = page.frames().find((f) => f !== page.mainFrame());
if (deckFrame) await deckFrame.click('body', { force: true }).catch(() => {});
await page.keyboard.press('s');
await page.waitForTimeout(600);

let overlaySeen = false;
for (const frame of page.frames()) {
  try {
    const has = await frame.evaluate(() => !!document.querySelector('.notes-overlay'));
    if (has) overlaySeen = true;
  } catch {
    /* 不可访问的 frame 跳过 */
  }
}
check('④ 学生端：连讲稿浮层容器都没有（按 S 无任何反应）', !overlaySeen);
await browser.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
