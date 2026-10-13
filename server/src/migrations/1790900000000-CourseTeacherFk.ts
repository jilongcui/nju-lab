import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * `course_teachers` 补外键（2026-10-12 实测发现的问题）。
 *
 * 建表时只建了索引、**没建外键**，于是删除课程后名单行残留 —— 实测库里已积了 4 条孤儿
 * （指向已删课程）。本迁移：① 清掉孤儿行；② 补 `courseId` / `userId` 两个外键并 **ON DELETE CASCADE**，
 * 让"删课 → 名单自动清理"由数据库保证，不再依赖 service 记得手写 delete。
 *
 * 注：`content_audits.courseId` **故意不加外键** —— 删课后操作记录要保留（见该实体的注释）。
 */
export class CourseTeacherFk1790900000000 implements MigrationInterface {
  name = 'CourseTeacherFk1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ① 清孤儿（课程或用户已被删）
    await queryRunner.query(
      "DELETE ct FROM `course_teachers` ct LEFT JOIN `courses` c ON c.`id` = ct.`courseId` WHERE c.`id` IS NULL",
    );
    await queryRunner.query(
      "DELETE ct FROM `course_teachers` ct LEFT JOIN `users` u ON u.`id` = ct.`userId` WHERE u.`id` IS NULL",
    );
    // ② 列宽对齐被引用列（courses.id / users.id 都是 varchar(36)），否则外键建不上
    await queryRunner.query(
      "ALTER TABLE `course_teachers` MODIFY `courseId` varchar(36) NOT NULL, MODIFY `userId` varchar(36) NOT NULL",
    );
    // ③ 外键 + 级联删除
    await queryRunner.query(
      "ALTER TABLE `course_teachers` ADD CONSTRAINT `fk_course_teachers_course` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE",
    );
    await queryRunner.query(
      "ALTER TABLE `course_teachers` ADD CONSTRAINT `fk_course_teachers_user` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `course_teachers` DROP FOREIGN KEY `fk_course_teachers_user`");
    await queryRunner.query("ALTER TABLE `course_teachers` DROP FOREIGN KEY `fk_course_teachers_course`");
    await queryRunner.query(
      "ALTER TABLE `course_teachers` MODIFY `courseId` varchar(255) NOT NULL, MODIFY `userId` varchar(255) NOT NULL",
    );
  }
}
