import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * TypeORM CLI 用的 DataSource（migration:generate/run）。
 * 运行配置与 app.module.ts 保持一致；entities/migrations 用编译后路径或 ts 源路径均可，
 * 这里用 ts 源（配 ts-node -T 运行 CLI）。
 */
export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USERNAME || 'nju_lab',
  password: process.env.DB_PASSWORD || 'nju_lab_dev',
  database: process.env.DB_DATABASE || 'nju_lab',
  charset: 'utf8mb4',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
});
