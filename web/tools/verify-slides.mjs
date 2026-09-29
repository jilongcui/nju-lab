/**
 * 章节在线幻灯片 —— 真实浏览器验证（Playwright + Chromium）
 *
 * 为什么要有它：交互类问题（鼠标点击、键盘、Esc）**只能**在真实浏览器里断言，读代码推断会漏；
 * 版式/观感问题靠它出的截图一眼就能看出（2026-09-29 就是靠截图发现"要点溢出被裁"等问题）。
 *
 * 前置：
 *   1) 依赖：本目录所在 web 项目的 devDependency `playwright`（`npm i -D playwright`）
 *   2) 浏览器二进制：`npx playwright install chromium` —— ⚠️ 装到持久位置，别用默认的 /tmp：
 *        npx playwright install chromium                      # 若默认落到 /tmp/ms-playwright 会被清
 *        （我们把它放在 ~/.cache/ms-playwright，跑脚本时显式指路径）
 *   3) 系统依赖（Ubuntu 22.04，缺了 Chromium 起不来；中文字体缺了截图全是豆腐块）：
 *        sudo apt-get install -y libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
 *          libcairo2 libcups2 libgbm1 libpango-1.0-0 libxdamage1 libxkbcommon0 \
 *          fonts-liberation fonts-unifont fonts-noto-cjk fonts-wqy-zenhei
 *
 * 用法：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-slides.mjs [chapterId]
 *
 * 说明：
 *   · 通过 `--host-resolver-rules` 把 medai.nju.edu.cn 指到 127.0.0.1，全程走线上 nginx 链路
 *   · 登录走**后端 API**（不点登录页）：Playwright 的 name 是子串匹配，`name: '登录'` 会误点
 *     「统一认证登录」把页面带去 CAS；拿到 token 后按 zustand persist 格式写 localStorage(`nju-lab-auth`)
 *   · 页码从 iframe 的 postMessage 事件读（演示 iframe 是 opaque origin，读不到它的 DOM）
 *   · 结束后自动清理本次生成的 deck（不留生产数据）
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

/** 截图落仓库内（已在 .gitignore 里），避免依赖仓库外的写权限 */
const SHOTS_DIR = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS_DIR, { recursive: true });

const SITE_HOST = 'medai.nju.edu.cn';
const BASE = `http://${SITE_HOST}/lab`;
const CHAPTER_ID = process.argv[2] || '6133aea6-b85c-480f-ac9a-079820a8cef5';

const results = [];
/** 提升到外层：finally 里的清理也要用它 */
let token = null;
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// 采集 iframe 回传的翻页事件（opaque origin 读不到 DOM，但 postMessage 能收到）
await page.addInitScript(() => {
  window.__deckEvents = [];
  window.addEventListener('message', (event) => {
    if (event.data && event.data.__deck === true) window.__deckEvents.push(event.data);
  });
});
const lastIndex = async () => {
  const events = await page.evaluate(() => window.__deckEvents || []);
  const changed = events.filter((e) => e.type === 'slidechanged' || e.type === 'ready');
  return changed.length ? changed[changed.length - 1].index : -1;
};

try {
  // 1) 登录：直接用后端 API 拿 token，再按 zustand persist 的格式写进 localStorage。
  //    不走 UI 登录的原因：Playwright 的 name 默认是**子串**匹配，`name: '登录'` 会命中
  //    「统一认证登录」按钮，从而被带去 CAS（实测踩过）。
  const loginRes = await fetch('http://127.0.0.1:3100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password: 'teacher123' }),
  });
  const loginJson = await loginRes.json();
  token = loginJson?.data?.accessToken;
  const user = loginJson?.data?.user;
  if (!token) throw new Error('API 登录失败：' + JSON.stringify(loginJson).slice(0, 200));
  await context.addInitScript(
    ([t, u]) => {
      localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: t, user: u }, version: 0 }));
    },
    [token, user],
  );
  check('API 登录并注入会话', true, 'teacher');

  // 2) 直接进章节幻灯片页
  await page.goto(`${BASE}/teacher/chapters/${CHAPTER_ID}/slides`, { waitUntil: 'domcontentloaded' });
  await page.getByText('章节幻灯片').first().waitFor({ timeout: 20000 });
  check('进入幻灯片页', true);

  // 3) 生成（mock 生成器，很快）
  const genBtn = page.getByRole('button', { name: /生成幻灯片|重新生成/ }).first();
  await genBtn.click();
  await page.waitForFunction(
    () => !document.body.innerText.includes('正在生成幻灯片'),
    null,
    { timeout: 60000 },
  );
  const pageCount = await page.locator('div[style*="cursor: pointer"]').count();
  check('生成完成（左侧页列表出现）', pageCount > 1, `${pageCount} 页`);

  // 4) 放映
  await page.getByRole('button', { name: '放映' }).click();
  await page.waitForTimeout(3500); // 等 iframe 内 reveal ready
  const size = page.viewportSize();
  const rightX = Math.round(size.width * 0.85);
  const leftX = Math.round(size.width * 0.15);
  const midY = Math.round(size.height * 0.5);

  const start = await lastIndex();
  check('放映已就绪（收到 ready/slidechanged）', start >= 0, `index=${start}`);

  // 5) 关键：鼠标点击右侧区域 → 应前进（线上反馈的"点击没反应"）
  await page.mouse.click(rightX, midY);
  await page.waitForTimeout(900);
  const afterRight = await lastIndex();
  check('鼠标点右侧区域 → 前进', afterRight === start + 1, `${start} → ${afterRight}`);

  // 6) 鼠标点击左侧区域 → 应后退
  await page.mouse.click(leftX, midY);
  await page.waitForTimeout(900);
  const afterLeft = await lastIndex();
  check('鼠标点左侧区域 → 后退', afterLeft === afterRight - 1, `${afterRight} → ${afterLeft}`);

  // 7) 右下角 reveal 控件的箭头（原 bug 就出在这里被浮层遮挡）
  await page.mouse.click(Math.round(size.width * 0.955), Math.round(size.height * 0.93));
  await page.waitForTimeout(900);
  const afterControls = await lastIndex();
  check('右下角控件箭头 → 前进（原遮挡 bug）', afterControls === afterLeft + 1, `${afterLeft} → ${afterControls}`);

  // 8) 键盘仍然可用
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  const afterKey = await lastIndex();
  check('键盘 → 前进', afterKey === afterControls + 1, `${afterControls} → ${afterKey}`);

  // 8.5) 翻页后不应有常驻 loading（2026-09-29 Spin 常驻 bug 回归：
  // 父组件行内 template 对象 → 等价输入反复触发重建态，iframe 不重载、ready 永不再发）
  await page.waitForTimeout(500);
  const spinVisible = await page.evaluate(() =>
    [...document.querySelectorAll('.ant-spin')].some((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }),
  );
  check('放映中翻页后无常驻 loading（Spin 回归）', !spinVisible);

  // 放映态截图（在 Esc 之前拍）
  await page.screenshot({ path: `${SHOTS_DIR}presenting.png` });

  // 9) Esc 退出放映：直接在 **iframe 内** 派发按键（模拟"用户点过幻灯片、焦点在 iframe 里"）
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await page.waitForTimeout(1000);
  const exitBtn = await page.getByRole('button', { name: /退出/ }).count();
  check('Esc（焦点在 iframe 内）能退出放映', exitBtn === 0, `剩余退出按钮=${exitBtn}`);

  // 10) 截图（编辑态；放映态截图在上一步 Esc 之前补拍）
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS_DIR}editor.png`, fullPage: false });
  check('截图已保存', true, `${SHOTS_DIR}presenting.png · editor.png`);
} catch (error) {
  check(`执行异常：${error.message}`, false);
} finally {
  // 清理：删掉本次验证生成的 deck（别在生产库留垃圾）
  try {
    if (!token) throw new Error('未登录成功，无法清理');
    await fetch(`http://127.0.0.1:3100/api/chapters/${CHAPTER_ID}/slides`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('  · 已清理本次验证生成的 deck');
  } catch (e) {
    console.log('  · deck 清理失败（需手动删）：', e.message);
  }
  await browser.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log('\n结论：', failed.length ? failed.map(([l]) => l).join(' / ') + ' ✗' : '全部通过 ✓');
  process.exit(failed.length ? 1 : 0);
}
