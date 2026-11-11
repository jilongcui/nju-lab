import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 第 20 章「可分享的智能体应用」的平台侧三张表（2026-11-11）。
 *
 * 设计要点（见 `docs/DESIGN-2026-11-agent-app-platform.md`）：
 * - 应用本体与**版本**分开：上传只增版本，发布/下架只改状态 —— 教师可以切回旧版本，不丢产物；
 * - `shareKey` 是**能力凭证**（发布时生成、下架即失效），分享链接走它，不必把 appId 暴露成匿名入口；
 * - 对话记录单独一张表：教师管理页要能看到学生应用里到底聊了什么（隐私边界写在设计文档里）。
 */
export class AgentApps1791300000000 implements MigrationInterface {
    name = 'AgentApps1791300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`agent_apps\` (\`id\` varchar(36) NOT NULL, \`studentId\` varchar(36) NOT NULL, \`courseId\` varchar(36) NULL, \`projectId\` varchar(36) NULL, \`title\` varchar(120) NOT NULL, \`scenario\` text NULL, \`entry\` varchar(200) NOT NULL DEFAULT 'harness/api.py', \`theme\` json NULL, \`attachments\` json NULL, \`visibility\` enum ('owner', 'teacher', 'course') NOT NULL DEFAULT 'teacher', \`status\` enum ('draft', 'published', 'archived') NOT NULL DEFAULT 'draft', \`latestVersionId\` varchar(36) NULL, \`shareKey\` varchar(40) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_agent_apps_student\` (\`studentId\`), INDEX \`IDX_agent_apps_course\` (\`courseId\`), INDEX \`IDX_agent_apps_share\` (\`shareKey\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`agent_app_versions\` (\`id\` varchar(36) NOT NULL, \`appId\` varchar(36) NOT NULL, \`fileId\` varchar(36) NOT NULL, \`bundlePath\` text NOT NULL, \`sha256\` varchar(64) NOT NULL DEFAULT '', \`size\` int NOT NULL DEFAULT '0', \`note\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_agent_app_versions_app\` (\`appId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`agent_app_messages\` (\`id\` varchar(36) NOT NULL, \`appId\` varchar(36) NOT NULL, \`sessionId\` varchar(40) NOT NULL, \`role\` varchar(16) NOT NULL, \`content\` text NOT NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_agent_app_messages_app\` (\`appId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_agent_app_messages_app\` ON \`agent_app_messages\``);
        await queryRunner.query(`DROP TABLE \`agent_app_messages\``);
        await queryRunner.query(`DROP INDEX \`IDX_agent_app_versions_app\` ON \`agent_app_versions\``);
        await queryRunner.query(`DROP TABLE \`agent_app_versions\``);
        await queryRunner.query(`DROP INDEX \`IDX_agent_apps_share\` ON \`agent_apps\``);
        await queryRunner.query(`DROP INDEX \`IDX_agent_apps_course\` ON \`agent_apps\``);
        await queryRunner.query(`DROP INDEX \`IDX_agent_apps_student\` ON \`agent_apps\``);
        await queryRunner.query(`DROP TABLE \`agent_apps\``);
    }

}
