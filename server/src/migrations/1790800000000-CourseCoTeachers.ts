import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 课程多教师协作 + 编辑乐观锁（见 docs/DESIGN-2026-10-11-course-co-teachers.md）。
 *
 *  - 新增 `course_teachers`：课程的授课教师名单（**主教师也在表里**），
 *    「谁能编辑这门课」以它为唯一真源；`UNIQUE(courseId, userId)` 防重复添加。
 *  - `chapters` / `slide_decks` 增加 `version`（乐观锁，每次成功保存 +1）与
 *    `updatedBy`（最后一次保存者 —— 冲突提示要说清「被谁改了」）。
 *  - **回灌**：把现有 `courses.teacherId` 写进名单（`NOT EXISTS` 幂等，可重复执行）。
 *
 * 回滚（`down`）：删表删列即可退回单教师 —— 全程**不修改 `courses.teacherId`**，
 * 所以多教师是「加法」，随时可退。
 */
export class CourseCoTeachers1790800000000 implements MigrationInterface {
  name = 'CourseCoTeachers1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE `course_teachers` (`id` varchar(36) NOT NULL, `courseId` varchar(255) NOT NULL, `userId` varchar(255) NOT NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_course_teachers_course` (`courseId`), INDEX `IDX_course_teachers_user` (`userId`), UNIQUE INDEX `uq_course_teacher` (`courseId`, `userId`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
    );
    await queryRunner.query(
      "ALTER TABLE `chapters` ADD `version` int NOT NULL DEFAULT 0",
    );
    await queryRunner.query("ALTER TABLE `chapters` ADD `updatedBy` varchar(36) NULL");
    await queryRunner.query(
      "ALTER TABLE `slide_decks` ADD `version` int NOT NULL DEFAULT 0",
    );
    await queryRunner.query(
      "ALTER TABLE `slide_decks` ADD `updatedBy` varchar(36) NULL",
    );
    // 回灌现有归属：主教师自己也要进名单（幂等，重复执行不会产生重复行）
    await queryRunner.query(
      "INSERT INTO `course_teachers` (`id`, `courseId`, `userId`) SELECT UUID(), c.`id`, c.`teacherId` FROM `courses` c WHERE NOT EXISTS (SELECT 1 FROM `course_teachers` ct WHERE ct.`courseId` = c.`id` AND ct.`userId` = c.`teacherId`)",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `slide_decks` DROP COLUMN `updatedBy`");
    await queryRunner.query("ALTER TABLE `slide_decks` DROP COLUMN `version`");
    await queryRunner.query("ALTER TABLE `chapters` DROP COLUMN `updatedBy`");
    await queryRunner.query("ALTER TABLE `chapters` DROP COLUMN `version`");
    await queryRunner.query("DROP TABLE `course_teachers`");
  }
}
