#!/usr/bin/env node
/**
 * 课程「下架（取消发布）」的接口级验证（2026-10-13）。
 *
 * 背景：平台的公开目录、公开课程详情、学生端课程读取**都按 `status = published` 判定**，
 * 但此前只有「发布」没有「下架」—— 内部示例 / 验收课程一旦发布就永远挂在选课目录里。
 * 现在补上 `POST /api/courses/:id/unpublish`（回到 draft，**什么都不删**，可重新发布）。
 *
 * 用法：`node server/tools/verify-course-unpublish.mjs`
 * 前置：服务在 127.0.0.1:3100 运行；账号 admin/admin123、student1/student123。
 * 本地联调：`VERIFY_API=http://127.0.0.1:3101/api node server/tools/verify-course-unpublish.mjs`
 *
 * 设计：**全程用一门临时课程**（标题带「下架验证」），最后删掉。
 * 覆盖：
 *   ① 发布后：公开目录能看到、公开详情页能打开（用 slug）
 *   ② 下架后：公开目录看不到、公开详情 404、学生读课程 403、**学生「我的课程」也不再列出**
 *   ③ 可逆：重新发布后目录又能看到（下架 != 删除，数据都在）
 *   ④ 清理：临时课程删除后取不到
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
  if (!token) throw new Error(`${username} 登录失败`);
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
const TITLE = `下架验证-临时课程-${stamp}`;
const catalogHasTitle = async () => {
  const list = pick(await call(student.token, '/browse/courses')) ?? [];
  return (list ?? []).some((c) => c.title === TITLE);
};

let courseId = null;
let slug = null;
try {
  courseId = pick(
    await call(admin.token, '/courses', { method: 'POST', body: { title: TITLE, term: '测试' } }),
  )?.id;
  await call(admin.token, `/courses/${courseId}/chapters`, {
    method: 'POST',
    body: { title: '验证用章节', order: 1, content: '# 临时章节', status: 'published' },
  });
  const published = pick(await call(admin.token, `/courses/${courseId}/publish`, { method: 'POST' }));
  slug = published?.slug;
  check('准备：建课 → 建章 → 发布（拿到 slug）', !!courseId && !!slug, `slug=${slug}`);

  // ---------- ① 发布后：公开可见 ----------
  check('发布后：公开目录里有这门课', await catalogHasTitle());
  const detailBefore = await call(student.token, `/browse/courses/${slug}`);
  check('发布后：公开详情页可打开', detailBefore.status === 200, `status=${detailBefore.status}`);

  // ---------- ② 下架后：三处都不可见 ----------
  const un = await call(admin.token, `/courses/${courseId}/unpublish`, { method: 'POST' });
  const afterUn = pick(un);
  check(
    '下架：状态回到 draft',
    (un.status === 200 || un.status === 201) && afterUn?.status === 'draft',
    `status=${un.status} course.status=${afterUn?.status}`,
  );
  check('下架后：公开目录里不再有这门课', !(await catalogHasTitle()));
  const detailAfter = await call(student.token, `/browse/courses/${slug}`);
  check('下架后：公开详情页 404', detailAfter.status === 404, `status=${detailAfter.status}`);

  const enrolled = await call(admin.token, `/courses/${courseId}/enrollments`, {
    method: 'POST',
    body: { studentIds: [student.user.id] },
  });
  const asStudent = await call(student.token, `/courses/${courseId}`);
  check(
    '下架后：已入册学生读课程也被拒（403「课程尚未发布」）',
    (enrolled.status === 200 || enrolled.status === 201) && asStudent.status === 403,
    `enroll=${enrolled.status} getCourse=${asStudent.status}`,
  );
  const myCourses = pick(await call(student.token, '/me/courses')) ?? [];
  check(
    '下架后：学生「我的课程」里也不再列出该课程',
    !(myCourses ?? []).some((c) => c.id === courseId),
    `我的课程 ${(myCourses ?? []).length} 门`,
  );

  // ---------- ③ 可逆：重新发布（数据没丢） ----------
  const chapters = pick(await call(admin.token, `/courses/${courseId}/chapters`));
  const re = pick(await call(admin.token, `/courses/${courseId}/publish`, { method: 'POST' }));
  check(
    '重新发布：章节还在（下架不删数据）、目录又可见',
    (chapters ?? []).length === 1 && re?.status === 'published' && (await catalogHasTitle()),
    `章节 ${(chapters ?? []).length} 个`,
  );
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
