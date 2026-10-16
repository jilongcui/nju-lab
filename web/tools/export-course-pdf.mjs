/**
 * 把整门课程的幻灯片导出成一份 PDF（每页后附讲稿备注页）。
 *
 * 用法：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/export-course-pdf.mjs [courseId] [输出目录]
 *
 * 依赖：pdf-lib（合并用，仓库不装它，按需临时装到 /tmp/pdftools）：
 *   mkdir -p /tmp/pdftools && npm i --prefix /tmp/pdftools pdf-lib
 *
 * 走的是**线上真实链路**（打开章节幻灯片页 → 勾「附讲稿」→ 导出 → 捕获打印窗口 → pdf()），
 * 所以产物与教师点「导出 PDF」得到的完全一致：矢量文字、公式 MathML、一页一画布。
 *
 * 2026-10-13 实测：14 章 → 494 页（正文 247 + 讲稿 247）、42.5 MB。
 */
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.HOME + '/.cache/ms-playwright';
import fs from 'node:fs';
import path from 'node:path';
const { PDFDocument } = await import('/tmp/pdftools/node_modules/pdf-lib/cjs/index.js');
const pw = await import('/home/ubuntu/nju-lab/web/node_modules/playwright/index.js');
const chromium = pw.chromium ?? pw.default?.chromium;

const API = 'http://127.0.0.1:3100/api';
const BASE = 'http://127.0.0.1/lab';
const COURSE = process.argv[2] || 'cd11ea33-0f1f-420a-afbc-951baf1f5e89';
const TMP = '/tmp/export-pdf';
const OUT_DIR = process.argv[3] || '/home/ubuntu/nju-lab-exports';
fs.mkdirSync(TMP, { recursive: true });

const t = (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'teacher', password: 'teacher123' }) }).then((r) => r.json())).data.accessToken;
const chapterRes = await fetch(`${API}/courses/${COURSE}/chapters`, { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json());
const chapters = (Array.isArray(chapterRes) ? chapterRes : chapterRes.data ?? []).sort((a, b) => a.order - b.order);
console.log(`共 ${chapters.length} 章，开始逐章导出…\n`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
// 拦掉打印对话框（headless 下本来也不弹，这里稳妥处理）
await ctx.addInitScript(() => { window.print = function () {}; });
await ctx.addInitScript(([tk, u]) => localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: tk, user: u }, version: 0 })), [t, (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'teacher', password: 'teacher123' }) }).then((r) => r.json())).data.user]);
const page = await ctx.newPage();

const files = [];
for (const ch of chapters) {
  const deck = await fetch(`${API}/chapters/${ch.id}/slides`, { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json());
  const slides = (deck.data ?? deck).deck?.slides ?? [];
  if (!slides.length) { console.log(`跳过 第 ${ch.order} 章（无幻灯片）`); continue; }
  await page.goto(`${BASE}/teacher/chapters/${ch.id}/slides`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2800);
  const hasBtn = await page.getByRole('button', { name: '导出 PDF' }).count();
  if (!hasBtn) { console.log(`✗ 第 ${ch.order} 章：找不到导出按钮`); continue; }
  await page.getByRole('checkbox', { name: '附讲稿' }).check();
  await page.waitForTimeout(250);
  const [np] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 25000 }).catch(() => null),
    page.getByRole('button', { name: '导出 PDF' }).click(),
  ]);
  if (!np) { console.log(`✗ 第 ${ch.order} 章：新窗口没打开`); continue; }
  await np.waitForLoadState('load').catch(() => {});
  await np.waitForTimeout(2200);
  const file = path.join(TMP, `${String(ch.order).padStart(2, '0')}-${ch.title.replace(/[\/\\:*?"<>|]/g, '_')}.pdf`);
  await np.pdf({ path: file, printBackground: true, preferCSSPageSize: true });
  await np.close();
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`✓ 第 ${ch.order} 章 ${ch.title}：${slides.length} 页正文 → ${kb} KB`);
  files.push({ order: ch.order, title: ch.title, file });
}
await browser.close();

// 合并
const merged = await PDFDocument.create();
let total = 0;
for (const f of files) {
  const doc = await PDFDocument.load(fs.readFileSync(f.file), { ignoreEncryption: true });
  const pages = await merged.copyPages(doc, doc.getPageIndices());
  pages.forEach((p) => merged.addPage(p));
  total += doc.getPageCount();
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, '课程讲义-含讲稿.pdf');
merged.setTitle('分子医学人工智能理论与实验 · 讲义（含讲稿）');
merged.setProducer('NJU-Lab 幻灯片导出');
fs.writeFileSync(out, await merged.save());
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ 合并完成：${files.length} 章 / ${total} 页 / ${mb} MB\n   ${out}`);
