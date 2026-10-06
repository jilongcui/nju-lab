/**
 * 课程页版式与权限验证 —— 真实浏览器（Playwright + Chromium）
 *
 * 覆盖：
 *   · 学生端「我的课程」/ 课程章节页（2026-10-06 版式优化）：教师/学期/简介展示、同行卡片等高、标题不折行
 *   · 教师端「课程管理」：卡片等高、简介固定两行、管理员可见「授课教师（转让课程）」下拉、教师不可见
 *
 * 用法：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-course-pages.mjs [courseId]
 *
 * 机制：`--host-resolver-rules` 把 medai 指到 127.0.0.1 走线上 nginx 链路；API 登录后按
 * zustand persist 格式写 localStorage(`nju-lab-auth`) 注入会话（不走 UI 登录，避免误点 CAS）。
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

/** API 登录 + 注入会话，返回独立 context 的页面（多角色互不影响） */
async function openSession(username, password) {
  const loginRes = await fetch('http://127.0.0.1:3100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson?.data?.accessToken;
  const user = loginJson?.data?.user;
  if (!token) throw new Error(`${username} API 登录失败：` + JSON.stringify(loginJson).slice(0, 200));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ([t, u]) => {
      localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: t, user: u }, version: 0 }));
    },
    [token, user],
  );
  return { context, page: await context.newPage() };
}

/** 页面上 .ant-card 的几何信息，按行分组（top 相近为一行） */
const cardRows = (page) =>
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

/** 打开第一张卡片的「编辑」弹窗，返回转让下拉 label 的可见数量 */
async function openEditModal(page) {
  await page.locator('.ant-card-actions span', { hasText: '编辑' }).first().click();
  await page.locator('.ant-modal').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  return page.getByText('授课教师（转让课程）').count();
}

try {
  // ========== 学生端（student1） ==========
  {
    const { context, page } = await openSession('student1', 'student123');
    check('API 登录并注入会话', true, 'student1');

    await page.goto(`${BASE}/student/courses`, { waitUntil: 'domcontentloaded' });
    await page.getByText('我的课程').first().waitFor({ timeout: 20000 });
    await page.locator('.ant-card').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);

    const teacherCount = await page.getByText(/授课教师：/).count();
    const cardCount = await page.locator('.ant-card').count();
    check('我的课程：每张卡展示授课教师', teacherCount >= cardCount && cardCount > 0, `${teacherCount}/${cardCount}`);

    checkUniform('我的课程', await cardRows(page));
    await page.screenshot({ path: `${SHOTS_DIR}my-courses.png`, fullPage: true });

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

    checkUniform('章节页', await cardRows(page));
    await page.screenshot({ path: `${SHOTS_DIR}course-chapters.png`, fullPage: true });
    await context.close();
  }

  // ========== 教师端（teacher）：等高 + 无转让下拉 ==========
  {
    const { context, page } = await openSession('teacher', 'teacher123');
    await page.goto(`${BASE}/teacher/courses`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ant-card').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);

    const teacherCount = await page.getByText(/授课教师：/).count();
    const cardCount = await page.locator('.ant-card').count();
    check('教师端：每张卡展示授课教师', teacherCount >= cardCount && cardCount > 0, `${teacherCount}/${cardCount}`);

    checkUniform('教师端课程管理', await cardRows(page));

    const transferLabels = await openEditModal(page);
    check('教师编辑弹窗：无「转让课程」下拉', transferLabels === 0);
    await page.getByRole('button', { name: '取 消' }).click();
    await page.screenshot({ path: `${SHOTS_DIR}teacher-courses.png`, fullPage: true });
    await context.close();
  }

  // ========== 教师端（admin）：转让下拉可见且选项为教师 ==========
  {
    const { context, page } = await openSession('admin', 'admin123');
    await page.goto(`${BASE}/teacher/courses`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ant-card').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);

    checkUniform('管理员课程管理', await cardRows(page));

    const transferLabels = await openEditModal(page);
    check('管理员编辑弹窗：有「转让课程」下拉', transferLabels === 1);

    // 选中值必须显示姓名（当前归属人可能是管理员，列表含管理员才能解析出 label）
    const selectedText = await page
      .locator('.ant-modal .ant-select .ant-select-selection-item')
      .first()
      .innerText()
      .catch(() => '');
    check(
      '转让下拉选中值显示姓名而非 UUID',
      selectedText.trim().length > 0 && !/^[0-9a-f-]{36}$/.test(selectedText.trim()),
      selectedText.trim(),
    );

    // 展开下拉，选项应来自 /users/teachers（非空）
    await page.locator('.ant-modal .ant-select').first().click();
    await page.waitForTimeout(500);
    const optionCount = await page.locator('.ant-select-dropdown .ant-select-item-option').count();
    check('转让下拉有教师选项', optionCount > 0, `${optionCount} 个选项`);
    await page.screenshot({ path: `${SHOTS_DIR}admin-course-transfer.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await context.close();
  }
} catch (err) {
  check('执行异常', false, String(err).slice(0, 300));
} finally {
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n== ${results.length - failed.length}/${results.length} 通过；截图在 web/tools/shots/ ==`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
