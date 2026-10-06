/**
 * 学生端课程页（我的课程 / 课程章节页）—— 真实浏览器版式验证（Playwright + Chromium）
 *
 * 背景（2026-10-06 版式优化）：「我的课程」新增授课教师/课程简介展示，两页卡片统一宽高。
 * 这类问题读代码推断不出来，靠截图 + 几何断言（同行卡片等高、标题不折行）。
 *
 * 用法：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-course-pages.mjs [courseId]
 *
 * 机制与 verify-slides.mjs 相同：`--host-resolver-rules` 把 medai 指到 127.0.0.1 走线上
 * nginx 链路；API 登录后按 zustand persist 格式写 localStorage(`nju-lab-auth`) 注入会话。
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOTS_DIR = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS_DIR, { recursive: true });

const SITE_HOST = 'medai.nju.edu.cn';
const BASE = `http://${SITE_HOST}/lab`;
const COURSE_ID = process.argv[2] || 'cd11ea33-0f1f-420a-afbc-951baf1f5e89';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

/** 取页面上 .ant-card 的几何信息，按行分组（top 相近为一行） */
const cardRows = () =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ant-card')].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    });
    const rows = [];
    for (const c of cards) {
      const row = rows.find((r) => Math.abs(r.top - c.top) <= 2);
      if (row) row.cards.push(c);
      else rows.push({ top: c.top, cards: [c] });
    }
    return rows;
  });

/** 每行内卡片等高、全部卡片等宽 */
const checkUniform = (scope, rows) => {
  const widths = new Set(rows.flatMap((r) => r.cards.map((c) => c.width)));
  check(`${scope}：卡片宽度一致`, widths.size === 1, [...widths].join(','));
  for (const [i, row] of rows.entries()) {
    if (row.cards.length < 2) continue;
    const heights = new Set(row.cards.map((c) => c.height));
    check(`${scope}：第 ${i + 1} 行 ${row.cards.length} 张卡片等高`, heights.size === 1, [...heights].join(','));
  }
};

try {
  // 1) 登录（API + localStorage 注入，避开登录页「统一认证登录」的子串误点）
  const loginRes = await fetch('http://127.0.0.1:3100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'student1', password: 'student123' }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson?.data?.accessToken;
  const user = loginJson?.data?.user;
  if (!token) throw new Error('API 登录失败：' + JSON.stringify(loginJson).slice(0, 200));
  await context.addInitScript(
    ([t, u]) => {
      localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: t, user: u }, version: 0 }));
    },
    [token, user],
  );
  check('API 登录并注入会话', true, 'student1');

  // 2) 我的课程：教师/学期/简介可见，卡片等高
  await page.goto(`${BASE}/student/courses`, { waitUntil: 'domcontentloaded' });
  await page.getByText('我的课程').first().waitFor({ timeout: 20000 });
  await page.locator('.ant-card').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);

  const teacherCount = await page.getByText(/授课教师：/).count();
  const cardCount = await page.locator('.ant-card').count();
  check('我的课程：每张卡展示授课教师', teacherCount >= cardCount && cardCount > 0, `${teacherCount}/${cardCount}`);

  checkUniform('我的课程', await cardRows());
  await page.screenshot({ path: `${SHOTS_DIR}my-courses.png`, fullPage: true });

  // 3) 课程章节页：卡片等高、标题单行不折行
  await page.goto(`${BASE}/student/courses/${COURSE_ID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.ant-card').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);

  check('章节页：展示授课教师', (await page.getByText(/授课教师：/).count()) >= 1);

  const wrapped = await page.evaluate(() => {
    return [...document.querySelectorAll('.ant-card-head-title')].filter(
      (el) => el.scrollHeight > el.clientHeight + 1,
    ).length;
  });
  check('章节标题单行省略（无折行）', wrapped === 0, wrapped ? `${wrapped} 张卡折行` : '');

  checkUniform('章节页', await cardRows());
  await page.screenshot({ path: `${SHOTS_DIR}course-chapters.png`, fullPage: true });
} catch (err) {
  check('执行异常', false, String(err).slice(0, 300));
  try {
    await page.screenshot({ path: `${SHOTS_DIR}course-pages-error.png`, fullPage: true });
  } catch {}
} finally {
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n== ${results.length - failed.length}/${results.length} 通过；截图在 web/tools/shots/ ==`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
