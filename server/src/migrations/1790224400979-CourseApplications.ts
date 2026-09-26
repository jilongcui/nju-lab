import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 课程公开目录与申请审批（见 docs/DESIGN-course-application-2026-09-24.md）。
 *
 *  - 新增 `course_applications`：含生成列 `pendingFlag` + 唯一索引
 *    `uq_course_application_pending`，实现「允许重复申请，但同一课程同一学生
 *    同时只能有一条 pending」（借助 MySQL 唯一索引允许多个 NULL）。
 *  - `courses` 增加 `slug` / `capacity` / `applicationOpenAt` / `applicationCloseAt`。
 *  - 回填既有课程的 `slug`（公开页 `/lab/course/<slug>` 需要）。
 *
 * 注：`typeorm_metadata` 的库名用 `DATABASE()` 动态取，不写死 `nju_lab`，
 * 以便同一份迁移能在测试库 / 他校部署上执行。
 */
export class CourseApplications1790224400979 implements MigrationInterface {
  name = 'CourseApplications1790224400979';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE `course_applications` (`id` varchar(36) NOT NULL, `courseId` varchar(255) NOT NULL, `studentId` varchar(255) NOT NULL, `status` enum ('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending', `decisionNote` text NULL, `decidedBy` varchar(36) NULL, `decidedAt` datetime NULL, `pendingFlag` tinyint AS (IF(`status` = 'pending', 1, NULL)) STORED NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_20a49f9626fb993b57a48cb080` (`courseId`), INDEX `IDX_398070296d606e02521fabd210` (`studentId`), UNIQUE INDEX `uq_course_application_pending` (`courseId`, `studentId`, `pendingFlag`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
    );
    await queryRunner.query(
      "INSERT INTO `typeorm_metadata`(`database`, `schema`, `table`, `type`, `name`, `value`) VALUES (DATABASE(), DATABASE(), ?, ?, ?, ?)",
      [
        'course_applications',
        'GENERATED_COLUMN',
        'pendingFlag',
        "IF(`status` = 'pending', 1, NULL)",
      ],
    );
    await queryRunner.query(
      "ALTER TABLE `courses` ADD `slug` varchar(128) NULL",
    );
    await queryRunner.query(
      "ALTER TABLE `courses` ADD UNIQUE INDEX `IDX_a3bb2d01cfa0f95bc5e034e1b7` (`slug`)",
    );
    await queryRunner.query("ALTER TABLE `courses` ADD `capacity` int NULL");
    await queryRunner.query(
      "ALTER TABLE `courses` ADD `applicationOpenAt` datetime NULL",
    );
    await queryRunner.query(
      "ALTER TABLE `courses` ADD `applicationCloseAt` datetime NULL",
    );
    // 回填既有课程的 slug：用 id 前 8 位，保证唯一可用
    await queryRunner.query(
      "UPDATE `courses` SET `slug` = CONCAT('course-', LEFT(REPLACE(`id`, '-', ''), 8)) WHERE `slug` IS NULL",
    );
    await queryRunner.query(
      "ALTER TABLE `course_applications` ADD CONSTRAINT `FK_20a49f9626fb993b57a48cb0802` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION",
    );
    await queryRunner.query(
      "ALTER TABLE `course_applications` ADD CONSTRAINT `FK_398070296d606e02521fabd2108` FOREIGN KEY (`studentId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `course_applications` DROP FOREIGN KEY `FK_398070296d606e02521fabd2108`",
    );
    await queryRunner.query(
      "ALTER TABLE `course_applications` DROP FOREIGN KEY `FK_20a49f9626fb993b57a48cb0802`",
    );
    await queryRunner.query(
      "ALTER TABLE `courses` DROP COLUMN `applicationCloseAt`",
    );
    await queryRunner.query(
      "ALTER TABLE `courses` DROP COLUMN `applicationOpenAt`",
    );
    await queryRunner.query("ALTER TABLE `courses` DROP COLUMN `capacity`");
    await queryRunner.query(
      "ALTER TABLE `courses` DROP INDEX `IDX_a3bb2d01cfa0f95bc5e034e1b7`",
    );
    await queryRunner.query("ALTER TABLE `courses` DROP COLUMN `slug`");
    await queryRunner.query(
      "DELETE FROM `typeorm_metadata` WHERE `type` = ? AND `name` = ? AND `schema` = DATABASE() AND `table` = ?",
      ['GENERATED_COLUMN', 'pendingFlag', 'course_applications'],
    );
    await queryRunner.query(
      "DROP INDEX `uq_course_application_pending` ON `course_applications`",
    );
    await queryRunner.query(
      "DROP INDEX `IDX_398070296d606e02521fabd210` ON `course_applications`",
    );
    await queryRunner.query(
      "DROP INDEX `IDX_20a49f9626fb993b57a48cb080` ON `course_applications`",
    );
    await queryRunner.query("DROP TABLE `course_applications`");
  }
}
