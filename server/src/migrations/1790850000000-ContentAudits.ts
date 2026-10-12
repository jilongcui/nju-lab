import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 内容操作记录（多教师协作的配套能力，见 docs/DESIGN-2026-10-11-course-co-teachers.md）。
 *
 * 只加一张表，纯追加、不改既有数据：`down` 删表即回到原状。
 * 记录粒度是「一次写操作一行」（章节保存/删除、幻灯片保存/生成、课程信息更新、
 * 转让、协作名单变更、删课），不存内容快照。
 */
export class ContentAudits1790850000000 implements MigrationInterface {
  name = 'ContentAudits1790850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE `content_audits` (`id` varchar(36) NOT NULL, `courseId` varchar(36) NOT NULL, `action` varchar(32) NOT NULL, `targetType` varchar(16) NOT NULL, `targetId` varchar(36) NULL, `summary` varchar(255) NOT NULL, `actorId` varchar(36) NOT NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_content_audits_course` (`courseId`), INDEX `IDX_content_audits_actor` (`actorId`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE `content_audits`");
  }
}
