import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'admin',
  TEACHER = 'teacher',
  STUDENT = 'student',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  passwordHash: string;

  @Column()
  nickname: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  /** token 吊销版本号：+1 即该用户全部已签发 token 失效（JWT payload.ver 比对） */
  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  @CreateDateColumn()
  createdAt: Date;
}
