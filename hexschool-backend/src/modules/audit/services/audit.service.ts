import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditLogsRepository } from '../repositories/audit-logs.repository';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';

/** API shape: BIGSERIAL id serialized as string (BigInt isn't JSON-safe). */
export interface AuditLogView extends Omit<AuditLog, 'id'> {
  id: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly auditLogs: AuditLogsRepository) {}

  /** Called by the AuditInterceptor — append-only, never throws upward. */
  async record(entry: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
    await this.auditLogs.create(entry);
  }

  async list(
    query: AuditLogQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<AuditLogView>> {
    const { data, meta } = await this.auditLogs.paginate(query, schoolId);
    return { data: data.map((log) => this.toView(log)), meta };
  }

  async getById(rawId: string, schoolId: string): Promise<AuditLogView> {
    let id: bigint;
    try {
      id = BigInt(rawId);
    } catch {
      throw new NotFoundException(`Audit log ${rawId} not found`);
    }
    const log = await this.auditLogs.findById(id, schoolId);
    if (!log) throw new NotFoundException(`Audit log ${rawId} not found`);
    return this.toView(log);
  }

  private toView(log: AuditLog): AuditLogView {
    return { ...log, id: log.id.toString() };
  }
}
