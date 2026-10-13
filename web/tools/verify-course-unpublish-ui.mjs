/**
 * 课程「下架」按钮的界面验证 —— 真实浏览器（Playwright + Chromium）
 *
 * 背景：2026-10-13 用户要求把内部示例 / 验收课程从公开目录撤下。平台此前只有「发布」，
 * 本次补了 `POST /api/courses/:id/unpublish` 与教师端课程卡片的「下架」按钮。
 *
 * 覆盖：
 *   ① 已发布课程卡片有「下架」、没有「发布」
 *   ② 点「下架」确认后：卡片状态变「草稿」、操作区换成「发布」
 *   ③ 下架后学生在「选课」页看不到这门课
 *   ④ 清理：临时课程删除
 *
 * 用法（默认打线上 medai.nju.edu.cn/lab）：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-course-unpublish-ui.mjs
 * 本地联调：
 *   VERIFY_BASE=http://127.0.0.1:5173 VERIFY_API=http://127.0.0.1:3101/api \
 *     node web/tools/verify-course-unpublish-ui.mjs
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOTS_DIR = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS_DIR, { recursive: true });

const SITE_HOST = 'medai.nju.edu.cn';
const BASE = process.env.VERIFY_BASE || `http://${SITE_HOST}/lab`;
const API = process.env.VERIFY_API || 'http://127.0.0.1:3100/api';
const LAUNCH_ARGS = BASE.includes(SITE_HOST)
  ? [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors']
  : ['--ignore-certificate-errors'];

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

async function apiLogin(username, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!body?.data?.accessToken) throw new Error(`${username} 登录失败`);
  return { token: body.data.accessToken, user: body.data.user };
}

function call(token, path, { method = 'GET', body } = {}) {
  return fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }));
}
const pick = (res) => res.data?.data ?? res.data;

const STAMP = Date.now();
// 标题刻意不含"下架/发布"字样：否则 getByText 会连标题一起匹配到（子串匹配）
const TITLE = `卡片操作验证-${STAMP}`;

const browser = await chromium.launch({ args: LAUNCH_ARGS });
async function openSession(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ([t, u]) => {
      localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: t, user: u }, version: 0 }));
    },
    [login.token, login.user],
  );
  return { context, page: await context.newPage() };
}

const admin = await apiLogin('admin', 'admin123');
const student = await apiLogin('student1', 'student123');

let courseId = null;
try {
  courseId = pick(await call(admin.token, '/courses', { method: 'POST', body: { title: TITLE, term: '测试' } }))?.id;
  await call(admin.token, `/courses/${courseId}/chapters`, {
    method: 'POST',
    body: { title: '验证用章节', order: 1, content: '# 临时章节', status: 'published' },
  });
  await call(admin.token, `/courses/${courseId}/publish`, { method: 'POST' });
  check('准备：临时课程已发布', !!courseId, `course=${courseId}`);

  // ---------- ① 已发布卡片：有「下架」 ----------
  const { context: adminCtx, page } = await openSession(admin);
  await page.goto(`${BASE}/teacher/courses`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('.ant-card').filter({ hasText: TITLE }).first();
  await card.waitFor({ timeout: 30000 });
  check('教师端：临时课程卡片可见且状态为「已发布」', (await card.innerText()).includes('已发布'));
  // 只数操作区的按钮：标题/状态标签里出现同名字样不算
  const actions = card.locator('.ant-card-actions');
  check(
    '已发布卡片：有「下架」，没有「发布」',
    (await actions.getByText('下架', { exact: true }).count()) === 1 &&
      (await actions.getByText('发布', { exact: true }).count()) === 0,
  );
  await page.screenshot({ path: `${SHOTS_DIR}01-teacher-course-published.png`, fullPage: true });

  // ---------- ② 点「下架」→ 状态变草稿 ----------
  await card.locator('.ant-card-actions').getByText('下架', { exact: true }).click();
  await page.locator('.ant-popover').getByRole('button', { name: '确 定' }).click();
  await page.waitForTimeout(1500);
  const cardAfter = page.locator('.ant-card').filter({ hasText: TITLE }).first();
  const textAfter = await cardAfter.innerText();
  check('下架后：卡片状态变「草稿」', textAfter.includes('草稿'), textAfter.split('\n').slice(0, 2).join(' / '));
  check(
    '下架后：操作区换成「发布」',
    (await cardAfter.locator('.ant-card-actions').getByText('发布', { exact: true }).count()) === 1,
  );
  const persisted = pick(await call(admin.token, `/courses/${courseId}`));
  check('下架已落库（status=draft）', persisted?.status === 'draft', `status=${persisted?.status}`);
  await adminCtx.close();

  // ---------- ③ 学生在选课页看不到 ----------
  const { context: studentCtx, page: studentPage } = await openSession(student);
  await studentPage.goto(`${BASE}/browse`, { waitUntil: 'domcontentloaded' });
  await studentPage.waitForTimeout(2000);
  const studentText = await studentPage.evaluate(() => document.body.innerText);
  check('学生「选课」页看不到已下架的课程', !studentText.includes(TITLE));
  await studentCtx.close();
} catch (error) {
  check('执行异常', false, String(error).slice(0, 300));
} finally {
  if (courseId) {
    const del = await call(admin.token, `/courses/${courseId}`, { method: 'DELETE' });
    const after = await call(admin.token, `/courses/${courseId}`);
    check(
      '清理：临时课程已删除（再取 404）',
      (del.status === 200 || del.status === 204) && after.status === 404,
      `delete=${del.status} get=${after.status}`,
    );
  }
  await browser.close();
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  for (const [label] of failed) console.log(`  · ${label}`);
}
process.exit(failed.length ? 1 : 0);
