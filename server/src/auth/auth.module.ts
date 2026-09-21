import { Module } from '@nestjs/common';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import {
  AuthController,
  CasAuthController,
  MePasswordController,
  MeTokensController,
} from './auth.controller';
import { AuthService } from './auth.service';
import { CasClient } from './cas.client';
import { JwtStrategy } from './jwt.strategy';
import { AUTH_PROVIDER } from './providers/auth-provider.interface';
import { LocalAuthProvider } from './providers/local-auth.provider';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'nju-lab-dev-secret',
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN ||
          '7d') as JwtSignOptions['expiresIn'],
      },
    }),
  ],
  controllers: [AuthController, MeTokensController, MePasswordController, CasAuthController],
  providers: [
    AuthService,
    CasClient,
    JwtStrategy,
    // 认证提供者绑定：当前为本地账号；接学校统一认证时新增 Provider 并替换 useClass 即可
    { provide: AUTH_PROVIDER, useClass: LocalAuthProvider },
  ],
})
export class AuthModule {}
