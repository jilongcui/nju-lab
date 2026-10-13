/**
 * 实验详情页分层 + 难度标注的界面验证 —— 真实浏览器（Playwright + Chromium）
 *
 * 背景（2026-10-13 学员反馈）：
 *   · 详情页原先把十来个字段平铺，最显眼的反而是「评估模型 / 推理档位」这类技术配置，
 *     而真正的题面只存在于题目包 task.md 里 —— 学生必须先下载解压才看得到。
 *   · 改法：新增**实验内容** `content` 字段放首屏 + **「实验指导」折叠区**收技术细节；
 *     并加**难度等级**（容易/中等/提高，可空）供不同基础的学生挑选。
 *
 * 覆盖：
 *   ① 学生首屏：实验内容 + 实验目标可见；难度标签可见；技术内容（背景知识/评估配置）默认收起
 *   ② 展开「实验指导」后：背景知识、任务要求（口径）、评分要求、运行环境与评估配置都在
 *   ③ 教师端：详情页三张分区卡片（实验内容 / 实验指导 / 运行环境与评估配置）都在；
 *      编辑弹窗有「实验内容」与「难度等级」，且能改难度 → 页面标签随之更新
 *   ④ 清理：临时课程删除
 *
 * 用法（默认打线上 medai.nju.edu.cn/lab）：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-experiment-detail.mjs
 * 本地联调（不动线上服务）：
 *   VERIFY_BASE=http://127.0.0.1:5173 VERIFY_API=http://127.0.0.1:3101/api \
 *     node web/tools/verify-experiment-detail.mjs
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
const MARKER = `TEMP-实验内容标记-${STAMP}`;
const CONTENT = `## 业务背景\n\n${MARKER}\n\n这是一个临时实验：给检验科做一个能查、能改的小数据库。\n\n## 你的任务\n\n建库 → 清洗入库 → 增删改查 → 用 SQL 回答临床问题。`;
const BACKGROUND = '关系模型：行是一条记录、列是一个属性；主键唯一标识一行。';
const DESCRIPTION = '先摸清数据，再设计并建库，最后按口径清洗入库。';

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
// 教师侧页面用 admin 会话：admin 建课即主教师，且 RequireRole 允许管理员访问教师端
// （teacher「示例教师」不属这门临时课程）
const teacher = admin;

let courseId = null;
let projectId = null;
try {
  // ---------- 准备：临时课程 + 章节 + 已发布实验（内容/难度/背景/口径/rubric 齐备） ----------
  courseId = pick(
    await call(admin.token, '/courses', {
      method: 'POST',
      body: { title: `详情页验证-临时课程-${STAMP}`, term: '测试' },
    }),
  )?.id;
  const chapter = pick(
    await call(admin.token, `/courses/${courseId}/chapters`, {
      method: 'POST',
      body: { title: '验证用章节', order: 1, content: '# 临时章节', status: 'published' },
    }),
  );
  const project = pick(
    await call(admin.token, '/projects', {
      method: 'POST',
      body: {
        title: `详情页验证-${STAMP}`,
        chapterId: chapter.id,
        content: CONTENT,
        difficulty: 'hard',
        objectives: '说清主外键为什么必要，并能把临床问题翻译成 SQL。',
        background: BACKGROUND,
        description: DESCRIPTION,
        rubric: [{ name: '复验通过率', weight: 60 }],
        evalConfig: { model: 'deepseek-flash', reasoningEffort: 'low', timeoutSeconds: 600 },
      },
    }),
  );
  projectId = project?.id;
  await call(admin.token, `/projects/${projectId}/publish`, { method: 'POST' });
  // 入册只加**学生**账号：把教师账号混进 studentIds 会让整批校验失败（学生随后 403）
  await call(admin.token, `/courses/${courseId}/enrollments`, {
    method: 'POST',
    body: { studentIds: [student.user.id] },
  });
  await call(admin.token, `/courses/${courseId}/publish`, { method: 'POST' });
  check('准备：临时课程 + 已发布实验（内容/难度/指导字段齐备）', !!projectId, `project=${projectId}`);

  // ========== ① 学生首屏：实验本身清晰，技术内容收起 ==========
  {
    const { context, page } = await openSession(student);
    await page.goto(`${BASE}/student/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('实验内容').first().waitFor({ timeout: 30000 });

    check('首屏：有「实验内容」卡片', (await page.getByText('实验内容').count()) >= 1);
    check('首屏：实验内容正文直接展示（不再需要下载题目包）', await page.getByText(MARKER).isVisible());
    check('首屏：实验目标可见', await page.getByText('实验目标').isVisible());
    check('首屏：难度标签可见（提高）', (await page.getByText('提高').count()) >= 1);
    check(
      '首屏：技术内容默认收起（背景知识不可见）',
      !(await page.getByText(BACKGROUND).isVisible().catch(() => false)),
    );
    check(
      '首屏：评估配置默认收起',
      !(await page.getByText('评估模型').isVisible().catch(() => false)),
    );
    await page.screenshot({ path: `${SHOTS_DIR}01-student-experiment-detail.png`, fullPage: true });

    // ---------- ② 展开「实验指导」 ----------
    await page.getByText(/^实验指导/).first().click();
    await page.getByText(BACKGROUND).first().waitFor({ timeout: 10000 });
    check('展开「实验指导」：背景知识出现', await page.getByText(BACKGROUND).isVisible());
    check('展开「实验指导」：任务要求（口径）出现', await page.getByText('任务要求（口径）').isVisible());
    check('展开「实验指导」：任务口径正文出现', await page.getByText(DESCRIPTION).isVisible());
    check('展开「实验指导」：评分要求出现', (await page.getByText('评分要求').count()) >= 1);
    check('展开「实验指导」：运行环境与评估配置出现', (await page.getByText('评估模型').count()) >= 1);
    await page.screenshot({ path: `${SHOTS_DIR}02-student-guide-expanded.png`, fullPage: true });
    await context.close();
  }

  // ========== ③ 教师端：分区卡片 + 编辑弹窗（含内容与难度） ==========
  {
    const { context, page } = await openSession(admin);
    await page.goto(`${BASE}/teacher/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('实验内容（学生详情页首屏）').first().waitFor({ timeout: 20000 });

    check('教师端：有「实验内容（学生详情页首屏）」卡片', (await page.getByText('实验内容（学生详情页首屏）').count()) >= 1);
    check('教师端：有「实验指导」卡片', (await page.getByText('实验指导（学生端收在折叠区）').count()) >= 1);
    check('教师端：有「运行环境与评估配置」卡片', (await page.getByText('运行环境与评估配置').count()) >= 1);
    check('教师端：难度标签已显示（提高）', (await page.getByText('提高').count()) >= 1);
    await page.screenshot({ path: `${SHOTS_DIR}03-teacher-project-detail.png`, fullPage: true });

    await page.getByRole('button', { name: '编辑项目信息' }).click();
    await page.locator('.ant-modal').first().waitFor({ timeout: 10000 });
    check(
      '编辑弹窗：有「实验内容（学生详情页首屏）」输入项',
      (await page.locator('.ant-modal').getByText('实验内容（学生详情页首屏）').count()) >= 1,
    );
    check('编辑弹窗：有「难度等级」选择项', (await page.locator('.ant-modal').getByText('难度等级').count()) >= 1);
    const difficultyItem = page
      .locator('.ant-modal .ant-form-item')
      .filter({ hasText: '难度等级' })
      .first();
    const difficultyShown = (await difficultyItem.locator('.ant-select-selection-item').innerText()).trim();
    check('编辑弹窗：难度回填当前值（提高）', difficultyShown === '提高', difficultyShown);

    // 改难度：提高 → 容易，保存后页面标签应同步
    await difficultyItem.locator('.ant-select-selector').click();
    await page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: '容易' }).first().click();
    await page.locator('.ant-modal').getByRole('button', { name: '确 定' }).click();
    await page.waitForTimeout(1500);
    const tagText = await page.evaluate(() =>
      [...document.querySelectorAll('.ant-tag')].map((el) => el.textContent?.trim()).join(','),
    );
    check('教师端改难度后：页面标签变为「容易」', tagText.includes('容易'), tagText);
    const persisted = pick(await call(admin.token, `/projects/${projectId}`));
    check('难度改动已落库', persisted?.difficulty === 'easy', `difficulty=${persisted?.difficulty}`);
    await context.close();
  }
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
