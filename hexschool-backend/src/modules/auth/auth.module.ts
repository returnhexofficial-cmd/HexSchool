import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { QueuesModule } from '../../queues/queues.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthController } from './controllers/auth.controller';
import { AuthListener } from './events/auth.listener';
import { AuthCleanupJob } from './jobs/auth-cleanup.job';
import { LoginActivitiesRepository } from './repositories/login-activities.repository';
import { OtpCodesRepository } from './repositories/otp-codes.repository';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { UsersRepository } from './repositories/users.repository';
import { AuthService } from './services/auth.service';
import { OtpService } from './services/otp.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';

/**
 * Module 02 — Authentication. The global JwtAuthGuard registration moved
 * to AppModule in Module 03: APP_GUARD execution follows provider
 * registration order and root-module providers register BEFORE imported
 * modules' — the only way to guarantee JwtAuthGuard → PermissionsGuard
 * ordering is to declare both in AppModule's providers array. (Secrets
 * are passed per-sign in TokenService, so JwtModule needs no global
 * config.)
 */
@Module({
  // RbacModule supplies PermissionsService so /auth/me reports real
  // permission codes (M03). Rbac deliberately never imports back.
  imports: [JwtModule.register({}), QueuesModule, RbacModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    OtpService,
    UsersRepository,
    RefreshTokensRepository,
    OtpCodesRepository,
    LoginActivitiesRepository,
    AuthListener,
    AuthCleanupJob,
  ],
  exports: [UsersRepository, PasswordService, TokenService],
})
export class AuthModule {}
