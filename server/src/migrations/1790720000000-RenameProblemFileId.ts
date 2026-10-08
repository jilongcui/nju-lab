import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 命名统一：「标准测试数据集」→「题目包」（problem），2026-10-08。
 *
 * 这个 ZIP 里装的是题面（task.md）+ 评分细则（judge.md）+ IO 契约（manifest.json）
 * + 用例（cases/），本来就是一整份考卷 —— 沿用 "testDataset" 是包驱动改造
 * （2026-10-01）留下的历史称法。项目尚未发给学生，故直接改名而非兼容。
 *
 * 仅列改名，数据不动；`experiment_projects.testDatasetFileId` → `problemFileId`。
 */
export class RenameProblemFileId1790720000000 implements MigrationInterface {
  name = 'RenameProblemFileId1790720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `experiment_projects` CHANGE `testDatasetFileId` `problemFileId` varchar(36) NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `experiment_projects` CHANGE `problemFileId` `testDatasetFileId` varchar(36) NULL",
    );
  }
}
