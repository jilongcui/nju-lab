import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { User, UserRole } from './users/user.entity';
import {
  Chapter,
  ChapterStatus,
  Course,
  CourseStatus,
} from './courses/course.entity';
import { ChapterProgress, Enrollment } from './courses/enrollment.entity';
import {
  Assignment,
  ExperimentProject,
  ProjectStatus,
} from './projects/project.entity';
import { Evaluation, Submission } from './submissions/submission.entity';

/**
 * 种子数据：
 * - 教师 teacher/teacher123、学生 student1/student123
 * - 一门示例课程（已发布）：2 个已发布章节 + 1 个挂在第 2 章的已发布实验项目
 * - student1 已加入课程，发布项目时已为其生成 Assignment
 * 可重复执行：已存在的账号/课程不会重复创建。
 */
async function seed() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    username: process.env.DB_USERNAME || 'nju_lab',
    password: process.env.DB_PASSWORD || 'nju_lab_dev',
    database: process.env.DB_DATABASE || 'nju_lab',
    charset: 'utf8mb4',
    entities: [
      User,
      Course,
      Chapter,
      Enrollment,
      ChapterProgress,
      ExperimentProject,
      Assignment,
      Submission,
      Evaluation,
    ],
    synchronize: false,
    // 新环境先跑 migrations 建表再 seed（与 app.module 一致）
    migrationsRun: true,
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
  });
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const courseRepo = dataSource.getRepository(Course);
  const chapterRepo = dataSource.getRepository(Chapter);
  const enrollmentRepo = dataSource.getRepository(Enrollment);
  const projectRepo = dataSource.getRepository(ExperimentProject);
  const assignmentRepo = dataSource.getRepository(Assignment);

  async function ensureUser(
    username: string,
    password: string,
    nickname: string,
    role: UserRole,
  ): Promise<User> {
    let user = await userRepo.findOne({ where: { username } });
    if (!user) {
      user = await userRepo.save(
        userRepo.create({
          username,
          nickname,
          role,
          passwordHash: await bcrypt.hash(password, 10),
        }),
      );
      console.log(`创建用户 ${username} (${role})`);
    } else {
      console.log(`用户 ${username} 已存在，跳过`);
    }
    return user;
  }

  await ensureUser('admin', 'admin123', '管理员', UserRole.ADMIN);
  const teacher = await ensureUser(
    'teacher',
    'teacher123',
    '示例教师',
    UserRole.TEACHER,
  );
  const student1 = await ensureUser(
    'student1',
    'student123',
    '示例学生一',
    UserRole.STUDENT,
  );

  const COURSE_TITLE = 'Skill 工程导论（示例课程）';
  let course = await courseRepo.findOne({
    where: { title: COURSE_TITLE, teacherId: teacher.id },
  });
  if (!course) {
    course = await courseRepo.save(
      courseRepo.create({
        title: COURSE_TITLE,
        teacherId: teacher.id,
        term: '2026 秋',
        description: '课程学习 → 解锁实验 → 提交 Skill 包 → 平台复验评分 的示例课程',
        status: CourseStatus.PUBLISHED,
      }),
    );
    console.log(`创建课程：${course.title}`);

    const chapter1 = await chapterRepo.save(
      chapterRepo.create({
        courseId: course.id,
        order: 1,
        title: '第 1 章：Skill 工程与 DSH 概览',
        content:
          '# Skill 工程与 DSH 概览\n\n介绍 Skill 的目录结构、SKILL.md frontmatter 规范与 DSH 运行时基础。',
        status: ChapterStatus.PUBLISHED,
      }),
    );
    const chapter2 = await chapterRepo.save(
      chapterRepo.create({
        courseId: course.id,
        order: 2,
        title: '第 2 章：实验一——编写你的第一个 Skill',
        content:
          '# 编写你的第一个 Skill\n\n基于模板完成一个数据处理 Skill，并用标准测试数据集自测。',
        status: ChapterStatus.PUBLISHED,
      }),
    );
    console.log('创建章节 x2');

    const project = await projectRepo.save(
      projectRepo.create({
        courseId: course.id,
        chapterId: chapter2.id,
        title: '实验一：CSV 数据清洗 Skill',
        objectives: '掌握 Skill 目录结构、能力边界描述与本地自测流程',
        background: '回顾第 1 章的 Skill 规范；跑通用标准数据集自测、打包提交闭环',
        description:
          '1. 领取模板并解压\n2. 编写 SKILL.md 与清洗脚本\n3. 用标准数据集自测\n4. 打包提交 Skill 包与证据包',
        skillTemplateFileId: null,
        testDatasetFileId: null,
        evalConfig: {
          // 与 DSH 的默认对齐（`agent-default-model`: provider deepseek-official,
          // model deepseek-flash），学生本地不用额外配置就能跑。
          //
          // `reasoningEffort` 可写，但**只能取 off / low / high / max**
          // （dsh-llm-deepseek 实测接受的集合，2026-10-01 在 pkg2 镜像内复核；不填 = provider 默认）。
          // 其他取值 —— 尤其 DeepSeek **官方 API** 的 none/minimal/medium/xhigh ——
          // 会让 DSH 在 claim 之后**每个请求都失败**；该约束由
          // ProjectsService.assertEvalConfig 白名单 + 教师端下拉框双重兜住。
          model: 'deepseek-flash',
          tools: ['shell', 'fs'],
          timeoutSeconds: 600,
        },
        rubric: [
          { name: '规范完整度', weight: 15 },
          { name: '能力边界填写质量', weight: 25 },
          { name: '实测有效性', weight: 40 },
          { name: '证据完整性', weight: 10 },
          { name: '工程效率', weight: 10 },
        ],
        references: 'dsh-handbook 第 3 章',
        faq: 'Q: 模板解压失败？\nA: 确认 ZIP 未嵌套多余目录。',
        unlockRule: { type: 'default' },
        deadline: new Date('2026-12-31T23:59:59+08:00'),
        status: ProjectStatus.PUBLISHED,
      }),
    );
    console.log(`创建实验项目：${project.title}`);

    await enrollmentRepo.save(
      enrollmentRepo.create({ courseId: course.id, studentId: student1.id }),
    );
    await assignmentRepo.save(
      assignmentRepo.create({ projectId: project.id, studentId: student1.id }),
    );
    console.log('student1 已加入课程并生成 Assignment');
  } else {
    console.log('示例课程已存在，跳过');
  }

  await dataSource.destroy();
  console.log('seed 完成');
}

seed().catch((err) => {
  console.error('seed 失败：', err);
  process.exit(1);
});
