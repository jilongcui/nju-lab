import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 难度不再允许为空：**默认「中等」（medium）**（2026-10-13 用户补充："难度默认选择中，也不能是 null"）。
 *
 * 上一个迁移 `1791000000000-ProjectContentDifficulty` 把 `difficulty` 加成了**可空**列
 * （当时的语义是"不填 = 未标注"）。现在取消"未标注"这个状态：每个实验总有一个难度，
 * 没特意标就是 medium —— 学生端才能稳定地按难度筛选。
 *
 * 已在生产执行过上一个迁移，所以这里**不改它**（改了也不会重跑），而是新开一个：
 *   ① 把现有 NULL 行回填成 medium；
 *   ② 列改成 NOT NULL DEFAULT 'medium'。
 * `down` 恢复成可空（值保留，无法区分原本的 NULL）。
 */
export class ProjectDifficultyDefault1791100000000 implements MigrationInterface {
  name = 'ProjectDifficultyDefault1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE `experiment_projects` SET `difficulty` = 'medium' WHERE `difficulty` IS NULL",
    );
    await queryRunner.query(
      "ALTER TABLE `experiment_projects` MODIFY `difficulty` enum('easy','medium','hard') NOT NULL DEFAULT 'medium'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `experiment_projects` MODIFY `difficulty` enum('easy','medium','hard') NULL",
    );
  }
}
