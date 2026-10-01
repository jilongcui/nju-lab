/**
 * 章节编辑页 2026-10-01 改版验证（Playwright + Chromium，走线上 nginx 链路）
 *
 * 覆盖：
 *   · 左侧菜单选中态：章节编辑页应高亮「课程管理」（不是工作台）；
 *     教师批改页应高亮「实验项目」
 *   · 右栏辅助区 Tabs：「章节」「图片」两个 tab；章节列表含兄弟章节
 *   · 干净切换章节：直接跳转、不弹确认
 *   · 脏状态切换章节：弹「保存并切换 / 放弃修改并切换 / 取消」三键对话框，取消后留在原页
 *   · 脏状态点左侧菜单：路由守卫弹「放弃修改并离开 / 继续编辑」
 *   · Markdown 预览：表格边框/表头底色、代码块 hljs 高亮、引用块；明暗主题截图
 *   · 「插入图片」按钮：自动展开右栏并切到「图片」tab；若图库有图，选一张插入正文
 *
 * 前置同 verify-slides.mjs（playwright chromium 在 ~/.cache/ms-playwright）。
 * 用法：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-chapter-edit.mjs [chapterId]
 *
 * 纪律：全程不点保存，不在线上留下任何数据改动。
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOTS_DIR = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS_DIR, { recursive: true });

const SITE_HOST = 'medai.nju.edu.cn';
const BASE = `http://${SITE_HOST}/lab`;
const CHAPTER_ID = process.argv[2] || '6133aea6-b85c-480f-ac9a-079820a8cef5';

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

const MD_SAMPLE = [
  '| 名称 | 类型 | 说明 |',
  '| --- | --- | --- |',
  '| foo | string | 示例一 |',
  '| bar | number | 示例二 |',
  '',
  '```js',
  'const x = 42;',
  'function add(a, b) { return a + b; }',
  '```',
  '',
  '> 引用块：这是一段说明。',
].join('\n');

try {
  // 0) 登录（同 verify-slides：API 拿 token，按 zustand persist 格式写 localStorage）
  const loginRes = await fetch('http://127.0.0.1:3100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password: 'teacher123' }),
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
  check('API 登录并注入会话', true, 'teacher');

  // 1) 进入章节编辑页：菜单应高亮「课程管理」；右栏应有 章节/图片 两个 tab
  await page.goto(`${BASE}/teacher/chapters/${CHAPTER_ID}/edit`, { waitUntil: 'domcontentloaded' });
  await page.getByText('章节内容（Markdown）').waitFor({ timeout: 20000 });
  const selectedMenu = await page.locator('.ant-menu-item-selected').innerText();
  check('章节编辑页菜单高亮「课程管理」', selectedMenu.includes('课程管理'), selectedMenu.trim());

  const auxTabs = page.locator('aside .ant-tabs-tab');
  const tabTexts = await auxTabs.allInnerTexts();
  check('右栏 Tabs 含「章节」「图片」', tabTexts.some((t) => t.includes('章节')) && tabTexts.some((t) => t.includes('图片')), tabTexts.join('/'));

  const chapterItems = page.locator('aside .ant-list-item');
  const chapterCount = await chapterItems.count();
  check('「章节」tab 列出兄弟章节', chapterCount >= 1, `${chapterCount} 个`);
  await page.screenshot({ path: `${SHOTS_DIR}/edit-01-tabs-chapters.png` });

  // 2) 干净状态切换章节：应直接跳转不弹框（有兄弟章节才测）
  if (chapterCount > 1) {
    const other = chapterItems.nth(chapterCount - 1); // 当前章高亮排第一概率高，点最后一个稳妥
    await other.click();
    await page.waitForTimeout(1200);
    const jumped = !page.url().includes(`${CHAPTER_ID}/edit`);
    const noModal = (await page.locator('.ant-modal-confirm').count()) === 0;
    check('干净切换章节：直接跳转、无确认框', jumped && noModal, page.url().split('/lab')[1]);
    await page.goto(`${BASE}/teacher/chapters/${CHAPTER_ID}/edit`, { waitUntil: 'domcontentloaded' });
    await page.getByText('章节内容（Markdown）').waitFor({ timeout: 20000 });
  } else {
    check('干净切换章节：直接跳转、无确认框', true, '单章节课程，跳过');
  }

  // 3) 填入测试 Markdown（脏状态），切预览：表格 / 代码高亮 / 引用块
  await page.locator('textarea').fill(MD_SAMPLE);
  await page.locator('.ant-segmented-item', { hasText: '预览' }).click();
  await page.locator('.markdown-view table').waitFor({ timeout: 5000 });

  const thCount = await page.locator('.markdown-view table th').count();
  const thBg = await page.locator('.markdown-view table th').first().evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  check('预览：表格渲染且有表头底色', thCount === 3 && thBg !== 'rgba(0, 0, 0, 0)', `th=${thCount} bg=${thBg}`);

  const hljsKeyword = await page.locator('.markdown-view pre code .hljs-keyword').count();
  const hljsTitle = await page.locator('.markdown-view pre code .hljs-title').count();
  check('预览：代码块 hljs 语法高亮', hljsKeyword >= 1 && hljsTitle >= 1, `keyword=${hljsKeyword} title=${hljsTitle}`);

  const quoteBorder = await page.locator('.markdown-view blockquote').first().evaluate(
    (el) => getComputedStyle(el).borderLeftWidth,
  );
  check('预览：引用块左边框', quoteBorder === '4px', quoteBorder);
  await page.screenshot({ path: `${SHOTS_DIR}/edit-02-preview-light.png` });

  // 4) 暗色主题下的高亮配色
  await page.locator('header .ant-switch').click();
  await page.waitForTimeout(600);
  const hasMdDark = (await page.locator('.markdown-view.md-dark').count()) === 1;
  const darkKeywordColor = await page.locator('.markdown-view pre code .hljs-keyword').first().evaluate(
    (el) => getComputedStyle(el).color,
  );
  check('暗色主题：md-dark 生效且高亮变色', hasMdDark && darkKeywordColor === 'rgb(255, 123, 114)', darkKeywordColor);
  await page.screenshot({ path: `${SHOTS_DIR}/edit-03-preview-dark.png` });
  await page.locator('header .ant-switch').click(); // 切回亮色
  await page.waitForTimeout(400);

  // 5) 脏状态切章节：三键对话框；取消后留在原页
  if (chapterCount > 1) {
    await page.locator('aside .ant-tabs-tab').filter({ hasText: '章节' }).click();
    await page.locator('aside .ant-list-item').last().click();
    await page.locator('.ant-modal-confirm').waitFor({ timeout: 5000 });
    // antd 对两字按钮自动插空格（取消 → 取 消），比对前先去空白
    const btns = (await page.locator('.ant-modal-confirm .ant-btn').allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
    const has3 = btns.some((t) => t.includes('保存并切换')) && btns.some((t) => t.includes('放弃修改并切换')) && btns.some((t) => t.includes('取消'));
    check('脏状态切章节：三键确认框', has3, btns.join('/'));
    await page.locator('.ant-modal-confirm .ant-btn').filter({ hasText: /取\s*消/ }).click();
    await page.waitForTimeout(500);
    const stayed = page.url().includes(`${CHAPTER_ID}/edit`);
    const contentKept = (await page.locator('.markdown-view table').count()) === 1;
    check('取消切换：留在原章节且内容未丢', stayed && contentKept);
  } else {
    check('脏状态切章节：三键确认框', true, '单章节课程，跳过');
  }

  // 6) 脏状态点左侧菜单：路由守卫拦截，选「继续编辑」
  await page.locator('.ant-menu-item').filter({ hasText: '工作台' }).click();
  await page.locator('.ant-modal-confirm').waitFor({ timeout: 5000 });
  const guardBtns = await page.locator('.ant-modal-confirm .ant-btn').allInnerTexts();
  check('路由守卫：离开确认框', guardBtns.some((t) => t.includes('放弃修改并离开')) && guardBtns.some((t) => t.includes('继续编辑')), guardBtns.join('/'));
  await page.locator('.ant-modal-confirm .ant-btn').filter({ hasText: '继续编辑' }).click();
  await page.waitForTimeout(500);
  check('继续编辑：仍在本页', page.url().includes(`${CHAPTER_ID}/edit`));

  // 7) 「插入图片」→ 右栏自动切到「图片」tab；有图则插一张
  await page.locator('.ant-segmented-item', { hasText: '编辑' }).click(); // 从预览切回编辑（守卫不管页内 Segmented）
  await page.getByRole('button', { name: '插入图片' }).click();
  await page.waitForTimeout(1500);
  const activeTab = await page.locator('aside .ant-tabs-tab-active').innerText();
  check('「插入图片」唤起右栏「图片」tab', activeTab.includes('图片'), activeTab.trim());
  await page.screenshot({ path: `${SHOTS_DIR}/edit-04-images-tab.png` });

  const thumbs = page.locator('aside img');
  if ((await thumbs.count()) > 0) {
    await thumbs.first().click();
    await page.getByRole('button', { name: /插入到正文/ }).click();
    await page.waitForTimeout(500);
    const content = await page.locator('textarea').inputValue();
    check('选图插入正文（file: 引用）', /!\[.*\]\(file:[0-9a-f-]{36}\)/.test(content));
  } else {
    check('选图插入正文（file: 引用）', true, '图库为空，跳过');
  }

  // 8) 批改页菜单归属「实验项目」
  const subRes = await fetch('http://127.0.0.1:3100/api/dashboard/teacher-summary', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const subJson = await subRes.json();
  const firstSub = subJson?.data?.pendingGrading?.[0];
  if (firstSub?.submissionId) {
    await page.goto(`${BASE}/teacher/submissions/${firstSub.submissionId}/grade`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const gradeMenu = await page.locator('.ant-menu-item-selected').innerText();
    check('批改页菜单高亮「实验项目」', gradeMenu.includes('实验项目'), gradeMenu.trim());
  } else {
    check('批改页菜单高亮「实验项目」', true, '无待批提交，跳过');
  }
} catch (err) {
  check(`执行异常：${err.message}`, false);
  await page.screenshot({ path: `${SHOTS_DIR}/edit-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过${failed ? `，${failed} 项失败` : ''}`);
process.exit(failed ? 1 : 0);
