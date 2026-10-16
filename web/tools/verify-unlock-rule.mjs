#!/usr/bin/env node
/**
 * 实验解锁规则验证（纯 API，不开浏览器、不烧模型额度）
 *
 * **规则（2026-10-17 起）**：默认解锁 = **完成本实验所属章节**即可领取 —— 支持跳级学习，
 * 学生可以从任意章节开始，学完哪章就能做哪章的实验。
 * 旧口径是「完成该实验所属章节**之前的全部已发布章节**」，两者在"跳级"场景下结论相反：
 * 例：学生完成第 1–7 章、第 8 章只读了一半 → 旧规则「第 8 章实验可领」，新规则「不可领」。
 *
 * 用法：
 *   node web/tools/verify-unlock-rule.mjs
 *   VERIFY_API=http://127.0.0.1:3101/api node web/tools/verify-unlock-rule.mjs
 *   VERIFY_STUDENT=student1 VERIFY_STUDENT_PASSWORD=student123 node web/tools/verify-unlock-rule.mjs
 *
 * 怎么判（**不写死"某章必须解锁"**）：用学生自己的章节进度推导应然值，再跟接口返回比对 ——
 * 这样脚本只依赖规则本身，不依赖示例数据的分布。
 * 另有一条**分歧样本**断言：找「本章未完成、但更靠前的章节也没完成」的实验，它必须是未解锁的
 * —— 只有这条能真正区分新旧规则（连续学习时两种口径结论相同，等于没验）。
 */
const API = (process.env.VERIFY_API || 'http://127.0.0.1:3100/api').replace(/\/+$/, '');
const USERNAME = process.env.VERIFY_STUDENT || 'student1';
const PASSWORD = process.env.VERIFY_STUDENT_PASSWORD || 'student123';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  | ' + extra : ''}`);
};

const api = async (path, token) => {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${JSON.stringify(body).slice(0, 160)}`);
  return body?.data ?? body;
};

const login = async () => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const body = await res.json().catch(() => null);
  const token = body?.data?.accessToken;
  if (!token) throw new Error(`${USERNAME} 登录失败：${JSON.stringify(body).slice(0, 160)}`);
  return token;
};

const token = await login();
const courses = await api('/me/courses', token);
const assignments = await api('/me/assignments', token);
console.log(`学生 ${USERNAME}：${courses.length} 门课、${assignments.length} 个实验任务\n`);

/** 章节 id → { order, title, status, courseTitle }（跨课程合并；order 只在课程内可比） */
const chapterById = new Map();
const chaptersByCourse = new Map();
for (const course of courses) {
  chaptersByCourse.set(
    course.id,
    (course.chapters ?? []).map((c) => ({ ...c, courseId: course.id, courseTitle: course.title })),
  );
  for (const chapter of course.chapters ?? []) {
    chapterById.set(chapter.id, { ...chapter, courseId: course.id, courseTitle: course.title });
  }
}

let checked = 0;
let divergent = 0;
let divergentOk = 0;
const unresolved = [];
for (const assignment of assignments) {
  const chapter = chapterById.get(assignment.project.chapterId);
  if (!chapter) {
    unresolved.push(assignment.project.title);
    continue;
  }
  checked += 1;
  // 新规则：只看本实验所属章节是否完成
  const expected = chapter.status === 'completed';
  check(
    `${chapter.courseTitle} · 第${chapter.order}章「${chapter.title}」→ ${assignment.project.title}`,
    assignment.unlocked === expected,
    `本章=${chapter.status} unlocked=${assignment.unlocked} 应=${expected}`,
  );

  // 分歧样本：**本章未完成、但更靠前的章节全都完成了** —— 这正是两种口径结论相反的情形：
  //   旧规则「前面的都学完了 → 可领」，新规则「本章没学完 → 不可领」。它必须是 false。
  if (!expected) {
    const earlier = (chaptersByCourse.get(chapter.courseId) ?? []).filter((c) => c.order < chapter.order);
    const earlierAllDone = earlier.length > 0 && earlier.every((c) => c.status === 'completed');
    if (earlierAllDone) {
      divergent += 1;
      if (assignment.unlocked === false) divergentOk += 1;
    }
  }
}

console.log('');
check(
  `有 ${checked} 个实验按「完成本实验所属章节」口径判定一致`,
  checked > 0,
  `checked=${checked}`,
);
if (unresolved.length) {
  console.log(`  ⚠ 未匹配到章节的实验（已跳过）：${unresolved.join('、')}`);
}
if (divergent === 0) {
  console.log(
    '  ⚠ 当前数据里没有分歧样本（"前面全学完、本章没学完"的实验）——' +
      '这条没验到，需要造数据或换一个学生再跑',
  );
} else {
  check(
    `分歧样本 ${divergent} 条全部未解锁（这些实验在旧规则下会被判为可领）`,
    divergentOk === divergent,
    `${divergentOk}/${divergent}`,
  );
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
