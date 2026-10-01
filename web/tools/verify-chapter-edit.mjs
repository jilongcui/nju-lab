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
  '',
  '行内公式 $E = mc^2$ 与块级公式：',
  '',
  '$$\\frac{a^2 + b^2}{2} \\geq \\sqrt{ab}$$',
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

  const katexCount = await page.locator('.markdown-view .katex').count();
  const katexDisplay = await page.locator('.markdown-view .katex-display').count();
  const katexFont = await page.locator('.markdown-view .katex').first().evaluate(
    (el) => getComputedStyle(el).fontFamily,
  );
  // 字体文件真实加载成功才算数（光声明 font-family 不够）
  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px "KaTeX_Main"');
  });
  check('预览：LaTeX 公式渲染（行内+块级+字体）', katexCount >= 2 && katexDisplay === 1 && katexFont.includes('KaTeX') && fontLoaded, `katex=${katexCount} display=${katexDisplay} font=${katexFont.split(',')[0]} loaded=${fontLoaded}`);
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
  // 9) 幻灯片页：右栏 Tabs、章节切换守卫、图片 tab 插图页
  await page.goto(`${BASE}/teacher/chapters/${CHAPTER_ID}/slides`, { waitUntil: 'domcontentloaded' });
  await page.getByText('章节幻灯片').first().waitFor({ timeout: 20000 });
  await page.locator('aside .ant-list-item').first().waitFor({ timeout: 15000 });
  const slideTabs = await page.locator('aside .ant-tabs-tab').allInnerTexts();
  check('幻灯片页右栏 Tabs 含「章节」「图片」', slideTabs.some((t) => t.includes('章节')) && slideTabs.some((t) => t.includes('图片')), slideTabs.join('/'));

  // 干净切换（无编辑）：点兄弟章节 → 直接跳
  const sibItems = page.locator('aside .ant-list-item');
  const sibCount = await sibItems.count();
  if (sibCount > 1) {
    await sibItems.last().click();
    await page.waitForTimeout(1500);
    const jumpedSlides = page.url().includes('/slides') && !page.url().includes(CHAPTER_ID);
    const noModal2 = (await page.locator('.ant-modal-confirm').count()) === 0;
    check('幻灯片页干净切换章节：直接跳转、无确认框', jumpedSlides && noModal2, page.url().split('/lab')[1]);
    await page.goto(`${BASE}/teacher/chapters/${CHAPTER_ID}/slides`, { waitUntil: 'domcontentloaded' });
    await page.getByText('章节幻灯片').first().waitFor({ timeout: 20000 });
    await page.locator('aside .ant-list-item').first().waitFor({ timeout: 15000 });
  } else {
    check('幻灯片页干净切换章节：直接跳转、无确认框', true, '单章节课程，跳过');
  }

  // 确保有 deck 可编辑：没有就用 mock 生成器现场生成（结束时删除，只删我们生成的）
  let createdDeck = false;
  if ((await page.locator('textarea').count()) === 0) {
    await page.getByRole('button', { name: /生成幻灯片/ }).click();
    await page.waitForFunction(
      () => !document.body.innerText.includes('正在生成幻灯片'),
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(1500);
    createdDeck = true;
  }
  const editorReady = (await page.locator('textarea').count()) > 0;
  check('幻灯片页有可编辑 deck', editorReady, createdDeck ? '现场生成（待清理）' : '已有');

  if (editorReady) {
    // 脏状态切章节：三键确认框 → 取消
    await page.locator('textarea').first().fill('[{"layout":"bullets","title":"守卫测试页","bullets":["a"]}]');
    await page.locator('aside .ant-list-item').last().click();
    await page.locator('.ant-modal-confirm').waitFor({ timeout: 5000 });
    const slideBtns = (await page.locator('.ant-modal-confirm .ant-btn').allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
    check('幻灯片页脏状态切章节：三键确认框', slideBtns.some((t) => t.includes('保存并切换')) && slideBtns.some((t) => t.includes('放弃修改并切换')) && slideBtns.some((t) => t.includes('取消')), slideBtns.join('/'));
    await page.locator('.ant-modal-confirm .ant-btn').filter({ hasText: /取\s*消/ }).click();
    await page.waitForTimeout(400);

    // 图片 tab：选图 → 在当前页后插入 → JSON 出现 file: 引用 → 放弃改动还原（不保存）
    await page.locator('aside .ant-tabs-tab').filter({ hasText: '图片' }).click();
    await page.waitForTimeout(1500);
    const sThumbs = page.locator('aside img');
    if ((await sThumbs.count()) > 0) {
      await sThumbs.first().click();
      await page.getByRole('button', { name: /在当前页后插入/ }).click();
      await page.waitForTimeout(500);
      const jt = await page.locator('textarea').first().inputValue();
      check('幻灯片页图片 tab：插图页进编辑区', jt.includes('file:'));
      await page.screenshot({ path: `${SHOTS_DIR}/slides-01-images-tab.png` });
      await page.getByRole('button', { name: '放弃改动' }).click();
      await page.waitForTimeout(300);
    } else {
      check('幻灯片页图片 tab：插图页进编辑区', true, '图库为空，跳过');
      await page.getByRole('button', { name: '放弃改动' }).click().catch(() => {});
    }

    // 清理：只删我们现场生成的 deck
    if (createdDeck) {
      await page.locator('button').filter({ has: page.locator('.anticon-delete') }).last().click();
      await page.locator('.ant-popconfirm .ant-btn-primary').click();
      // 删除成功的用户可观测信号 = 编辑器卸载、Empty 提示出现（别数 textarea：
      // rc-textarea autoSize 的隐藏测量副本等 antd 内部节点不可靠，2026-10-01 实测踩到）
      const emptyDesc = page.getByText('还没有幻灯片');
      await emptyDesc.waitFor({ timeout: 10000 }).catch(() => {});
      const deckGone = await emptyDesc.isVisible().catch(() => false);
      if (!deckGone) await page.screenshot({ path: `${SHOTS_DIR}/slides-cleanup-fail.png` }).catch(() => {});
      check('清理：删除现场生成的 deck', deckGone);
    }
  }
  // 10) 图片上传编辑器：裁剪/旋转/输出尺寸（POST /api/files 一律拦截回 mock，不污染生产图库）
  const uploadedBodies = [];
  await page.route(/\/api\/files/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    uploadedBodies.push(req.postDataBuffer());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: {
          fileId: '00000000-0000-0000-0000-000000000000',
          url: '/api/files/00000000-0000-0000-0000-000000000000',
          originalName: 'verify-upload.png',
          size: 1234,
          sha256: 'verify',
          mimeType: 'image/png',
          createdAt: new Date().toISOString(),
        },
      }),
    });
  });

  await page.goto(`${BASE}/teacher/chapters/${CHAPTER_ID}/edit`, { waitUntil: 'domcontentloaded' });
  await page.getByText('章节内容（Markdown）').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '插入图片' }).click();
  await page.waitForTimeout(1000);

  // 页面内造一张 200x100 PNG（红底白字），避免依赖 fixture 文件
  const pngBytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const x = c.getContext('2d');
    x.fillStyle = '#e74c3c';
    x.fillRect(0, 0, 200, 100);
    x.fillStyle = '#ffffff';
    x.font = '48px sans-serif';
    x.fillText('T', 88, 68);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.locator('aside input[type="file"]').setInputFiles({
    name: 'verify-upload.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pngBytes),
  });

  // 编辑器弹出：裁剪器 + 旋转/尺寸控件
  await page.locator('.ant-modal').filter({ hasText: '编辑图片' }).waitFor({ timeout: 5000 });
  const cropperVisible = await page.locator('.reactEasyCrop_Container').isVisible();
  check('上传弹出图片编辑器（裁剪器可见）', cropperVisible);
  await page.waitForTimeout(800); // 等 onCropComplete 初始化输出尺寸
  await page.screenshot({ path: `${SHOTS_DIR}/edit-05-image-editor.png` });
  const sizeInputs = page.locator('.ant-modal .ant-input-number input');
  const initW = await sizeInputs.nth(0).inputValue();
  const initH = await sizeInputs.nth(1).inputValue();
  check('输出尺寸默认跟随裁剪框（原图 200x100）', initW === '200' && initH === '100', `${initW}x${initH}`);

  // 右转 90° → 输出尺寸应变 100x200
  await page.locator('.ant-modal .anticon-rotate-right').click();
  await page.waitForFunction(
    () => {
      const inputs = document.querySelectorAll('.ant-modal .ant-input-number input');
      return inputs[0]?.value === '100' && inputs[1]?.value === '200';
    },
    null,
    { timeout: 5000 },
  );
  check('旋转 90° 后输出尺寸联动', true, '100x200');

  // 手改宽=50（锁定比例 → 高自动 100），确认上传 → 拦截到的 PNG 应为 50x100
  await sizeInputs.nth(0).fill('50');
  await page.waitForTimeout(300);
  const linkedH = await sizeInputs.nth(1).inputValue();
  await page.locator('.ant-modal-footer .ant-btn-primary').click();
  await page.waitForTimeout(1500);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const body = uploadedBodies[0];
  const at = body ? body.indexOf(pngSig) : -1;
  const gotW = at >= 0 ? body.readUInt32BE(at + 16) : 0;
  const gotH = at >= 0 ? body.readUInt32BE(at + 20) : 0;
  check('编辑后上传：旋转+缩放烘培进文件', linkedH === '100' && gotW === 50 && gotH === 100, `锁定高=${linkedH} 实际=${gotW}x${gotH}`);

  const newItem = page.locator('aside').getByText('verify-upload.png');
  check('新图出现在图库并被选中', (await newItem.count()) >= 1);

  // GIF/SVG 不进编辑器：直接传原图（选 SVG 验证）
  await page.locator('aside input[type="file"]').setInputFiles({
    name: 'verify-direct.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
  });
  await page.waitForTimeout(1000);
  const editorOpened = await page.locator('.ant-modal').filter({ hasText: '编辑图片' }).isVisible().catch(() => false);
  check('SVG 跳过编辑器直接上传', !editorOpened && uploadedBodies.length === 2, `编辑器${editorOpened ? '弹出' : '未弹出'} POST=${uploadedBodies.length}`);
  await page.unroute(/\/api\/files/).catch(() => {});
} catch (err) {
  check(`执行异常：${err.message}`, false);
  await page.screenshot({ path: `${SHOTS_DIR}/edit-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过${failed ? `，${failed} 项失败` : ''}`);
process.exit(failed ? 1 : 0);
