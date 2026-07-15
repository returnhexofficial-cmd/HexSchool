import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { QueuesModule } from '../../queues/queues.module';
import { AuthController } from './controllers/auth.controller';
import { AuthListener } from './events/auth.listener';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
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
 * Module 02 — Authentication. Registers the global JwtAuthGuard: every
 * route in the app now requires a Bearer token unless marked @Public().
 * (Secrets are passed per-sign in TokenService, so JwtModule needs no
 * global config.)
 */
@Module({
  imports: [JwtModule.register({}), QueuesModule],
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [UsersRepository, PasswordService, TokenService],
})
export class AuthModule {}
