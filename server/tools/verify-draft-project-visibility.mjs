#!/usr/bin/env node
/**
 * 学生不得看到**未发布的草稿实验** —— 接口级验证（打真实 API）。
 *
 * 背景（2026-10-13 用户要求）：课程详情的章节里挂着实验摘要，`getCourse` 原先**不按状态过滤**，
 * 于是学生能读到老师还没发布的草稿实验标题。其余入口本来就有防护（`getProject` 对学生 403、
 * 下发任务与 `/me/assignments` 只认 PROJECT_STATUS.PUBLISHED），这里一并回归。
 *
 * 用法：`node server/tools/verify-draft-project-visibility.mjs`
 * 前置：服务在 127.0.0.1:3100 运行；账号 admin/admin123、student1/student123。
 *
 * 设计：**全程用一门临时课程**（标题带「草稿可见性验证」），最后删掉 ——
 * 断言即使判定出错，也不会污染真实课程的章节/实验。
 * 覆盖：
 *   ① 学生 `GET /courses/:id`：只返回已发布实验（草稿实验的标题/ id 都不出现）
 *   ② 教师/管理员同一接口：草稿实验仍可见（不能误伤备课流程）
 *   ③ 学生直接 `GET /projects/:draftId` → 403（既有防护回归）
 *   ④ 学生 `/me/assignments` 不含草稿实验（草稿下发任务 → 学生看不到，既有防护回归）
 *   ⑤ 清理：临时课程删除后取不到
 */
// 默认打线上后端；本地联调（新代码先跑在别的端口）可覆盖：
//   VERIFY_API=http://127.0.0.1:3101/api node server/tools/verify-draft-project-visibility.mjs
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

const admin = await login('admin', 'admin123');
const student = await login('student1', 'student123');

const stamp = Date.now();
const DRAFT_TITLE = `草稿实验-不该给学生看-${stamp}`;
const PUBLISHED_TITLE = `已发布实验-学生应看到-${stamp}`;

let courseId = null;
try {
  // ---------- 准备：临时课程 + 已发布章节 + 一草稿一发布两个实验 ----------
  const created = await call(admin.token, '/courses', {
    method: 'POST',
    body: { title: `草稿可见性验证-临时课程-${stamp}`, term: '测试' },
  });
  courseId = created.data?.data?.id ?? created.data?.id;
  check('建临时课程（验证用完即删）', !!courseId, `status=${created.status}`);

  const chapter = await call(admin.token, `/courses/${courseId}/chapters`, {
    method: 'POST',
    body: { title: '验证用章节', order: 1, content: '# 验证用章节\n\n临时内容。', status: 'published' },
  });
  const chapterId = chapter.data?.data?.id ?? chapter.data?.id;
  check('建章节并直接发布（学生可见章节）', !!chapterId, `status=${chapter.status}`);

  const draft = await call(admin.token, '/projects', {
    method: 'POST',
    body: { title: DRAFT_TITLE, chapterId, description: '草稿实验' },
  });
  const draftId = draft.data?.data?.id ?? draft.data?.id;
  check('建草稿实验（默认 draft，不调用 publish）', !!draftId, `status=${draft.status}`);

  const published = await call(admin.token, '/projects', {
    method: 'POST',
    body: { title: PUBLISHED_TITLE, chapterId, description: '已发布实验' },
  });
  const publishedId = published.data?.data?.id ?? published.data?.id;
  const pubRes = await call(admin.token, `/projects/${publishedId}/publish`, { method: 'POST' });
  check('发布第二个实验', pubRes.status === 200 || pubRes.status === 201, `status=${pubRes.status}`);

  const enroll = await call(admin.token, `/courses/${courseId}/enrollments`, {
    method: 'POST',
    body: { studentIds: [student.user.id] },
  });
  const coursePub = await call(admin.token, `/courses/${courseId}/publish`, { method: 'POST' });
  check(
    '学生入册 + 课程发布（学生视角才能读到课程）',
    enroll.status === 200 || enroll.status === 201,
    `enroll=${enroll.status} publish=${coursePub.status}`,
  );

  // ---------- ① 学生视角：只见已发布实验 ----------
  const asStudent = await call(student.token, `/courses/${courseId}`);
  const studentChapters = asStudent.data?.data?.chapters ?? [];
  const studentProjects = studentChapters.flatMap((c) => c.projects ?? []);
  const studentBody = JSON.stringify(asStudent.data);
  check(
    '学生 GET /courses/:id：章节里只剩已发布实验',
    studentProjects.length === 1 && studentProjects[0].id === publishedId,
    `实验 ${studentProjects.length} 个：${studentProjects.map((p) => p.title).join(' / ')}`,
  );
  check(
    '学生响应里**完全不含**草稿实验的标题与 id（防其它字段泄漏）',
    !studentBody.includes(DRAFT_TITLE) && !studentBody.includes(draftId),
  );
  check('学生仍能读到课件页数（同一接口的既有字段没被破坏）',
    studentChapters.every((c) => typeof c.slideCount === 'number'),
    `slideCount=${studentChapters.map((c) => c.slideCount).join(',')}`);

  // ---------- ② 教师/管理员视角：草稿仍可见（不能误伤备课） ----------
  const asAdmin = await call(admin.token, `/courses/${courseId}`);
  const adminProjects = (asAdmin.data?.data?.chapters ?? []).flatMap((c) => c.projects ?? []);
  check(
    '教师/管理员 GET /courses/:id：草稿实验仍在（备课不受影响）',
    adminProjects.length === 2 &&
      adminProjects.some((p) => p.id === draftId) &&
      adminProjects.some((p) => p.id === publishedId),
    `实验 ${adminProjects.length} 个`,
  );

  // ---------- ③ 学生直接打开草稿实验详情：403（既有防护回归） ----------
  const direct = await call(student.token, `/projects/${draftId}`);
  check('学生直接 GET /projects/:draftId → 403', direct.status === 403, `status=${direct.status}`);

  // ---------- ④ 学生任务列表不含草稿实验（既有防护回归） ----------
  const mine = await call(student.token, '/me/assignments');
  const myAssignments = mine.data?.data ?? [];
  check(
    '学生 /me/assignments 不含草稿实验',
    !myAssignments.some((a) => a.project?.id === draftId),
    `任务 ${myAssignments.length} 个`,
  );
} catch (error) {
  check('执行异常', false, String(error).slice(0, 300));
} finally {
  // ---------- ⑤ 清理 ----------
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
