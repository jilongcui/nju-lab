#!/usr/bin/env node
/**
 * 把 Markdown 正文更新到课程平台的指定章节（chapters.content）。
 *
 * 用法：
 *   node update-chapter.cjs --title "大语言模型原理和实践"                 # 只定位、预览，不写入
 *   node update-chapter.cjs --title "大语言模型原理和实践" --file body.md  # 写入正文并回读校验
 *   node update-chapter.cjs --id <chapter-uuid> --file body.md
 *   node update-chapter.cjs --title "旧标题" --new-title "新标题"          # 修改章节标题
 *   node update-chapter.cjs --title "旧标题" --new-title "新标题" --file body.md  # 标题 + 正文一起改
 *
 * 安全约定：
 *   - 数据库口令由本脚本通过 server/.env 自行加载（dotenv），绝不在终端打印；
 *   - 不要使用 mysql 命令行明文密码，不要 cat/复制 server/.env；
 *   - 标题命中 0 个或多个章节时，只列出候选并退出，绝不猜测写入。
 */
const fs = require('fs');
const path = require('path');

// 本文件位于 <仓库根>/.kimi-code/skills/update-chapter/，向上三级即仓库根
const ROOT = path.resolve(__dirname, '..', '..', '..');
const { DataSource } = require(path.join(ROOT, 'server/node_modules/typeorm'));
require(path.join(ROOT, 'server/node_modules/dotenv')).config({
  path: path.join(ROOT, 'server/.env'),
});

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      console.error(`无法识别的参数: ${key}`);
      process.exit(2);
    }
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.id && !args.title) {
    console.error('必须提供 --id 或 --title（精确匹配，失败时自动退化为模糊搜索列出候选）');
    process.exit(2);
  }
  if (args.file) {
    if (!fs.existsSync(args.file)) {
      console.error(`正文文件不存在: ${args.file}`);
      process.exit(2);
    }
    if (fs.readFileSync(args.file, 'utf8').trim().length === 0) {
      console.error('正文文件为空，拒绝写入。');
      process.exit(2);
    }
  }

  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'nju_lab',
    charset: 'utf8mb4',
  });
  await ds.initialize();

  const COLS = `c.id, c.courseId, c.title, c.\`order\`, c.status, co.title AS courseTitle,
                LENGTH(c.content) AS contentLen, LEFT(c.content, 60) AS head`;
  let rows;
  if (args.id) {
    rows = await ds.query(
      `SELECT ${COLS} FROM chapters c JOIN courses co ON co.id = c.courseId WHERE c.id = ?`,
      [args.id],
    );
  } else {
    rows = await ds.query(
      `SELECT ${COLS} FROM chapters c JOIN courses co ON co.id = c.courseId WHERE c.title = ?`,
      [args.title],
    );
    if (rows.length === 0) {
      rows = await ds.query(
        `SELECT ${COLS} FROM chapters c JOIN courses co ON co.id = c.courseId WHERE c.title LIKE ?`,
        [`%${args.title}%`],
      );
    }
  }

  if (rows.length === 0) {
    console.error('未找到匹配章节。平台现有章节：');
    const all = await ds.query(
      `SELECT DISTINCT c.title, co.title AS courseTitle FROM chapters c JOIN courses co ON co.id = c.courseId ORDER BY co.title, c.title`,
    );
    for (const r of all) console.error(`  [${r.courseTitle}] ${r.title}`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`命中 ${rows.length} 个章节，请改用 --id 指定：`);
    for (const r of rows) {
      console.error(`  ${r.id}  [${r.courseTitle}] 第${r.order}章 《${r.title}》 (${r.status}, 正文${r.contentLen}字节)`);
    }
    process.exit(1);
  }

  const ch = rows[0];
  console.log(`定位章节: ${ch.id}`);
  console.log(`  课程「${ch.courseTitle}」第${ch.order}章 《${ch.title}》 status=${ch.status} 当前正文 ${ch.contentLen} 字节`);

  const wantRename = args['new-title'] !== undefined;
  const newTitle = (args['new-title'] || '').trim();
  if (wantRename && !newTitle) {
    console.error('--new-title 不能为空。');
    process.exit(2);
  }

  if (!args.file && !wantRename) {
    console.log('（预览模式，未提供 --file / --new-title，不写入）');
    await ds.destroy();
    return;
  }

  if (wantRename) {
    if (newTitle === ch.title) {
      console.log('新标题与原标题相同，标题不变。');
    } else {
      // 同一课程内不允许两章同名，否则 --title 定位会失效
      const dup = await ds.query(
        'SELECT id FROM chapters WHERE courseId = ? AND title = ? AND id != ?',
        [ch.courseId, newTitle, ch.id],
      );
      if (dup.length > 0) {
        console.error(`课程「${ch.courseTitle}」内已存在同名章节《${newTitle}》（${dup[0].id}），拒绝改名。`);
        process.exit(1);
      }
      await ds.query('UPDATE chapters SET title = ? WHERE id = ?', [newTitle, ch.id]);
      console.log(`标题: 「${ch.title}」→「${newTitle}」`);
    }
  }

  if (args.file) {
    const content = fs.readFileSync(args.file, 'utf8');
    const res = await ds.query('UPDATE chapters SET content = ? WHERE id = ?', [content, ch.id]);
    console.log(`正文 UPDATE affectedRows: ${res.affectedRows}（原 ${ch.contentLen} 字节 → 新 ${Buffer.byteLength(content, 'utf8')} 字节）`);
  }

  const [back] = await ds.query(
    'SELECT title, LENGTH(content) AS len, LEFT(content, 60) AS head, RIGHT(content, 60) AS tail FROM chapters WHERE id = ?',
    [ch.id],
  );
  console.log(`回读校验: title=《${back.title}》 len=${back.len}`);
  console.log(`  head: ${JSON.stringify(back.head)}`);
  console.log(`  tail: ${JSON.stringify(back.tail)}`);

  try {
    const decks = await ds.query('SELECT chapterId FROM slide_decks WHERE chapterId = ?', [ch.id]);
    if (decks.length > 0) {
      console.log('注意：该章已存在幻灯片 deck，教师端将提示「章节内容已变更」，需在章节页手动重新生成。');
    }
  } catch {
    // slide_decks 表不存在时忽略（老库无此功能）
  }

  await ds.destroy();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
