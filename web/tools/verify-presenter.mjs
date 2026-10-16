#!/usr/bin/env node
/**
 * 讲者视图（双窗口）验证 —— 真实浏览器（Playwright + Chromium）
 *
 * 背景（2026-10-17）：讲稿（notes）按惯例对观众隐藏（deck 里 `display:none`），但教师放映时
 * 按 `S` 呼出的浮层是画在**同一个画面**上的 —— 单屏投出去，学生也能看到讲稿。
 * 改法：讲者窗口 = 幻灯片 + 讲稿 + 计时；另开一个「观众窗口」投屏，那里**只有幻灯片**。
 * 两个窗口用 BroadcastChannel 同步页码（本站是 HTTP，`getScreenDetails()` 这类自动投屏 API 不可用，
 * 观众窗口需手动拖到投影屏 + F11）。
 *
 * 覆盖：
 *   ① 讲者窗口：出现「讲者视图」按钮，点开后本窗口显示讲稿与计时
 *   ② 观众窗口：URL 带 `audience=1`、**页面里一个字讲稿都没有**、也没有放映控件
 *   ③ 翻页同步：讲者窗口翻页后，观众窗口跟到同一页
 *
 * 用法（本地联调：后端 3100 + 前端 dev 5199）：
 *   cd web && npx vite --port 5199 --strictPort &
 *   VERIFY_BASE=http://127.0.0.1:5199 VERIFY_API=http://127.0.0.1:3100/api \
 *     node web/tools/verify-presenter.mjs [chapterId]
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

// ⚠️ 必须在 playwright 被加载**之前**设好，否则它会去默认的 /tmp/ms-playwright 找浏览器 ——
// 所以这里用动态 import（静态 import 会被提升到模块体之前执行）。
process.env.PLAYWRIGHT_BROWSERS_PATH ||= join(homedir(), '.cache', 'ms-playwright');
const { chromium } = await import('playwright');

const BASE = (process.env.VERIFY_BASE || 'http://127.0.0.1:5199').replace(/\/+$/, '');
const API = (process.env.VERIFY_API || 'http://127.0.0.1:3100/api').replace(/\/+$/, '');
/** 默认用第 1 章《人工智能发展概论》（已有生成的 deck） */
const CHAPTER_ID = process.argv[2] || '7070707c-0d96-4162-aac2-5650e0e277a2';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

const login = async () => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const body = await res.json();
  if (!body?.data?.accessToken) throw new Error('登录失败：' + JSON.stringify(body).slice(0, 160));
  return { token: body.data.accessToken, user: body.data.user };
};
const { token, user } = await login();

// 拿第 1 页的真实讲稿，作为"观众窗口里绝对不能出现"的探针
const deckRes = await fetch(`${API}/chapters/${CHAPTER_ID}/slides`, {
  headers: { Authorization: `Bearer ${token}` },
});
const deckBody = await deckRes.json();
const slides = deckBody?.data?.deck?.slides ?? deckBody?.deck?.slides ?? [];
const notesProbe = String(slides[0]?.notes ?? '').trim().slice(0, 12);
if (!notesProbe) throw new Error('该章节第 1 页没有讲稿，无法验证"观众看不到讲稿"');
console.log(`探针讲稿（第 1 页前 12 字）：${notesProbe}\n`);

// 打线上时把域名指到本机（走真实 nginx 链路），与其它 verify 脚本一致
const SITE_HOST = 'medai.nju.edu.cn';
const browser = await chromium.launch({
  args: BASE.includes(SITE_HOST)
    ? [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors']
    : [],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// 登录态：与平台前端一致（zustand persist 的 key）
await context.addInitScript(
  ([tk, u]) => {
    // ⚠️ 只在顶层窗口注入：addInitScript 会注入到**所有 frame**，而幻灯片 iframe 是 opaque origin
    // （sandbox 无 allow-same-origin），在它里面碰 localStorage 会抛 SecurityError（实测会刷错误日志）。
    if (window.top !== window) return;
    localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: tk, user: u }, version: 0 }));
    // deck 运行时会向父窗口回传当前页；把它写到 title，便于跨窗口读取（iframe 是 sandbox，读不了 DOM）
    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.__deck === true && typeof data.index === 'number') {
        document.title = `deck-index:${data.index}`;
      }
    });
  },
  [token, user],
);

const presenter = await context.newPage();
presenter.on('pageerror', (e) => console.log('  ⚠ 讲者窗口 JS 错误:', e.message.slice(0, 120)));
await presenter.goto(`${BASE}/teacher/chapters/${CHAPTER_ID}/slides`, { waitUntil: 'networkidle' });
await presenter.waitForTimeout(1500);

const hasButton = await presenter.locator('button:has-text("讲者视图")').count();
check('讲者端出现「讲者视图」按钮', hasButton > 0, `count=${hasButton}`);

// 点讲者视图 → 会开一个新窗口
const [audience] = await Promise.all([
  context.waitForEvent('page', { timeout: 15000 }),
  presenter.locator('button:has-text("讲者视图")').first().click(),
]);
await audience.waitForLoadState('networkidle');
await audience.waitForTimeout(2000);

check('观众窗口 URL 带 audience=1', audience.url().includes('audience=1'), audience.url());
const audienceText = (await audience.evaluate(() => document.body.innerText)).replace(/\s+/g, '');
const presenterText = (await presenter.evaluate(() => document.body.innerText)).replace(/\s+/g, '');
// 讲稿在 iframe 里（deck 自带的底部浮层），父窗口的 innerText 读不到 → 进 frame 读
const notesVisible = async () => {
  for (const frame of presenter.frames()) {
    try {
      const text = await frame.evaluate(() => document.body.innerText);
      if (text.includes(notesProbe)) return true;
    } catch {
      /* 跨域/已销毁的 frame 跳过 */
    }
  }
  return false;
};
check('① 讲者视图顶部有计时与观众窗口开关', /⏱/.test(presenterText) && presenterText.includes('观众窗口'));
/** 「下一页」预告底边距窗口底的距离（px）；找不到元素返回 null */
const previewBottomGap = () =>
  presenter.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      d.children.length === 0 && d.textContent?.startsWith('下一页：'),
    );
    if (!el) return null;
    return Math.round(window.innerHeight - el.getBoundingClientRect().bottom);
  });

check('① 底部有下一页预告', presenterText.includes('下一页：'), presenterText.match(/下一页：.{0,16}/)?.[0] ?? '');
const gapClosed = await previewBottomGap();
check('① 预告贴底（距窗口底 < 40px）', gapClosed !== null && gapClosed < 40, `gap=${gapClosed}`);
check('① 讲稿默认不显示（没按 S 时看不到）', !(await notesVisible()));
await presenter.bringToFront();
await presenter.keyboard.press('s');
await presenter.waitForTimeout(700);
check('① 按 S 呼出讲稿浮层后能看到讲稿', await notesVisible(), `探针=${notesProbe.slice(0, 8)}…`);
const gapOpen = await previewBottomGap();
check(
  '① 浮层打开时预告上移、让开浮层',
  gapOpen !== null && gapClosed !== null && gapOpen > gapClosed,
  `闭合 gap=${gapClosed} → 打开 gap=${gapOpen}`,
);
await presenter.keyboard.press('s');
await presenter.waitForTimeout(400);
check('② 观众窗口里一个字讲稿都没有', !audienceText.includes(notesProbe.replace(/\s+/g, '')));
check('② 观众窗口没有放映控件（退出/Esc 按钮）', !audienceText.includes('退出（Esc）'));
check(
  '② 观众窗口没有讲者面板（下一页/讲稿）',
  !audienceText.includes('下一页') && !audienceText.includes('讲稿'),
  audienceText.slice(0, 120),
);

// 翻页同步：讲者窗口按 → ，观众窗口应跟到第 2 页
await presenter.bringToFront();
await presenter.keyboard.press('ArrowRight');
await presenter.waitForTimeout(1200);
const audienceIndex = await audience.title();
check('③ 翻页同步：讲者翻页后观众跟到第 2 页', audienceIndex === 'deck-index:1', `title=${audienceIndex}`);

await presenter.bringToFront();
await presenter.keyboard.press('ArrowRight');
await presenter.waitForTimeout(1200);
const audienceIndex2 = await audience.title();
check('③ 再翻一页：观众跟到第 3 页', audienceIndex2 === 'deck-index:2', `title=${audienceIndex2}`);

// ④ 观众窗口那个按钮是**开关**：开着时点一下应关掉，再点又开
await presenter.bringToFront();
await presenter.locator('button:has-text("观众窗口")').first().click();
await presenter.waitForTimeout(1200);
check('④ 点「观众窗口 ✓」会把观众窗口关掉', audience.isClosed());

const [audience2] = await Promise.all([
  context.waitForEvent('page', { timeout: 15000 }),
  presenter.locator('button:has-text("打开观众窗口")').first().click(),
]);
await audience2.waitForLoadState('networkidle');
await audience2.waitForTimeout(1500);
check('④ 再点一次又打开（按钮是开关，不是"重开"）', audience2.url().includes('audience=1'), audience2.url());

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
