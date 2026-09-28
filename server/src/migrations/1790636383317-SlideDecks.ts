import { MigrationInterface, QueryRunner } from "typeorm";

export class SlideDecks1790636383317 implements MigrationInterface {
    name = 'SlideDecks1790636383317'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`slide_templates\` (\`id\` varchar(36) NOT NULL, \`courseId\` varchar(36) NULL, \`name\` varchar(64) NOT NULL, \`description\` varchar(255) NULL, \`baseTheme\` varchar(32) NOT NULL DEFAULT 'simple', \`design\` json NULL, \`config\` json NULL, \`isBuiltin\` tinyint NOT NULL DEFAULT 0, \`createdBy\` varchar(36) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_5d10b49e86ea61ae4e8eec6f41\` (\`courseId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`slide_decks\` (\`id\` varchar(36) NOT NULL, \`courseId\` varchar(36) NOT NULL, \`chapterId\` varchar(36) NOT NULL, \`title\` varchar(255) NOT NULL DEFAULT '', \`slides\` json NULL, \`markdown\` longtext NULL, \`templateId\` varchar(36) NULL, \`config\` json NULL, \`status\` enum ('empty', 'generating', 'ready', 'failed') NOT NULL DEFAULT 'empty', \`generatedBy\` varchar(16) NULL, \`model\` varchar(64) NULL, \`tokensUsed\` int NULL, \`basedOnChapterHash\` varchar(64) NULL, \`sourceHash\` varchar(64) NULL, \`error\` text NULL, \`warnings\` text NULL, \`createdBy\` varchar(36) NOT NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_97e64db8aeeec091c53e63764a\` (\`courseId\`), UNIQUE INDEX \`IDX_e7ceb02f088fb787682fee32aa\` (\`chapterId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_e7ceb02f088fb787682fee32aa\` ON \`slide_decks\``);
        await queryRunner.query(`DROP INDEX \`IDX_97e64db8aeeec091c53e63764a\` ON \`slide_decks\``);
        await queryRunner.query(`DROP TABLE \`slide_decks\``);
        await queryRunner.query(`DROP INDEX \`IDX_5d10b49e86ea61ae4e8eec6f41\` ON \`slide_templates\``);
        await queryRunner.query(`DROP TABLE \`slide_templates\``);
    }

}
