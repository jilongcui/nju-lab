/**
 * 学生端「文档 ⇄ 幻灯片」验证 —— 真实浏览器（Playwright + Chromium）
 *
 * 覆盖 2026-10-10 学员反馈的四项 + 顺带补齐的总览能力：
 *   ① 提示条在演示**下方**（此前在幻灯片上方，把演示画面往下挤）
 *   ② 右侧附栏有**课程章节目录**（此前只有一段说明文字），并标出当前章
 *   ③ 学生端也有「放映」（全屏）与「总览」（缩略图墙，此前运行时压根没实现）
 *   ④ 点「幻灯片」后按 ←/→ **不再被 Segmented 当成切换选项**跳回「文档」，而是直接翻页
 *
 * 用法：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-chapter-slides.mjs [chapterId]
 *
 * 机制：`--host-resolver-rules` 把 medai 指到 127.0.0.1 走线上 nginx 链路；API 登录后按
 * zustand persist 格式写 localStorage(`nju-lab-auth`) 注入会话（不走 UI 登录，避免误点 CAS）。
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOTS_DIR = new URL('./shots/review/chapter-slides/', import.meta.url).pathname;
mkdirSync(SHOTS_DIR, { recursive: true });

const SITE_HOST = 'medai.nju.edu.cn';
const BASE = `http://${SITE_HOST}/lab`;
// 第 7 章「向量数据库」：已生成 v2 语义 deck（18 页），且挂着章节目录
const CHAPTER_ID = process.argv[2] || '3d52759a-0b32-4e6e-a74c-9febc2d44d14';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors'],
});

async function openSession(username, password) {
  const loginJson = await fetch('http://127.0.0.1:3100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then((r) => r.json());
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

/** 幻灯片 iframe（sandbox 无 same-origin，但 Playwright 走 CDP 仍可访问其 frame） */
async function deckFrame(page) {
  for (let i = 0; i < 20; i += 1) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        if (await frame.evaluate(() => !!document.querySelector('.deck'))) return frame;
      } catch {
        /* opaque origin 下个别 frame 读不到，跳过 */
      }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

const { context, page } = await openSession('student1', 'student123');
try {
  await page.goto(`${BASE}/student/chapters/${CHAPTER_ID}`, { waitUntil: 'networkidle', timeout: 40000 });

  // ---------------- ② 右侧附栏：课程章节目录 ----------------
  const aux = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="/student/chapters/"]')];
    return { count: links.length, current: links.filter((a) => /当前/.test(a.innerText)).length };
  });
  check('右侧附栏展示课程章节目录（≥10 章）', aux.count >= 10, `链接 ${aux.count} 个`);
  check('目录中标出当前章（有且仅有一个「当前」）', aux.current === 1, `当前标记 ${aux.current} 个`);
  await page.screenshot({ path: `${SHOTS_DIR}01-doc-with-catalog.png` });

  // ---------------- 切到幻灯片 ----------------
  const seg = page.locator('.ant-segmented-item', { hasText: '幻灯片' }).first();
  check('学生端能看到「文档 / 幻灯片」切换（老师已准备课件）', (await seg.count()) > 0);
  await seg.click();
  await page.waitForTimeout(3000);
  const activeSeg = () =>
    page.evaluate(() => document.querySelector('.ant-segmented-item-selected')?.innerText?.trim() ?? null);
  check('切换后处于「幻灯片」视图', (await activeSeg()) === '幻灯片', String(await activeSeg()));

  const frame = await deckFrame(page);
  check('幻灯片文档已加载（iframe 内 .deck 就绪）', !!frame);
  const pageCount = frame ? await frame.evaluate(() => document.querySelectorAll('.slide').length) : 0;
  check('幻灯片有内容（页数 ≥ 2）', pageCount >= 2, `页数 ${pageCount}`);

  // ---------------- ① 提示条在演示下方 ----------------
  const geo = await page.evaluate(() => {
    const ifr = document.querySelector('iframe');
    const alert = [...document.querySelectorAll('.ant-alert')].find((a) => /在线演示/.test(a.innerText));
    return {
      iframeBottom: ifr ? Math.round(ifr.getBoundingClientRect().bottom) : null,
      alertTop: alert ? Math.round(alert.getBoundingClientRect().top) : null,
    };
  });
  check(
    '提示条位于演示画面下方（不再挤压幻灯片）',
    geo.alertTop !== null && geo.iframeBottom !== null && geo.alertTop >= geo.iframeBottom,
    `iframe bottom=${geo.iframeBottom} alert top=${geo.alertTop}`,
  );

  // ---------------- ③ 学生端也有「放映」与「总览」 ----------------
  check('有「放映」按钮（全屏演示）', (await page.locator('button:has-text("放映")').count()) > 0);
  check('有「总览」按钮（缩略图墙）', (await page.locator('button:has-text("总览")').count()) > 0);

  // ---------------- ④ 焦点：←/→ 直接翻页，不再跳回「文档」 ----------------
  const deckIndex = () =>
    page.evaluate(() => {
      const text = document.body.innerText.match(/第\s*(\d+)\s*页/);
      return text ? Number(text[1]) : null;
    });
  const before = await deckIndex();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  const after = await deckIndex();
  check('点开幻灯片后按 → 仍停在「幻灯片」视图', (await activeSeg()) === '幻灯片', String(await activeSeg()));
  check('点开幻灯片后按 → 翻到下一页', after !== null && before !== null && after === before + 1, `${before} → ${after}`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(700);
  check('按 ← 退回上一页', (await deckIndex()) === before, `回到 ${await deckIndex()}`);
  await page.screenshot({ path: `${SHOTS_DIR}02-slides-view.png` });

  // ---------------- 总览：打开 / 缩略图数量 / 点击跳页 ----------------
  const overviewOpen = async () => {
    const f = await deckFrame(page);
    if (!f) return null;
    return f.evaluate(() => {
      const ov = document.querySelector('.overview');
      return {
        open: !!ov && ov.className.split(' ').indexOf('open') >= 0,
        thumbs: ov ? ov.querySelectorAll('.thumb').length : 0,
        canvases: ov ? ov.querySelectorAll('.thumb-canvas.deck').length : 0,
      };
    });
  };
  await page.locator('button:has-text("总览")').click();
  await page.waitForTimeout(1200);
  const ov = await overviewOpen();
  check('点「总览」打开缩略图墙', !!ov?.open);
  check('缩略图数量 = 幻灯片页数', ov?.thumbs === pageCount, `${ov?.thumbs} / ${pageCount}`);
  check('缩略图容器复用舞台样式（带 deck 类）', ov?.canvases === pageCount, `${ov?.canvases}`);
  // ⚠️ 必须有内容：曾出现"总览打开了但缩略图全空白"（先量宽度后 open，clientWidth=0 → scale(0)）
  const thumbGeo = frame
    ? await frame.evaluate(() => {
        const box = document.querySelector('.overview .thumb-canvas');
        const thumb = box?.parentNode;
        return {
          clones: document.querySelectorAll('.overview .thumb-canvas .slide').length,
          visible: document.querySelectorAll('.overview .thumb-canvas .slide.is-active').length,
          canvasWidth: box ? Math.round(box.getBoundingClientRect().width) : 0,
          thumbWidth: thumb ? Math.round(thumb.getBoundingClientRect().width) : 0,
        };
      })
    : null;
  check(
    '缩略图带克隆页内容（每页一个 .slide 且可见）',
    thumbGeo?.clones === pageCount && thumbGeo?.visible === pageCount,
    `克隆 ${thumbGeo?.clones} / 可见 ${thumbGeo?.visible}`,
  );
  check(
    '缩略图已等比缩放到容器宽（不是空白）',
    !!thumbGeo && thumbGeo.canvasWidth > 50 && Math.abs(thumbGeo.canvasWidth - thumbGeo.thumbWidth) <= 2,
    `canvas ${thumbGeo?.canvasWidth}px vs thumb ${thumbGeo?.thumbWidth}px`,
  );
  await page.screenshot({ path: `${SHOTS_DIR}03-overview.png` });
  // 点第 3 张缩略图 → 跳到第 3 页并关闭总览
  if (ov?.thumbs >= 3 && frame) {
    await frame.evaluate(() => document.querySelectorAll('.overview .thumb')[2].click());
    await page.waitForTimeout(800);
    const jumped = await deckIndex();
    const closed = await overviewOpen();
    check('点缩略图跳到对应页并关闭总览', jumped === 3 && !closed.open, `第 ${jumped} 页, open=${closed.open}`);
  } else {
    check('点缩略图跳到对应页并关闭总览', false, '缩略图不足 3 张');
  }

  // ---------------- 放映：全屏 / Esc 退出 ----------------
  await page.locator('button:has-text("放映")').click();
  await page.waitForTimeout(1500);
  const presentingStyle = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (d) => getComputedStyle(d).position === 'fixed' && getComputedStyle(d).inset === '0px',
    );
    return el ? { fixed: true, bg: getComputedStyle(el).backgroundColor } : { fixed: false };
  });
  check('点「放映」进入全屏演示（fixed 覆盖视口）', presentingStyle.fixed, JSON.stringify(presentingStyle));
  await page.screenshot({ path: `${SHOTS_DIR}04-presenting.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  const stillPresenting = await page.evaluate(
    () =>
      [...document.querySelectorAll('div')].some(
        (d) => getComputedStyle(d).position === 'fixed' && getComputedStyle(d).inset === '0px',
      ),
  );
  check('Esc 退出放映，回到页面内嵌视图', !stillPresenting);

  // ---------------- 切回「文档」正常 ----------------
  await page.locator('.ant-segmented-item', { hasText: '文档' }).first().click();
  await page.waitForTimeout(1200);
  const docVisible = await page.evaluate(() => !!document.querySelector('.markdown-view'));
  check('切回「文档」正常渲染正文', docVisible);
} finally {
  await context.close();
  await browser.close();
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(([label]) => console.log('  ·', label));
  process.exitCode = 1;
}
