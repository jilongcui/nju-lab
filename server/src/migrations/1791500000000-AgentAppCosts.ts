import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 应用模型用量落库（四期「成本看板」，2026-11-13）。
 *
 * 之前 `AgentAppsService` 把用量记在进程内存（`usage = new Map()`）—— 后端一重启就归零，
 * 教师没法回答"这个应用/这门课这学期花了多少 token"。现在改成 `agent_apps` 上两列累加：
 * `llmChat` 每次成功调用 +1 次 / +total_tokens，`usageOf` 与课程看板都读这两列。
 *
 * 只加列、不改既有数据（历史用量本来就没存过，无法回填）。
 */
export class AgentAppCosts1791500000000 implements MigrationInterface {
    name = 'AgentAppCosts1791500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`agent_apps\` ADD \`llmCalls\` int NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`agent_apps\` ADD \`llmTokens\` int NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`agent_apps\` DROP COLUMN \`llmTokens\``);
        await queryRunner.query(`ALTER TABLE \`agent_apps\` DROP COLUMN \`llmCalls\``);
    }

}
