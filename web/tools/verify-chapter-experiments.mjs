/**
 * 章节课「实验」入口 + 课程章节列表页版面验证 —— 真实浏览器（Playwright + Chromium）
 *
 * 背景（2026-10-13 学员反馈）：上完一节想进实验，必须离开章节 → 回课程详情 → 再点实验标签，
 * 路径太长。改法：
 *   · 章节课右栏改成「章节 | 实验」两个 tab（学生端 `ChapterRead`、教师端 `ChapterEdit` /
 *     `ChapterSlides`），当前章实验高亮，点实验名直接进入；
 *   · 课程章节列表页不再列具体实验，只给概览（本章实验 N 个 / 课件 X 页）。
 *
 * 覆盖：
 *   ① 学生课程页：无 `/student/projects/*` 链接（不再列具体实验）、每卡有实验计数与课件信息、
 *      页头概览、卡片等高与标题不折行
 *   ② 学生章节课：右栏「章节 / 实验」两个 tab、实验条数与后端一致、当前章高亮、
 *      点实验名直接进入实验页（不经过课程详情）
 *   ③ 教师章节页（编辑 / 幻灯片）：右栏有「实验」tab，点实验名进入教师端实验详情
 *
 * 用法（默认打线上 medai.nju.edu.cn/lab）：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-chapter-experiments.mjs [courseId]
 *
 * 本地联调（不动线上服务；后端另起一个端口、前端 dev server 指过去）：
 *   VERIFY_BASE=http://127.0.0.1:5173 VERIFY_API=http://127.0.0.1:3101/api \
 *     node web/tools/verify-chapter-experiments.mjs
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOTS_DIR = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS_DIR, { recursive: true });

const SITE_HOST = 'medai.nju.edu.cn';
const BASE = process.env.VERIFY_BASE || `http://${SITE_HOST}/lab`;
const API = process.env.VERIFY_API || 'http://127.0.0.1:3100/api';
const COURSE_ID = process.argv[2] || 'cd11ea33-0f1f-420a-afbc-951baf1f5e89';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

/** 打线上时把 medai 指到本机（走真实 nginx 链路）；本地 base 不需要 */
const launchArgs = BASE.includes(SITE_HOST)
  ? [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors']
  : ['--ignore-certificate-errors'];
const browser = await chromium.launch({ args: launchArgs });

async function apiLogin(username, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  const token = body?.data?.accessToken;
  const user = body?.data?.user;
  if (!token) throw new Error(`${username} 登录失败：` + JSON.stringify(body).slice(0, 200));
  return { token, user };
}

function apiGet(token, path) {
  return fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.json())
    .then((body) => body?.data);
}

/** API 登录 + 注入会话（与 verify-course-pages.mjs 同一套：不走 UI 登录，避免误点 CAS） */
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

/** 右栏（aside）里某个 tab 的按钮 */
const auxTab = (page, label) => page.locator('aside .ant-tabs-tab', { hasText: new RegExp(`^${label}`) }).first();

/** 右栏当前激活 tab 面板里的实验链接 */
const activeProjectLinks = (page) =>
  page.locator('aside .ant-tabs-tabpane-active a[href*="/projects/"]');

try {
  // ---------- 准备：以 API 的真实数据为断言基准 ----------
  const student = await apiLogin('student1', 'student123');
  const course = await apiGet(student.token, `/courses/${COURSE_ID}`);
  const chapters = [...(course.chapters ?? [])].sort((a, b) => a.order - b.order);
  const totalExperiments = chapters.reduce((sum, ch) => sum + (ch.projects?.length ?? 0), 0);
  const chapterWithProjects = chapters.find((ch) => (ch.projects?.length ?? 0) > 0);
  const chapterIndex = chapters.findIndex((ch) => ch.id === chapterWithProjects?.id);
  const currentChapterExperiments = chapterWithProjects?.projects?.length ?? 0;
  const slideChapters = chapters.filter((ch) => (ch.slideCount ?? 0) > 0).length;
  const assignments = await apiGet(student.token, '/me/assignments');
  // /me/assignments 含该学生的**全部课程**：只取本课程的，否则会把别的课的未解锁实验算进来
  const courseProjectIds = new Set(
    chapters.flatMap((ch) => (ch.projects ?? []).map((p) => p.id)),
  );
  const lockedIds = new Set(
    (assignments ?? [])
      .filter((a) => !a.unlocked && courseProjectIds.has(a.project.id))
      .map((a) => a.project.id),
  );
  check(
    '基准数据：课程有章节与实验（取自 GET /courses/:id）',
    chapters.length > 0 && totalExperiments > 0,
    `${chapters.length} 章 / ${totalExperiments} 实验`,
  );
  check('基准数据：章节已带课件页数（slideCount，后端新字段）', slideChapters > 0, `${slideChapters} 章有课件`);

  // ========== ① 学生课程页：只给概览，不列具体实验 ==========
  {
    const { context, page } = await openSession(student);
    await page.goto(`${BASE}/student/courses/${COURSE_ID}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ant-card').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);

    const cardCount = await page.locator('.ant-card').count();
    check(
      '课程页：不再列具体实验（没有任何 /student/projects 链接）',
      (await page.locator('a[href*="/student/projects/"]').count()) === 0,
    );
    check(
      '课程页：每张卡显示「本章实验 N 个」',
      (await page.getByText(/本章实验 \d+ 个/).count()) === cardCount,
      `${await page.getByText(/本章实验 \d+ 个/).count()}/${cardCount}`,
    );
    check(
      '课程页：每张卡显示课件信息（课件 N 页 / 无课件）',
      (await page.getByText(/^(课件 \d+ 页|无课件)$/).count()) === cardCount,
      `${await page.getByText(/^(课件 \d+ 页|无课件)$/).count()}/${cardCount}`,
    );
    const header = await page.getByText(/^共 \d+ 章 · 实验 \d+ 个/).first().innerText();
    check(
      '课程页：页头概览（章数 / 实验数 / 有课件的章数）',
      header.includes(`共 ${chapters.length} 章`) &&
        header.includes(`实验 ${totalExperiments} 个`) &&
        header.includes(`${slideChapters} 章有课件`),
      header.trim(),
    );

    // 版式：同一行卡片等高、标题不折行（沿用 verify-course-pages.mjs 的口径）
    const rows = await page.evaluate(() => {
      const groups = [];
      for (const el of document.querySelectorAll('.ant-card')) {
        const r = el.getBoundingClientRect();
        const top = Math.round(r.top);
        const row = groups.find((g) => Math.abs(g.top - top) <= 2);
        if (row) row.heights.push(Math.round(r.height));
        else groups.push({ top, heights: [Math.round(r.height)] });
      }
      return groups;
    });
    for (const [i, row] of rows.entries()) {
      if (row.heights.length < 2) continue;
      check(
        `课程页：第 ${i + 1} 行 ${row.heights.length} 张卡片等高`,
        new Set(row.heights).size === 1,
        row.heights.join(','),
      );
    }
    const wrapped = await page.evaluate(
      () =>
        [...document.querySelectorAll('.ant-card-head-title')].filter(
          (el) => el.scrollHeight > el.clientHeight + 1,
        ).length,
    );
    check('课程页：章节标题单行省略（无折行）', wrapped === 0, wrapped ? `${wrapped} 张卡折行` : '');
    await page.screenshot({ path: `${SHOTS_DIR}01-student-course-list.png`, fullPage: true });
    await context.close();
  }

  // ========== ② 学生章节课：右栏「章节 | 实验」，实验直接可进 ==========
  {
    const { context, page } = await openSession(student);
    await page.goto(`${BASE}/student/chapters/${chapterWithProjects.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('aside .ant-tabs-tab').first().waitFor({ timeout: 20000 });
    // 右栏数据（章节目录 + 我的任务）是异步来的：等「实验 N」这个计数落到 tab 上再断言
    await page
      .waitForFunction(
        (n) =>
          [...document.querySelectorAll('aside .ant-tabs-tab')].some(
            (el) => el.innerText.trim() === `实验 ${n}`,
          ),
        totalExperiments,
        { timeout: 15000 },
      )
      .catch(() => {});

    check('章节课：右栏有「章节」tab', (await auxTab(page, '章节').count()) === 1);
    const auxTabTexts = await page.evaluate(() =>
      [...document.querySelectorAll('aside .ant-tabs-tab')].map((el) => el.innerText.trim()),
    );
    check(
      '章节课：右栏有「实验」tab 且标签带全课程实验数',
      auxTabTexts.includes(`实验 ${totalExperiments}`),
      `实际 tab：${auxTabTexts.join(' / ')}`,
    );
    // 默认仍在「章节」tab：既有的课程目录不能被顶掉
    check(
      '章节课：默认停在「章节」tab（课程目录仍可见）',
      (await page.locator('aside a[href*="/student/chapters/"]').count()) >= chapters.length,
      `${await page.locator('aside a[href*="/student/chapters/"]').count()} 个目录链接`,
    );

    await auxTab(page, '实验').click();
    await page.waitForTimeout(500);
    const linkCount = await activeProjectLinks(page).count();
    check('章节课：「实验」tab 列出全课程实验', linkCount === totalExperiments, `${linkCount}/${totalExperiments}`);
    check(
      '章节课：实验行标出所属章节（第 N 章）',
      (await page.getByText(new RegExp(`第 ${chapterIndex + 1} 章 ·`)).count()) >= 1,
    );

    const highlight = await page.evaluate(() => {
      const pane = document.querySelector('aside .ant-tabs-tabpane-active');
      const items = [...(pane?.querySelectorAll('.ant-list-item') ?? [])];
      return {
        total: items.length,
        highlighted: items.filter((el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)')
          .length,
      };
    });
    check(
      '章节课：当前章实验高亮',
      highlight.highlighted === currentChapterExperiments,
      `高亮 ${highlight.highlighted} / 本章实验 ${currentChapterExperiments}`,
    );
    if (lockedIds.size > 0) {
      const locked = await page.locator('aside .ant-tabs-tabpane-active .anticon-lock').count();
      check('章节课：未解锁实验带锁标记', locked === lockedIds.size, `${locked}/${lockedIds.size}`);
    } else {
      check('章节课：未解锁实验带锁标记', true, '该学生实验全部已解锁，跳过');
    }
    await page.screenshot({ path: `${SHOTS_DIR}02-student-chapter-experiments.png`, fullPage: true });

    // 关键场景：从章节课直接进实验（原先必须先退出到课程详情）
    const firstHref = await activeProjectLinks(page).first().getAttribute('href');
    await activeProjectLinks(page).first().click();
    await page.waitForURL(/\/student\/projects\//, { timeout: 15000 });
    check(
      '章节课：点实验名直接进入实验页（不经过课程详情）',
      page.url().includes('/student/projects/'),
      `${firstHref} → ${new URL(page.url()).pathname}`,
    );
    await context.close();
  }

  // ========== ③ 教师章节页：右栏也有「实验」tab ==========
  {
    const teacher = await apiLogin('teacher', 'teacher123');
    const teacherCourse = await apiGet(teacher.token, `/courses/${COURSE_ID}`).catch(() => null);
    check(
      '教师（协作者）能读到本课程章节与实验',
      (teacherCourse?.chapters?.length ?? 0) > 0,
      `${teacherCourse?.chapters?.length ?? 0} 章`,
    );
    const { context, page } = await openSession(teacher);
    for (const [scene, path] of [
      ['章节编辑', `/teacher/chapters/${chapterWithProjects.id}/edit`],
      ['章节幻灯片', `/teacher/chapters/${chapterWithProjects.id}/slides`],
    ]) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.locator('aside .ant-tabs-tab').first().waitFor({ timeout: 30000 });
      check(
        `教师端${scene}：右栏有「实验」tab`,
        (await page.locator('aside .ant-tabs-tab', { hasText: /^实验/ }).count()) === 1,
      );
    }
    await auxTab(page, '实验').click();
    await page.waitForTimeout(500);
    const teacherLinks = await activeProjectLinks(page).count();
    check('教师端章节幻灯片：列出全课程实验', teacherLinks === totalExperiments, `${teacherLinks}/${totalExperiments}`);
    await page.screenshot({ path: `${SHOTS_DIR}03-teacher-chapter-experiments.png`, fullPage: true });
    await activeProjectLinks(page).first().click();
    await page.waitForURL(/\/teacher\/projects\//, { timeout: 15000 });
    check('教师端章节幻灯片：点实验名进入教师端实验详情', page.url().includes('/teacher/projects/'));
    await context.close();
  }
} catch (error) {
  check('执行异常', false, String(error).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  for (const [label] of failed) console.log(`  · ${label}`);
}
process.exit(failed.length ? 1 : 0);
