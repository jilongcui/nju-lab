import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 提交多版本：submissions 增加 version 列（同一 assignmentId 下从 1 递增）。
 * 存量数据按 submittedAt 升序回填版本号（此前 failed 后可重交，同一任务可能已有多行）。
 */
export class SubmissionVersions1790002700000 implements MigrationInterface {
  name = 'SubmissionVersions1790002700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `submissions` ADD `version` int NOT NULL DEFAULT '1'",
    );
    await queryRunner.query(
      `UPDATE \`submissions\` s
       JOIN (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY assignmentId ORDER BY submittedAt ASC, id ASC) AS v
         FROM \`submissions\`
       ) ranked ON ranked.id = s.id
       SET s.version = ranked.v`,
    );
    await queryRunner.query(
      'CREATE INDEX `IDX_submissions_assignment_version` ON `submissions` (`assignmentId`, `version`)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX `IDX_submissions_assignment_version` ON `submissions`',
    );
    await queryRunner.query('ALTER TABLE `submissions` DROP COLUMN `version`');
  }
}
