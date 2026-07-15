import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { AuditLogsRepository } from './repositories/audit-logs.repository';
import { AuditContextService } from './services/audit-context.service';
import { AuditService } from './services/audit.service';

/**
 * Module 03 — audit trail. Global so any module's services can inject
 * AuditContextService to attach real old/new diffs to the in-flight
 * request without an explicit import (the interceptor itself applies
 * app-wide via APP_INTERCEPTOR regardless).
 */
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [
    AuditContextService,
    AuditService,
    AuditLogsRepository,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditContextService],
})
export class AuditModule {}
