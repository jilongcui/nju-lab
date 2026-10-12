#!/usr/bin/env node
/**
 * 多教师协作 + 编辑乐观锁的接口级验证（打真实 API，不碰真实课程数据）。
 *
 * 用法：`node server/tools/verify-co-teachers.mjs`
 * 前置：服务在 127.0.0.1:3100 运行；账号 admin/admin123（管理员）、teacher/teacher123（普通教师）。
 *
 * 设计：**全程用一门临时课程**（标题带「协作验证」），最后删掉 ——
 * 这样「删课/转让」这类破坏性操作若权限判定有 bug，也不会波及真实课程。
 * 覆盖（见 docs/DESIGN-2026-10-11-course-co-teachers.md）：
 *   ① 主教师/管理员可指定协作教师，名单读得出（owner + co_teacher）
 *   ② 协作教师能编辑内容（建章节 200、保存 200）
 *   ③ 协作教师**不能**删课 / 转让 / 改名单（403）
 *   ④ 乐观锁：过期 version 保存 → 409 且带 currentVersion + updatedBy；新 version → 200
 *   ⑤ 清理：临时课程删除、真实课程名单未被改动
 */
const API = 'http://127.0.0.1:3100/api';

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
const teacher = await login('teacher', 'teacher123');
// 真实课程：只读校验用（不写）
const REAL_COURSE = 'cd11ea33-0f1f-420a-afbc-951baf1f5e89';

let tempCourseId = null;
try {
  // ---------- 准备：临时课程 ----------
  const created = await call(admin.token, '/courses', {
    method: 'POST',
    body: { title: `协作验证-临时课程-${Date.now()}`, term: '测试' },
  });
  tempCourseId = created.data?.data?.id ?? created.data?.id;
  check('管理员建临时课程（验证用完即删）', created.status === 201 || created.status === 200, `status=${created.status}`);

  // ---------- ① 指定协作教师 + 名单可读 ----------
  const setRes = await call(admin.token, `/courses/${tempCourseId}/teachers`, {
    method: 'PUT',
    body: { userIds: [teacher.user.id] },
  });
  check('管理员指定协作教师（PUT /teachers）', setRes.status === 200, `status=${setRes.status}`);
  const listRes = await call(admin.token, `/courses/${tempCourseId}/teachers`);
  const teachers = listRes.data?.data?.teachers ?? listRes.data?.teachers ?? [];
  check(
    '名单返主教师 + 协作者（角色正确）',
    teachers.length === 2 &&
      teachers.filter((t) => t.role === 'owner').length === 1 &&
      teachers.some((t) => t.id === teacher.user.id && t.role === 'co_teacher'),
    teachers.map((t) => `${t.nickname}:${t.role}`).join(', '),
  );
  const teacherSees = await call(teacher.token, `/courses/${tempCourseId}`);
  check('协作教师能看到课程详情（多教师列表接口按名单过滤）', teacherSees.status === 200, `status=${teacherSees.status}`);

  // ---------- ② 协作教师可编辑内容 ----------
  const mk = await call(teacher.token, `/courses/${tempCourseId}/chapters`, {
    method: 'POST',
    body: { title: '协作者建的章节', content: '正文', order: 1, status: 'published' },
  });
  check('协作教师能建章节（编辑权同等）', mk.status === 201 || mk.status === 200, `status=${mk.status}`);
  const chapter = mk.data?.data ?? mk.data;
  check('章节带乐观锁 version', typeof chapter?.version === 'number', `version=${chapter?.version}`);

  // ---------- ③ 协作教师不能删课 / 转让 / 改名单 ----------
  const putTeachers = await call(teacher.token, `/courses/${tempCourseId}/teachers`, {
    method: 'PUT',
    body: { userIds: [] },
  });
  check('协作教师不能改协作名单（403）', putTeachers.status === 403, `status=${putTeachers.status}`);

  const transfer = await call(teacher.token, `/courses/${tempCourseId}`, {
    method: 'PATCH',
    body: { teacherId: teacher.user.id },
  });
  check('协作教师不能转让主教师（403）', transfer.status === 403, `status=${transfer.status}`);

  const del = await call(teacher.token, `/courses/${tempCourseId}`, { method: 'DELETE' });
  check('协作教师不能删除课程（403）', del.status === 403, `status=${del.status}`);
  const stillThere = await call(admin.token, `/courses/${tempCourseId}`);
  check('删课被拒后课程仍在（未误删）', stillThere.status === 200);

  // ---------- ④ 乐观锁（章节）----------
  const saveBase = { id: chapter.id, title: chapter.title, content: chapter.content, order: chapter.order, status: chapter.status };
  const saved = await call(teacher.token, `/courses/${tempCourseId}/chapters`, {
    method: 'POST',
    body: { ...saveBase, version: chapter.version },
  });
  const afterFirst = saved.data?.data ?? saved.data;
  check('协作者按当前 version 保存成功，version 递增', saved.status === 201 || saved.status === 200, `version ${chapter.version} → ${afterFirst?.version}`);

  const stale = await call(admin.token, `/courses/${tempCourseId}/chapters`, {
    method: 'POST',
    body: { ...saveBase, version: chapter.version }, // 故意用**过期**版本
  });
  const conflict = stale.data?.data ?? stale.data;
  check('过期 version 保存被拒（409）', stale.status === 409, `status=${stale.status}`);
  check(
    '409 体带 currentVersion 与 updatedBy（冲突提示要说清被谁改了）',
    typeof conflict?.currentVersion === 'number' && !!conflict?.updatedBy?.nickname,
    JSON.stringify(conflict).slice(0, 120),
  );

  const retry = await call(admin.token, `/courses/${tempCourseId}/chapters`, {
    method: 'POST',
    body: { ...saveBase, version: afterFirst?.version },
  });
  check('用最新 version 重试成功（不是永久锁死）', retry.status === 201 || retry.status === 200, `status=${retry.status}`);

  // ---------- ⑤ 真实课程未被本次验证波及 ----------
  const realList = await call(admin.token, `/courses/${REAL_COURSE}/teachers`);
  const realTeachers = realList.data?.data?.teachers ?? realList.data?.teachers ?? [];
  check(
    '真实课程（分子医学）名单仍是 1 人，未被改动',
    realTeachers.length === 1,
    realTeachers.map((t) => `${t.nickname}:${t.role}`).join(', '),
  );
} finally {
  // ---------- 清理 ----------
  if (tempCourseId) {
    const removed = await call(admin.token, `/courses/${tempCourseId}`, { method: 'DELETE' });
    check('清理：删除临时课程', removed.status === 200 || removed.status === 204, `status=${removed.status}`);
  }
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(([label]) => console.log('  ·', label));
  process.exitCode = 1;
}
