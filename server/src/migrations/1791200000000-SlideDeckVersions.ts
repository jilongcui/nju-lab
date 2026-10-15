import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 幻灯片历史版本表 `slide_deck_versions`（2026-10-13）。
 *
 * 让教师在界面上能看到并回滚历史版本 —— 起因是实测中"收紧生成约束后内容变少，
 * 教师更想要旧版"只能靠运维从备份文件人工恢复。
 *
 * 外键指向 `slide_decks(id)` 并 **ON DELETE CASCADE**：deck 删除时历史一起清，不留孤儿。
 * （上一张表的教训见 1790900000000：建表只建索引不建外键 → 删主表后残留孤儿行。）
 *
 * ⚠️ **必须显式 COLLATE=utf8mb4_unicode_ci**：`slide_decks` 是 unicode_ci，而 MySQL 8 的库默认
 * 是 0900_ai_ci，两边不一致时建外键会报 "Referencing column ... are incompatible"。
 */
export class SlideDeckVersions1791200000000 implements MigrationInterface {
  name = 'SlideDeckVersions1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`slide_deck_versions\` (
        \`id\` varchar(36) NOT NULL,
        \`deckId\` varchar(36) NOT NULL,
        \`chapterId\` varchar(36) NOT NULL,
        \`title\` varchar(255) NOT NULL DEFAULT '',
        \`slides\` json NOT NULL,
        \`markdown\` longtext NULL,
        \`templateId\` varchar(36) NULL,
        \`config\` json NULL,
        \`tokensUsed\` int NULL,
        \`model\` varchar(64) NULL,
        \`generatedBy\` varchar(16) NULL,
        \`promptVersion\` varchar(16) NULL,
        \`label\` varchar(120) NOT NULL DEFAULT '',
        \`reason\` varchar(32) NOT NULL DEFAULT 'regenerate',
        \`createdBy\` varchar(36) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_sdv_deck_created\` (\`deckId\`, \`createdAt\`),
        INDEX \`idx_sdv_chapter\` (\`chapterId\`),
        CONSTRAINT \`fk_sdv_deck\` FOREIGN KEY (\`deckId\`) REFERENCES \`slide_decks\`(\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS `slide_deck_versions`");
  }
}
