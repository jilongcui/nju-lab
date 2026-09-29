/**
 * 章节幻灯片「盲评截图」工具 —— 效果优化的评测闭环（2026-09-29 规划阶段 0）
 *
 * 干什么：对一组章节触发真实 LLM 生成（force），等 ready 后用 Playwright 进放映态，
 * **逐页整屏截图** + 落 deck.json（含 tokensUsed / warnings），供逐页盲评打分。
 *
 * 与 verify-slides.mjs 的分工：那个管交互回归（点击/键盘/Esc），这个管**观感评审素材**。
 *
 * 用法：
 *   PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright \
 *     node web/tools/review-decks.mjs <标签> [chapterId...]
 *
 *   · 标签是本轮评测的名字（如 flash-v1 / pro-v3），截图落 web/tools/shots/review/<标签>/<章节名>/
 *   · 不带 chapterId 时跑默认评测集（生产库 5 个真实章节，见下方 EVAL_CHAPTERS）
 *   · 会真实调用 LLM（烧额度）并覆盖这些章节的现有 deck（force 重新生成）
 *   · REVIEW_API 可指向临时实例（如 REVIEW_API=http://127.0.0.1:3199/api）：
 *     用别的模型配置起临时后端做对比评测，**截图仍走线上前端**（同一份 DB，deck 读得回来）
 *
 * 环境坑同 verify-slides.mjs：必须显式 PLAYWRIGHT_BROWSERS_PATH；需要中文字体包。
 * 注意：每课程每小时生成上限 SLIDES_GENERATE_PER_HOUR=20，默认集 5 章都在同一课程，一轮=5 次。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const API = process.env.REVIEW_API || 'http://127.0.0.1:3100/api';
const SITE_HOST = 'medai.nju.edu.cn';
const BASE = `http://${SITE_HOST}/lab`;

/** 默认评测集：生产库真实章节（2026-09-29 用 API 核实字数与内容类型） */
const EVAL_CHAPTERS = [
  { id: '6133aea6-b85c-480f-ac9a-079820a8cef5', name: '结构化Prompt模版', note: '叙述性正文 3499字' },
  { id: 'e908e0bb-a500-46de-a4ec-5592f7713ee4', name: '输出JSON结构数据', note: '代码含量最高 3616字' },
  { id: '63d6f6bc-a18b-427b-a829-8bd75dc096d4', name: '思维链COT', note: '概念+示例 3027字' },
  { id: '3e54377d-d659-437d-a474-c505a674368e', name: '提示工程介绍', note: '入门概念 2831字' },
  { id: '7070707c-0d96-4162-aac2-5650e0e277a2', name: '什么是人工智能', note: '短章节压力测试 1059字' },
];

const label = process.argv[2];
if (!label) {
  console.error('用法: node web/tools/review-decks.mjs <标签> [--shots-only] [chapterId...]');
  console.error('  --shots-only：不触发生成，直接截图该章节现有 deck（用于给旧版 deck 留"对照组"证据）');
  process.exit(2);
}
const idArgs = process.argv.slice(3);
const shotsOnly = idArgs[0] === '--shots-only';
const idList = shotsOnly ? idArgs.slice(1) : idArgs;
const chapters = idList.length
  ? idList.map((id) => EVAL_CHAPTERS.find((c) => c.id === id) ?? { id, name: id, note: '' })
  : EVAL_CHAPTERS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, options = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const json = await res.json();
  return json;
}

async function login() {
  const json = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'teacher', password: 'teacher123' }),
  });
  const token = json?.data?.accessToken;
  if (!token) throw new Error('API 登录失败：' + JSON.stringify(json).slice(0, 200));
  return { token, user: json.data.user };
}

/** 触发 force 生成并轮询到 ready（LLM 生成 1–5 分钟量级） */
async function generateDeck(chapterId, token) {
  const started = await api(`/chapters/${chapterId}/slides/generate`, {
    method: 'POST',
    body: JSON.stringify({ force: true }),
  }, token);
  if (started.code !== 0) throw new Error(`触发生成失败：${started.message}`);
  for (let i = 0; i < 140; i++) {
    await sleep(3000);
    const d = await api(`/chapters/${chapterId}/slides`, {}, token);
    const deck = d?.data?.deck;
    if (deck?.status === 'ready') return deck;
    if (deck?.status === 'failed') throw new Error(`生成失败：${deck.error}`);
  }
  throw new Error('轮询超时（7 分钟）');
}

/** --shots-only：取现有 deck（不触发生成，不花额度） */
async function fetchExistingDeck(chapterId, token) {
  const d = await api(`/chapters/${chapterId}/slides`, {}, token);
  const deck = d?.data?.deck;
  if (!deck || deck.status !== 'ready') {
    throw new Error(`该章节没有 ready 状态的 deck（当前：${deck?.status ?? '无'}）`);
  }
  return deck;
}

async function main() {
  const outRoot = new URL(`./shots/review/${label}/`, import.meta.url).pathname;
  mkdirSync(outRoot, { recursive: true });
  const { token, user } = await login();
  console.log(`· 已登录（teacher），标签=${label}，章节数=${chapters.length}`);

  // 1) 逐章生成（串行：同课程共享每小时配额，也避免并发把 DeepSeek 打挂）
  const decks = [];
  for (const ch of chapters) {
    process.stdout.write(`· ${shotsOnly ? '读取现有 deck' : '生成中'}：${ch.name} …`);
    const t0 = Date.now();
    const deck = shotsOnly
      ? await fetchExistingDeck(ch.id, token)
      : await generateDeck(ch.id, token);
    console.log(` ready，${deck.slides?.length ?? 0} 页，tokens=${deck.tokensUsed ?? '?'}，${Math.round((Date.now() - t0) / 1000)}s`);
    if (deck.warnings) console.log(`  ⚠ warnings: ${deck.warnings.split('\n').join(' | ')}`);
    decks.push({ ch, deck });
  }

  // 2) 逐章进放映态逐页截图
  const browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`, '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ([t, u]) => {
      localStorage.setItem('nju-lab-auth', JSON.stringify({ state: { token: t, user: u }, version: 0 }));
      window.__deckEvents = [];
      window.addEventListener('message', (event) => {
        if (event.data && event.data.__deck === true) window.__deckEvents.push(event.data);
      });
    },
    [token, user],
  );
  const page = await context.newPage();

  const lastIndex = async () => {
    const events = await page.evaluate(() => window.__deckEvents || []);
    const changed = events.filter((e) => e.type === 'slidechanged' || e.type === 'ready');
    return changed.length ? changed[changed.length - 1].index : -1;
  };

  const summary = [];
  for (const { ch, deck } of decks) {
    const dir = `${outRoot}${ch.name}/`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}deck.json`,
      JSON.stringify(
        {
          chapterId: ch.id,
          chapter: ch.name,
          label,
          model: deck.model,
          tokensUsed: deck.tokensUsed,
          warnings: deck.warnings,
          slides: deck.slides,
        },
        null,
        2,
      ),
    );

    const total = deck.slides?.length ?? 0;
    process.stdout.write(`· 截图中：${ch.name}（${total} 页）…`);
    await page.goto(`${BASE}/teacher/chapters/${ch.id}/slides`, { waitUntil: 'domcontentloaded' });
    await page.getByText('章节幻灯片').first().waitFor({ timeout: 20000 });
    await page.evaluate(() => { window.__deckEvents = []; });
    await page.getByRole('button', { name: '放映' }).click();
    // 等 reveal ready（iframe postMessage）
    for (let i = 0; i < 40 && (await lastIndex()) < 0; i++) await sleep(500);

    for (let index = 0; index < total; index++) {
      // 等到目标页再拍（第一页通常已就位）
      for (let i = 0; i < 20 && (await lastIndex()) !== index; i++) await sleep(300);
      await sleep(700); // 过渡动画
      await page.screenshot({ path: `${dir}p${String(index + 1).padStart(2, '0')}.png` });
      if (index < total - 1) await page.keyboard.press('ArrowRight');
    }
    console.log(' 完成');
    summary.push({ chapter: ch.name, pages: total, tokens: deck.tokensUsed, dir });
  }

  await browser.close();
  console.log('\n== 评测素材已就绪 ==');
  for (const s of summary) console.log(`  ${s.chapter}: ${s.pages} 页, tokens=${s.tokens ?? '?'} → ${s.dir}`);
}

main().catch((error) => {
  console.error('✗ 执行失败：', error.message);
  process.exit(1);
});
