/**
 * 幻灯片**溢出检测** —— 固定 1920×1080 画布下，逐页检查是否有元素越出安全区。
 *
 * 为什么需要：固定画布不会自动排版，内容一多（长代码块 + 图、多步流程图…）就会顶掉页脚。
 * 2026-10-12 实测就抓到 3 页溢出（第 2 章 code+图 页超出 72px）。
 * 渲染层已有「自动缩放兜底」（content 超出安全高度时整页等比缩小），本脚本用来**验证兜底有效**。
 *
 * 用法：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/verify-slides-overflow.mjs [courseId]
 *
 * 说明：走线上 nginx 链路；逐章进放映态翻页测量（每页停留 ≥500ms 等过渡结束 —— 太短会把
 * 上一页的过渡残影拍进来）；同时报告哪些页触发了缩放、缩放比多少（越小说明内容越密）。
 */
import { chromium } from 'playwright';

const SITE_HOST = 'medai.nju.edu.cn';
const BASE = `http://${SITE_HOST}/lab`;
const API = 'http://127.0.0.1:3100/api';
const COURSE_ID = process.argv[2] || 'cd11ea33-0f1f-420a-afbc-951baf1f5e89';
/** 画布 1920×1080，页内容安全高度 = 1080 − 上下留白（与 layouts.css 对应） */
const SAFE_H = 1080 - 2 * 72;

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'teacher', password: 'teacher123' }),
}).then((r) => r.json());
const token = login?.data?.accessToken;
if (!token) throw new Error('teacher 登录失败：' + JSON.stringify(login).slice(0, 160));

const chapters = await fetch(`${API}/courses/${COURSE_ID}/chapters`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
const list = (Array.isArray(chapters) ? chapters : chapters.data ?? []).sort((a, b) => a.order - b.order);

const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors'],
});
const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
await context.addInitScript(
  ([t, u]) => localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: t, user: u }, version: 0 })),
  [token, login.data.user],
);
const page = await context.newPage();

let totalBad = 0;
let totalPages = 0;
const scaled = [];
for (const ch of list) {
  const deck = await fetch(`${API}/chapters/${ch.id}/slides`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const slides = (deck.data ?? deck).deck?.slides ?? [];
  if (!slides.length) continue;
  totalPages += slides.length;

  await page.goto(`${BASE}/teacher/chapters/${ch.id}/slides`, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '放映' }).click();
  await page.waitForTimeout(2600);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const bad = [];
  for (let i = 0; i < slides.length; i += 1) {
    await page.waitForTimeout(520); // 等过渡结束，避免把上一页残影算进来
    const rep = await frame.evaluate((safeH) => {
      const el = document.querySelector('.slide.is-active');
      if (!el) return null;
      const pr = el.getBoundingClientRect();
      let over = 0;
      let worst = '';
      for (const node of el.querySelectorAll('*')) {
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const o = Math.max(Math.round(r.bottom - (pr.top + 1080)), Math.round(r.right - (pr.left + 1920)));
        if (o > over) {
          over = o;
          worst = (node.className || node.tagName).toString().slice(0, 30);
        }
      }
      const ly = el.querySelector('.ly');
      // 读"未缩放"的原始内容高度：先保存、复位、量、再还原（别把缩放状态弄坏）
      const saved = ly.style.transform;
      ly.style.transform = '';
      const h = ly.offsetHeight;
      ly.style.transform = saved;
      return { over, worst, h, safeH };
    }, SAFE_H);
    if (rep && rep.over > 1) bad.push(`第 ${i + 1} 页（${rep.worst} 超出 ${rep.over}px）`);
    if (rep && rep.h > SAFE_H) scaled.push(`第 ${ch.order} 章 p${i + 1}：内容高 ${rep.h}px → 缩放至 ${(SAFE_H / rep.h * 100).toFixed(0)}%`);
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  totalBad += bad.length;
  console.log(`${bad.length ? '✗' : '✓'} 第 ${ch.order} 章 ${String(ch.title).slice(0, 22)}（${slides.length} 页）${bad.length ? '：' + bad.join('、') : ''}`);
}
await browser.close();

console.log(`\n共检查 ${list.length} 章 / ${totalPages} 页；**越界页 ${totalBad}**`);
if (scaled.length) {
  console.log(`触发自动缩放的页（内容较密，缩放比越小越密）：`);
  scaled.forEach((s) => console.log('  · ' + s));
}
if (totalBad > 0) process.exitCode = 1;
