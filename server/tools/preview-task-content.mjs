#!/usr/bin/env node
/**
 * 从题目包里抽出「实验内容」初稿 —— **只读预览，不写库**（2026-10-13）。
 *
 * 背景：学生端实验详情页首屏要展示「实验内容」（这个实验做什么），字段由老师在出题时填。
 * 已有实验的字段是空的，题面则在题目包的 `task.md` 里 —— 本脚本把它整理成可粘贴的初稿：
 * 默认取 `## 业务背景` + `## 你的任务` 两节（`--full` 取整份 task.md），其余技术口径
 * 属于「实验指导」（`description` / `background`），不并进首屏。
 *
 * 用法：
 *   node server/tools/preview-task-content.mjs                # 只打印（默认）
 *   node server/tools/preview-task-content.mjs --full         # 打印整份 task.md
 *   VERIFY_API=http://127.0.0.1:3101/api node ...             # 指向别的后端实例
 *
 * 依赖：宿主有 `unzip`（只读抽取，一次性工具，不进生产代码路径）。
 * 注意：**不会**写任何数据。要批量写入需明确授权后走 `PATCH /api/projects/:id`（另做）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.VERIFY_API || 'http://127.0.0.1:3100/api';
const FULL = process.argv.includes('--full');

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

const call = (token, path) =>
  fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
    .then(async (res) => (await res.json())?.data);

/** 下载题目包到临时目录，用 unzip 抽出 task.md */
async function readTaskMd(token, fileId, dir, name) {
  const res = await fetch(`${API}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`下载题目包失败：HTTP ${res.status}`);
  const zipPath = join(dir, `${name}.zip`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  try {
    return execFileSync('unzip', ['-p', zipPath, 'task.md'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    // 顶层目录包一层（`problem/task.md`）时再试一次
    const listing = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
    const entry = listing.split('\n').find((line) => line.endsWith('task.md'));
    if (!entry) throw new Error('包内没有 task.md');
    return execFileSync('unzip', ['-p', zipPath, entry.trim()], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  }
}

/** 取指定二级标题之间的内容（到下一个 `## ` 为止） */
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
  const background = section(taskMd, '业务背景');
  const task = section(taskMd, '你的任务');
  const parts = [];
  if (background) parts.push(`## 业务背景\n\n${background}`);
  if (task) parts.push(`## 你的任务\n\n${task}`);
  // 两节都没命中（题面结构不同）→ 退回第一个二级标题之前的内容，别输出空
  return parts.length ? parts.join('\n\n') : taskMd.trim();
}

const token = await login('admin', 'admin123');
const projects = await call(token, '/projects');
const dir = mkdtempSync(join(tmpdir(), 'task-content-'));
let ok = 0;
let skipped = 0;
try {
  for (const row of projects ?? []) {
    const full = await call(token, `/projects/${row.id}`);
    const problem = full?.problem;
    if (!problem?.fileId) {
      console.log(`\n=== ${row.title}  [跳过：未绑定题目包]`);
      skipped += 1;
      continue;
    }
    try {
      const taskMd = await readTaskMd(token, problem.fileId, dir, row.id);
      const content = buildContent(taskMd);
      console.log(`\n=== ${row.title}  (project ${row.id})`);
      console.log(`--- task.md ${taskMd.length} 字 → 实验内容初稿 ${content.length} 字 ---`);
      console.log(content.length > 1200 ? `${content.slice(0, 1200)}\n…（截断，共 ${content.length} 字）` : content);
      ok += 1;
    } catch (error) {
      console.log(`\n=== ${row.title}  [跳过：${String(error.message).slice(0, 80)}]`);
      skipped += 1;
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  `\n统计：${ok} 个实验抽出了初稿，${skipped} 个跳过（共 ${(projects ?? []).length} 个）。` +
    '\n本脚本**不写任何数据** —— 初稿请手动粘到教师端「实验内容」（或明确授权后再批量 PATCH）。',
);
