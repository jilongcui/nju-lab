import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  /** 全部学生（脱敏），供教师选课使用 */
  async listStudents() {
    const students = await this.userRepo.find({
      where: { role: UserRole.STUDENT },
      order: { createdAt: 'ASC' },
    });
    return students.map((s) => this.sanitize(s));
  }

  /** 全部教师与管理员（脱敏）：转让课程的可选归属人（管理员账号也可持有课程） */
  async listTeachers() {
    const teachers = await this.userRepo.find({
      where: { role: In([UserRole.TEACHER, UserRole.ADMIN]) },
      order: { createdAt: 'ASC' },
    });
    return teachers.map((t) => this.sanitize(t));
  }

  sanitize(user: User) {
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  }
}
