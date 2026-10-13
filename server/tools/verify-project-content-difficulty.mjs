#!/usr/bin/env node
/**
 * 实验「内容 + 难度」两字段的接口级验证（2026-10-13 学员反馈）。
 *
 * 背景：
 *   · **实验内容** `content` —— 学生详情页首屏要直接看到"这个实验做什么"
 *     （此前题干只在题目包 ZIP 的 task.md 里，必须下载解压才看得到）；
 *   · **难度等级** `difficulty`（easy / medium / hard，可空=未标注）—— 让不同基础的学生各取所需。
 *
 * 用法：`node server/tools/verify-project-content-difficulty.mjs`
 * 前置：服务在 127.0.0.1:3100 运行；账号 admin/admin123、student1/student123。
 * 本地联调：`VERIFY_API=http://127.0.0.1:3101/api node server/tools/verify-project-content-difficulty.mjs`
 *
 * 设计：**全程用一门临时课程**（标题带「内容难度验证」），最后删掉 —— 验证写得再错也不碰真实课程。
 * 覆盖：
 *   ① 创建实验：`content` / `difficulty` 能写入并回读
 *   ② 更新实验：改内容、改难度、**清空难度（传 null）**
 *   ③ 学生（未领取）也能从 `GET /projects/:id` 读到实验内容与难度 —— 这是本次改动的核心
 *   ④ 学生 `GET /courses/:id` 与 `/me/assignments` 的难度透出（章节右栏、待办实验用）
 *   ⑤ 清理：临时课程删除后取不到
 */
const API = process.env.VERIFY_API || 'http://127.0.0.1:3100/api';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

async function login(username, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  const token = body?.data?.accessToken;
  if (!token) throw new Error(`${username} 登录失败：` + JSON.stringify(body).slice(0, 160));
  return { token, user: body.data.user };
}

function call(token, path, { method = 'GET', body } = {}) {
  return fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }));
}

const pick = (res) => res.data?.data ?? res.data;

const admin = await login('admin', 'admin123');
const student = await login('student1', 'student123');

const stamp = Date.now();
const CONTENT = `## 业务背景\n\n这是**临时验证**用的实验内容（${stamp}）。\n\n## 你的任务\n\n做一个可复现的小实验。`;
const CONTENT_UPDATED = `${CONTENT}\n\n（补充：这段是更新后的内容。）`;

let courseId = null;
try {
  const created = await call(admin.token, '/courses', {
    method: 'POST',
    body: { title: `内容难度验证-临时课程-${stamp}`, term: '测试' },
  });
  courseId = pick(created)?.id;
  const chapter = pick(
    await call(admin.token, `/courses/${courseId}/chapters`, {
      method: 'POST',
      body: { title: '验证用章节', order: 1, content: '# 临时章节', status: 'published' },
    }),
  );
  check('准备：临时课程 + 已发布章节', !!courseId && !!chapter?.id, `course=${courseId} chapter=${chapter?.id}`);

  // ---------- ① 创建：两个字段写入 ----------
  const createdProject = pick(
    await call(admin.token, '/projects', {
      method: 'POST',
      body: {
        title: `内容与难度验证-${stamp}`,
        chapterId: chapter.id,
        content: CONTENT,
        difficulty: 'easy',
        description: '技术口径（应归入实验指导）',
      },
    }),
  );
  check(
    '创建实验：content / difficulty 写入成功',
    createdProject?.content === CONTENT && createdProject?.difficulty === 'easy',
    `difficulty=${createdProject?.difficulty} contentLen=${(createdProject?.content ?? '').length}`,
  );
  const projectId = createdProject?.id;

  // ---------- ② 更新：改内容、改难度、清空难度 ----------
  const patched = pick(
    await call(admin.token, `/projects/${projectId}`, {
      method: 'PATCH',
      body: { content: CONTENT_UPDATED, difficulty: 'hard' },
    }),
  );
  check(
    '更新实验：内容与难度都能改',
    patched?.content === CONTENT_UPDATED && patched?.difficulty === 'hard',
    `difficulty=${patched?.difficulty}`,
  );
  const cleared = pick(
    await call(admin.token, `/projects/${projectId}`, { method: 'PATCH', body: { difficulty: null } }),
  );
  check('更新实验：难度可清空（传 null → 未标注）', cleared?.difficulty === null, `difficulty=${cleared?.difficulty}`);
  const restored = pick(
    await call(admin.token, `/projects/${projectId}`, { method: 'PATCH', body: { difficulty: 'medium' } }),
  );
  check('更新实验：难度可重新标注', restored?.difficulty === 'medium', `difficulty=${restored?.difficulty}`);

  // ---------- 学生视角 ----------
  await call(admin.token, `/courses/${courseId}/enrollments`, {
    method: 'POST',
    body: { studentIds: [student.user.id] },
  });
  await call(admin.token, `/projects/${projectId}/publish`, { method: 'POST' });
  await call(admin.token, `/courses/${courseId}/publish`, { method: 'POST' });

  const asStudent = pick(await call(student.token, `/projects/${projectId}`));
  check(
    '学生**未领取**也能读到实验内容（首屏展示的核心）',
    asStudent?.content === CONTENT_UPDATED,
    `contentLen=${(asStudent?.content ?? '').length}`,
  );
  check('学生能读到难度标注', asStudent?.difficulty === 'medium', `difficulty=${asStudent?.difficulty}`);
  check(
    '学生读不到文件信息（未领取时模板/题目包不下发，既有口径未变）',
    !asStudent?.problem && !asStudent?.skillTemplate,
  );

  const courseDetail = pick(await call(student.token, `/courses/${courseId}`));
  const summary = (courseDetail?.chapters ?? [])
    .flatMap((c) => c.projects ?? [])
    .find((p) => p.id === projectId);
  check('课程详情章节里的实验摘要带难度（章节右栏用）', summary?.difficulty === 'medium', `difficulty=${summary?.difficulty}`);

  const mine = await call(student.token, '/me/assignments');
  const mineEntry = (mine.data?.data ?? []).find((a) => a.project?.id === projectId);
  check('学生任务列表带难度（工作台待办用）', mineEntry?.project?.difficulty === 'medium', `difficulty=${mineEntry?.project?.difficulty}`);
} catch (error) {
  check('执行异常', false, String(error).slice(0, 300));
} finally {
  if (courseId) {
    const del = await call(admin.token, `/courses/${courseId}`, { method: 'DELETE' });
    const after = await call(admin.token, `/courses/${courseId}`);
    check(
      '清理：临时课程已删除（再取 404）',
      (del.status === 200 || del.status === 204) && after.status === 404,
      `delete=${del.status} get=${after.status}`,
    );
  }
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  for (const [label] of failed) console.log(`  · ${label}`);
}
process.exit(failed.length ? 1 : 0);
