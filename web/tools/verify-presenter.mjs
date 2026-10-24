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
 *   ⑤ 批注白板：画线、光点、翻页清空（两边一致）
 *   ⑥ 性能回归：移动鼠标**不重建 deck**、观众窗口光点不丢帧（演示模式卡顿的根因，见 ⑥ 段注释）
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
/** 「下一页」预告距窗口右边/底边的距离（px）；找不到元素返回 null */
const previewGaps = () =>
  presenter.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      d.children.length === 0 && d.textContent?.startsWith('下一页：'),
    );
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      right: Math.round(window.innerWidth - rect.right),
      bottom: Math.round(window.innerHeight - rect.bottom),
    };
  });

check('① 有下一页预告', presenterText.includes('下一页：'), presenterText.match(/下一页：.{0,16}/)?.[0] ?? '');
const gapClosed = await previewGaps();
check(
  '① 预告在右下角（距右/底各 < 40px）',
  gapClosed !== null && gapClosed.right < 40 && gapClosed.bottom < 40,
  `距右=${gapClosed?.right} 距底=${gapClosed?.bottom}`,
);
check('① 讲稿默认不显示（没按 S 时看不到）', !(await notesVisible()));
await presenter.bringToFront();
await presenter.keyboard.press('s');
await presenter.waitForTimeout(700);
check('① 按 S 呼出讲稿浮层后能看到讲稿', await notesVisible(), `探针=${notesProbe.slice(0, 8)}…`);
// 讲稿分两层（prompt v12）：`[ …… ]` 是给讲者的**备课提示**（不念出来），渲染成 .notes-cue（斜体压淡）。
// 第 1 页讲稿里若有方括号片段，浮层里就必须有对应的 .notes-cue —— 否则弱化没生效（两种口吻又混在一起了）。
// 没写 `[ ]` 的旧 deck 跳过这条（[ ] 是约定不是结构，旧 deck 不需要重生成）。
const cueProbe = (String(slides[0]?.notes ?? '').match(/[\[［][^\[\]［］\n]{1,120}[\]］]/) ?? [])[0] ?? '';
if (cueProbe) {
  let cueOk = false;
  for (const frame of presenter.frames()) {
    try {
      cueOk = await frame.evaluate(
        (probe) => [...document.querySelectorAll('.notes-cue')].some((el) => el.textContent === probe),
        cueProbe,
      );
    } catch {
      /* 跨域/已销毁的 frame 跳过 */
    }
    if (cueOk) break;
  }
  check(
    '① 讲稿里的 [ …… ] 备课提示渲染成 .notes-cue（弱化成提示，不是口播）',
    cueOk,
    `探针=${cueProbe.slice(0, 16)}…`,
  );
}
const gapOpen = await previewGaps();
check(
  '① 浮层打开时预告上移、让开浮层（仍在右侧）',
  gapOpen !== null && gapClosed !== null && gapOpen.bottom > gapClosed.bottom && gapOpen.right < 40,
  `闭合 距底=${gapClosed?.bottom} → 打开 距底=${gapOpen?.bottom}（距右=${gapOpen?.right}）`,
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

// ⑤ 批注（白板）：讲者画线 → 两边都出现；指针同步；翻页清空
const countStrokes = (page) =>
  page.evaluate(() => document.querySelectorAll('[data-annotation="stroke"]').length);
const hasPointer = (page) =>
  page.evaluate(() => !!document.querySelector('[data-annotation="pointer"]'));

await presenter.bringToFront();
const box = await presenter.locator('div:has(> svg)').first().boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await presenter.mouse.move(cx - 120, cy - 60);
await presenter.mouse.down();
await presenter.mouse.move(cx, cy, { steps: 6 });
await presenter.mouse.move(cx + 120, cy + 60, { steps: 6 });
await presenter.mouse.up();
await presenter.waitForTimeout(500);

check('⑤ 讲者窗口画出线了', (await countStrokes(presenter)) === 1, `strokes=${await countStrokes(presenter)}`);
check('⑤ 观众窗口收到同一条线', (await countStrokes(audience)) === 1, `strokes=${await countStrokes(audience)}`);
await presenter.mouse.move(cx + 40, cy - 30);
await presenter.waitForTimeout(300);
check('⑤ 观众窗口出现讲者的光标光点', await hasPointer(audience));

// ⑥ 性能回归（2026-10-17 现场：MacBook 演示模式下投影上的光标严重滞后）
//    根因不是 BroadcastChannel，而是"每移动一次鼠标就重拼一整份 deck 文档"：
//    父组件里 pointer 是顶层 state，鼠标一动就整页重渲染，`SlideStage` 又拿到"新引用但等值"的
//    template / slideTheme / meta → 构建 effect 重跑（实测 1 秒 22 次、约 400ms 主线程），
//    同步消息于是排队，端到端延迟 p50 196ms / p95 369ms，30 次移动只更新 15 次。
//    修法见 SlideStage 的 builtInputsRef（按值比输入 + 只在构建成功后记账）。
//    这里用 SlideStage 打的 mark 数断言"不重建"，并顺带断言光点跟得上（丢帧说明又积压了）。
const deckBuilds = (page) =>
  page.evaluate(
    (name) => performance.getEntriesByType('mark').filter((e) => e.name === name).length,
    'nju-lab:deck-build',
  );
await audience.evaluate(() => {
  window.__pointerUpdates = 0;
  let last = '';
  new MutationObserver(() => {
    const circles = document.querySelectorAll('[data-annotation="pointer"] circle');
    const el = circles[circles.length - 1];
    if (!el) return;
    const key = `${el.getAttribute('cx')},${el.getAttribute('cy')}`;
    if (key === last) return;
    last = key;
    window.__pointerUpdates += 1;
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['cx', 'cy'],
  });
});
await presenter.bringToFront();
const buildsBefore = await deckBuilds(presenter);
const MOVES = 20;
for (let i = 0; i < MOVES; i += 1) {
  await presenter.mouse.move(cx + Math.sin(i / 3) * 260, cy + Math.cos(i / 3) * 110);
  await presenter.waitForTimeout(16);
}
await presenter.waitForTimeout(200);
const buildsAfter = await deckBuilds(presenter);
const pointerUpdates = await audience.evaluate(() => window.__pointerUpdates);
check(
  '⑥ 移动鼠标不重建 deck（演示模式卡顿的根因）',
  // `buildsBefore > 0`：先确认这份构建真的发生过 —— 否则"0 → 0"会假装通过
  buildsBefore > 0 && buildsAfter === buildsBefore,
  `构建次数 ${buildsBefore} → ${buildsAfter}`,
);
check(
  '⑥ 观众窗口光点跟得上（不丢帧、不积压）',
  pointerUpdates >= MOVES * 0.7,
  `${MOVES} 次移动 → 光点更新 ${pointerUpdates} 次`,
);

await presenter.keyboard.press('ArrowRight');
await presenter.waitForTimeout(600);
check(
  '⑤ 翻页自动清除批注（两边都清）',
  (await countStrokes(presenter)) === 0 && (await countStrokes(audience)) === 0,
  `讲者=${await countStrokes(presenter)} 观众=${await countStrokes(audience)}`,
);
await presenter.keyboard.press('ArrowLeft');
await presenter.waitForTimeout(500);

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
