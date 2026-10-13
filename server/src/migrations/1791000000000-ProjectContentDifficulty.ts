import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 实验项目补两列（2026-10-13 学员反馈）：
 *   ① `content` —— **实验内容**：学生实验详情页首屏展示的"这个实验做什么"。
 *      在此之前的题干只存在于题目包 ZIP 的 `task.md` 里，学生必须下载解压才看得到；
 *      详情页显眼的反而是评估模型/推理档位这类技术配置。
 *   ② `difficulty` —— **难度等级**（easy / medium / hard，**可空** = 未标注）。
 *
 * 纯追加、无回填：`content` 留空由教师按新口径填写（出题流程见 docs/EXPERIMENT-CREATION-GUIDE.md），
 * `difficulty` 可空所以不猜默认值。`down` 删两列即回退。
 */
export class ProjectContentDifficulty1791000000000 implements MigrationInterface {
  name = 'ProjectContentDifficulty1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `experiment_projects` ADD `content` text NULL',
    );
    await queryRunner.query(
      "ALTER TABLE `experiment_projects` ADD `difficulty` enum('easy','medium','hard') NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `experiment_projects` DROP COLUMN `difficulty`');
    await queryRunner.query('ALTER TABLE `experiment_projects` DROP COLUMN `content`');
  }
}
