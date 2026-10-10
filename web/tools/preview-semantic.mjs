#!/usr/bin/env node
/**
 * 语义渲染层样张截图（P0 观感评测素材）。
 *
 * 用法：
 *   node web/tools/preview-semantic.mjs                       # 默认主题，全页截图
 *   node web/tools/preview-semantic.mjs --themes=a,b,c        # 多主题对比
 *   node web/tools/preview-semantic.mjs --pages=1,4,7         # 只截指定页（快速迭代）
 *   node web/tools/preview-semantic.mjs --out=/tmp/shots
 *
 * 产物：`<out>/<theme>/pNN.png`（1920×1080，与固定画布 1:1）+ `deck.html`（可直接用浏览器打开看翻页）。
 *
 * 环境（与 verify-slides.mjs 同源）：需要 playwright chromium 与中文字体；
 * 浏览器目录默认取 `~/.cache/ms-playwright`（可用 PLAYWRIGHT_BROWSERS_PATH 覆盖）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const webRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');

// ---- 参数 ----
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const themeIds = argValue('themes', 'builtin-platform-blue').split(',').map((s) => s.trim()).filter(Boolean);
// 默认落在 `web/tools/shots/`（.gitignore 已忽略）—— 截图是评审产物，不进仓库
const outRoot = argValue('out', join(webRoot, 'tools', 'shots', 'semantic'));
const onlyPages = argValue('pages', '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

process.env.PLAYWRIGHT_BROWSERS_PATH ||= join(homedir(), '.cache', 'ms-playwright');

// ---- 打包渲染层（esbuild + `?raw` 资产插件，与 vite 的 ?raw 语义对齐）----
const rawPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (a) => ({
      path: resolve(dirname(a.importer), a.path.replace(/\?raw$/, '')),
      namespace: 'raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
      contents: `export default ${JSON.stringify(readFileSync(a.path, 'utf8'))}`,
      loader: 'js',
    }));
  },
};

const work = join(tmpdir(), `semantic-preview-${process.pid}`);
mkdirSync(work, { recursive: true });
const bundle = join(work, 'entry.mjs');
await esbuild.build({
  stdin: {
    contents: [
      `export { buildSemanticDeckHtml } from './src/slides/semantic/stage';`,
      `export { PAGES, META } from './tools/fixtures/chapter4-deck';`,
      `export { DECK_THEMES } from './src/slides/semantic/theme';`,
    ].join('\n'),
    resolveDir: webRoot,
    loader: 'ts',
    sourcefile: 'semantic-preview-entry.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  plugins: [rawPlugin],
  logLevel: 'silent',
});

const { buildSemanticDeckHtml, PAGES, META, DECK_THEMES } = await import(pathToFileURL(bundle).href);
const themeName = (id) => DECK_THEMES.find((t) => t.id === id)?.name ?? id;

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

for (const themeId of themeIds) {
  const html = buildSemanticDeckHtml({ pages: PAGES, meta: META, themeId });
  const dir = join(outRoot, themeId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'deck.html');
  writeFileSync(file, html, 'utf8');

  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  // 关掉翻页过渡，避免截到动画中间态
  await page.addStyleTag({ content: '.slide{transition:none !important}' });
  await page.waitForTimeout(120);

  const targets = onlyPages.length ? onlyPages : PAGES.map((_, i) => i + 1);
  let current = 1;
  for (const pageNo of targets) {
    while (current < pageNo) {
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
      current += 1;
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(80);
    const shot = join(dir, `p${String(pageNo).padStart(2, '0')}.png`);
    await page.screenshot({ path: shot });
    console.log(`  · ${themeName(themeId)} p${String(pageNo).padStart(2, '0')} → ${shot}`);
  }
}

await browser.close();
rmSync(work, { recursive: true, force: true });
console.log(`\n完成：${themeIds.length} 个主题 / ${onlyPages.length || PAGES.length} 页 → ${outRoot}`);
