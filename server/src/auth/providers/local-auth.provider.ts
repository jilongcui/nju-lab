import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../../users/user.entity';
import {
  AuthProvider,
  RegisterInput,
} from './auth-provider.interface';

/** 本地账号认证：用户名 + bcryptjs 哈希密码 */
@Injectable()
export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local';

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async validateCredentials(
    username: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user) {
      return null;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  async register(input: RegisterInput): Promise<User> {
    const exists = await this.userRepo.findOne({
      where: { username: input.username },
    });
    if (exists) {
      throw new ConflictException('用户名已存在');
    }
    const user = this.userRepo.create({
      username: input.username,
      nickname: input.nickname,
      role: input.role,
      passwordHash: await bcrypt.hash(input.password, 10),
    });
    return this.userRepo.save(user);
  }
}
