import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 初始 schema（与 2026-09-21 时点的实体全量一致；由空库 schema:log 生成）。
 * 既有数据库（synchronize 建表）通过手工 INSERT migrations 记录跳过本迁移；
 * 新环境由 migrationsRun 全量建表。
 */
export class InitialSchema1790002605000 implements MigrationInterface {
  name = 'InitialSchema1790002605000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TABLE `users` (`id` varchar(36) NOT NULL, `username` varchar(255) NOT NULL, `passwordHash` varchar(255) NOT NULL, `nickname` varchar(255) NOT NULL, `role` enum ('admin', 'teacher', 'student') NOT NULL, `tokenVersion` int NOT NULL DEFAULT '0', `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_fe0bb3f6520ee0469504521e71` (`username`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `courses` (`id` varchar(36) NOT NULL, `title` varchar(255) NOT NULL, `teacherId` varchar(255) NOT NULL, `term` varchar(255) NOT NULL DEFAULT '', `description` text NULL, `status` enum ('draft', 'published', 'archived') NOT NULL DEFAULT 'draft', `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_f921bd9bb6d061b90d386fa372` (`teacherId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `chapters` (`id` varchar(36) NOT NULL, `courseId` varchar(255) NOT NULL, `order` int NOT NULL, `title` varchar(255) NOT NULL, `content` text NULL, `exampleSkills` json NULL, `status` enum ('draft', 'published') NOT NULL DEFAULT 'draft', `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_becd2c25ed5b601e7a4466271c` (`courseId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `experiment_projects` (`id` varchar(36) NOT NULL, `courseId` varchar(255) NOT NULL, `chapterId` varchar(255) NOT NULL, `title` varchar(255) NOT NULL, `objectives` text NULL, `background` text NULL, `description` text NULL, `skillTemplateFileId` varchar(36) NULL, `testDatasetFileId` varchar(36) NULL, `evalConfig` json NULL, `rubric` json NULL, `references` text NULL, `faq` text NULL, `unlockRule` json NULL, `deadline` datetime NULL, `status` enum ('draft', 'published', 'closed') NOT NULL DEFAULT 'draft', `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_77a9be2e6f1f30d438df890a9c` (`courseId`), INDEX `IDX_573f11c83a6971a5dad1dbbb83` (`chapterId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `assignments` (`id` varchar(36) NOT NULL, `projectId` varchar(255) NOT NULL, `studentId` varchar(255) NOT NULL, `status` enum ('pending', 'claimed', 'submitted') NOT NULL DEFAULT 'pending', `claimedAt` datetime NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_5593fb5a2db438e6c5f305e979` (`projectId`), INDEX `IDX_7e7f1ff0b4a2d73aa910e3bd5c` (`studentId`), UNIQUE INDEX `IDX_7cba413592b529f7eea4ae45e2` (`projectId`, `studentId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `submissions` (`id` varchar(36) NOT NULL, `assignmentId` varchar(255) NOT NULL, `studentId` varchar(255) NOT NULL, `submittedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `skillZipRef` varchar(255) NOT NULL, `skillZipSha256` varchar(255) NOT NULL, `capsuleRef` varchar(255) NOT NULL, `capsuleSha256` varchar(255) NOT NULL, `auditEvents` json NULL, `fileHashes` json NULL, `status` enum ('submitted', 'verifying', 'verified', 'failed', 'graded') NOT NULL DEFAULT 'submitted', INDEX `IDX_c2611c601f49945ceff5c0909a` (`assignmentId`), INDEX `IDX_4fc99318a291abd7e2a50f5085` (`studentId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `evaluations` (`id` varchar(36) NOT NULL, `submissionId` varchar(255) NOT NULL, `baselineResult` json NULL, `treatmentResult` json NULL, `successRate` float NOT NULL DEFAULT '0', `tokenCost` int NOT NULL DEFAULT '0', `dossierSnapshot` json NULL, `integrityCheck` json NULL, `autoScoreSuggestion` float NULL, `teacherScore` float NULL, `teacherComment` text NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_fe1def9da41a1bd4e6d9089f65` (`submissionId`), UNIQUE INDEX `REL_fe1def9da41a1bd4e6d9089f65` (`submissionId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `stored_files` (`id` varchar(36) NOT NULL, `originalName` varchar(255) NOT NULL, `mimeType` varchar(255) NOT NULL, `size` int NOT NULL, `sha256` varchar(64) NOT NULL, `storagePath` varchar(255) NOT NULL, `uploaderId` varchar(255) NOT NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_c0756d517128f28d3d0fcb020b` (`uploaderId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `enrollments` (`id` varchar(36) NOT NULL, `courseId` varchar(255) NOT NULL, `studentId` varchar(255) NOT NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_60dd0ae4e21002e63a5fdefeec` (`courseId`), INDEX `IDX_bf3ba3dfa95e2df7388eb4589f` (`studentId`), UNIQUE INDEX `IDX_1566a16b6323a3e3ade31a02c9` (`courseId`, `studentId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("CREATE TABLE `chapter_progress` (`id` varchar(36) NOT NULL, `chapterId` varchar(255) NOT NULL, `studentId` varchar(255) NOT NULL, `status` enum ('not_started', 'in_progress', 'completed') NOT NULL DEFAULT 'not_started', `completedAt` datetime NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_3d27a9062f5619dc5ff27c0dcc` (`chapterId`), INDEX `IDX_962ccc3d26792741fede1548d9` (`studentId`), UNIQUE INDEX `IDX_d883347b144c5a2ead188d42c0` (`chapterId`, `studentId`), PRIMARY KEY (`id`)) ENGINE=InnoDB;");
    await queryRunner.query("ALTER TABLE `courses` ADD CONSTRAINT `FK_f921bd9bb6d061b90d386fa3721` FOREIGN KEY (`teacherId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `chapters` ADD CONSTRAINT `FK_becd2c25ed5b601e7a4466271c8` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `experiment_projects` ADD CONSTRAINT `FK_77a9be2e6f1f30d438df890a9c5` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `experiment_projects` ADD CONSTRAINT `FK_573f11c83a6971a5dad1dbbb83f` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `assignments` ADD CONSTRAINT `FK_5593fb5a2db438e6c5f305e9791` FOREIGN KEY (`projectId`) REFERENCES `experiment_projects`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `assignments` ADD CONSTRAINT `FK_7e7f1ff0b4a2d73aa910e3bd5cd` FOREIGN KEY (`studentId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `submissions` ADD CONSTRAINT `FK_c2611c601f49945ceff5c0909a2` FOREIGN KEY (`assignmentId`) REFERENCES `assignments`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `submissions` ADD CONSTRAINT `FK_4fc99318a291abd7e2a50f50851` FOREIGN KEY (`studentId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `evaluations` ADD CONSTRAINT `FK_fe1def9da41a1bd4e6d9089f65d` FOREIGN KEY (`submissionId`) REFERENCES `submissions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `enrollments` ADD CONSTRAINT `FK_60dd0ae4e21002e63a5fdefeec8` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `enrollments` ADD CONSTRAINT `FK_bf3ba3dfa95e2df7388eb4589fd` FOREIGN KEY (`studentId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `chapter_progress` ADD CONSTRAINT `FK_3d27a9062f5619dc5ff27c0dcc3` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
    await queryRunner.query("ALTER TABLE `chapter_progress` ADD CONSTRAINT `FK_962ccc3d26792741fede1548d94` FOREIGN KEY (`studentId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `chapter_progress`');
    await queryRunner.query('DROP TABLE `enrollments`');
    await queryRunner.query('DROP TABLE `evaluations`');
    await queryRunner.query('DROP TABLE `submissions`');
    await queryRunner.query('DROP TABLE `assignments`');
    await queryRunner.query('DROP TABLE `experiment_projects`');
    await queryRunner.query('DROP TABLE `chapters`');
    await queryRunner.query('DROP TABLE `courses`');
    await queryRunner.query('DROP TABLE `stored_files`');
    await queryRunner.query('DROP TABLE `users`');
  }
}
