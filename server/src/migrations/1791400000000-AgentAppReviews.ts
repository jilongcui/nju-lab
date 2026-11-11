import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 学生应用的**教师评分**（第 20 章 · 平台二期，2026-11-11）。
 *
 * 为什么单独一张表而不是塞进 `submissions`：应用的交付形态是"一个能跑的小应用"，
 * 判分口径是三维（托管可用 / 交付形态 / 演示答辩），与"跑复验拿 output.json"的作业流程不同。
 * 二期先把评分放在这里；三期若要进成绩单，再按 `courseId/studentId` 汇总到 `submissions`。
 */
export class AgentAppReviews1791400000000 implements MigrationInterface {
    name = 'AgentAppReviews1791400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`agent_app_reviews\` (\`id\` varchar(36) NOT NULL, \`appId\` varchar(36) NOT NULL, \`teacherId\` varchar(36) NOT NULL, \`total\` int NOT NULL DEFAULT '0', \`dimensions\` json NULL, \`comment\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_agent_app_reviews_app\` (\`appId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_agent_app_reviews_app\` ON \`agent_app_reviews\``);
        await queryRunner.query(`DROP TABLE \`agent_app_reviews\``);
    }

}
