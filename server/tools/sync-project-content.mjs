#!/usr/bin/env node
/**
 * 把题目包里的 `task.md` 同步进项目的「实验内容」字段 —— 已有实验的一次性补填工具。
 *
 * 背景：学生端实验详情页首屏展示「实验内容」（`experiment_projects.content`）。新实验由老师
 * 在出题时直接填（见 docs/EXPERIMENT-CREATION-GUIDE.md 步骤 11），但**此前建好的实验**该字段为空，
 * 而它们的题面就躺在题目包的 `task.md` 里 —— 本脚本按固定规则抽出来写回平台。
 *
 * 抽取规则（默认）：取 `## 业务背景` + `## 你的任务` 两节 —— 即"这个实验做什么"。
 * 技术口径（清洗/查询口径、六步细节等）**不并进首屏**，它们属于 `description` / `background`
 * （学生端的「实验指导」折叠区）。`--full` 则写入整份 task.md。
 *
 * 用法（**默认只预览，不写**）：
 *   node server/tools/sync-project-content.mjs            # 预览：打印将写入的内容与长度
 *   node server/tools/sync-project-content.mjs --apply    # 真正写入（PATCH /api/projects/:id）
 *   ... --full                                            # 用整份 task.md（默认取两节）
 *   ... --overwrite                                       # 连已有内容的项目一起覆盖（默认跳过非空）
 *   VERIFY_API=http://127.0.0.1:3101/api node ...          # 指向别的后端实例
 *
 * 安全约定：
 *   · **已有 `content` 的项目默认跳过**（不覆盖老师的编辑），要覆盖得显式 `--overwrite`；
 *   · 抽出来不足 50 字的项目跳过（多半是题面结构不同，宁可留空让人工处理）；
 *   · 包内没有 `task.md` 的项目跳过并**说明原因**（历史「内置回落型」包：题面写死在驱动里）。
 * 依赖：宿主有 `unzip`（只读抽取；不进平台代码路径）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.VERIFY_API || 'http://127.0.0.1:3100/api';
const APPLY = process.argv.includes('--apply');
const FULL = process.argv.includes('--full');
const OVERWRITE = process.argv.includes('--overwrite');
const MIN_LENGTH = 50;

async function login(username, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!body?.data?.accessToken) throw new Error(`${username} 登录失败`);
  return body.data.accessToken;
}

function call(token, path, { method = 'GET', body } = {}) {
  return fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }));
}
const pick = (res) => res.data?.data ?? res.data;

/** 下载题目包到临时目录，用 unzip 抽出 task.md（兼容包了一层顶层目录的情形） */
async function readTaskMd(token, fileId, dir, name) {
  const res = await fetch(`${API}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`下载题目包失败 HTTP ${res.status}`);
  const zipPath = join(dir, `${name}.zip`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  try {
    return execFileSync('unzip', ['-p', zipPath, 'task.md'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    const listing = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
    const entry = listing
      .split('\n')
      .find((line) => line.trim().endsWith('task.md'));
    if (!entry) throw new Error('包内没有 task.md');
    return execFileSync('unzip', ['-p', zipPath, entry.trim()], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  }
}

/** 取指定二级标题下的内容（到下一个 `## ` 为止） */
function section(markdown, title) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^##\\s*${title}`).test(line.trim()));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line.trim()));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

function buildContent(taskMd) {
  if (FULL) return taskMd.trim();
  const parts = [];
  const background = section(taskMd, '业务背景');
  const task = section(taskMd, '你的任务');
  if (background) parts.push(`## 业务背景\n\n${background}`);
  if (task) parts.push(`## 你的任务\n\n${task}`);
  return parts.length ? parts.join('\n\n') : taskMd.trim();
}

const token = await login('admin', 'admin123');
const projects = (await pick(await call(token, '/projects'))) ?? [];
const dir = mkdtempSync(join(tmpdir(), 'sync-content-'));
let written = 0;
let skippedExisting = 0;
const noTaskMd = [];
const tooShort = [];

try {
  for (const row of projects) {
    const full = await pick(await call(token, `/projects/${row.id}`));
    const title = full?.title ?? row.title;

    if (!OVERWRITE && (full?.content ?? '').trim()) {
      skippedExisting += 1;
      console.log(`· 跳过（已有实验内容 ${full.content.length} 字）：${title}`);
      continue;
    }
    if (!full?.problem?.fileId) {
      noTaskMd.push(`${title}（未绑定题目包）`);
      console.log(`! 跳过：${title} —— 未绑定题目包`);
      continue;
    }

    let taskMd;
    try {
      taskMd = await readTaskMd(token, full.problem.fileId, dir, row.id);
    } catch (error) {
      noTaskMd.push(`${title}（${error.message}）`);
      console.log(`! 跳过：${title} —— ${error.message}`);
      continue;
    }

    const content = buildContent(taskMd);
    if (content.length < MIN_LENGTH) {
      tooShort.push(`${title}（抽出 ${content.length} 字）`);
      console.log(`! 跳过：${title} —— 抽出内容过短（${content.length} 字），题面结构可能不同`);
      continue;
    }

    if (!APPLY) {
      console.log(`\n=== ${title}`);
      console.log(`    task.md ${taskMd.length} 字 → 将写入 ${content.length} 字（${FULL ? '整份' : '业务背景 + 你的任务'}）`);
      console.log(
        content
          .split('\n')
          .slice(0, 6)
          .map((line) => `    | ${line}`)
          .join('\n'),
      );
      written += 1;
      continue;
    }

    const res = await call(token, `/projects/${row.id}`, {
      method: 'PATCH',
      body: { content },
    });
    const okStatus = res.status === 200 || res.status === 201;
    const saved = pick(res);
    const ok = okStatus && saved?.content === content;
    if (ok) written += 1;
    console.log(
      `${ok ? '✓' : '✗'} ${title} —— ${content.length} 字${ok ? '' : `（写入失败 status=${res.status}）`}`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n──── 汇总 ────');
console.log(
  `${APPLY ? '已写入' : '可写入'} ${written} 个 · 跳过（已有内容）${skippedExisting} 个 · ` +
    `无题面来源 ${noTaskMd.length} 个 · 内容过短 ${tooShort.length} 个`,
);
if (noTaskMd.length) {
  console.log('无题面来源（需人工处理）：');
  for (const item of noTaskMd) console.log(`  · ${item}`);
}
if (tooShort.length) {
  console.log('抽出过短（需人工处理）：');
  for (const item of tooShort) console.log(`  · ${item}`);
}
if (!APPLY) console.log('\n这是**预览**，没有写入任何数据。要写入请加 --apply。');
