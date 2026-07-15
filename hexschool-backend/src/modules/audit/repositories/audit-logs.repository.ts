import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';

/**
 * Append-only store: create + read, nothing else (audit logs are
 * immutable — no update/delete API exists, roadmap M03 §6). Standalone
 * rather than BaseRepository-based: the BIGSERIAL id doesn't fit the
 * string-id contract and none of the soft-delete machinery applies.
 */
@Injectable()
export class AuditLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
    await this.prisma.auditLog.create({ data });
  }

  async findById(id: bigint, schoolId: string): Promise<AuditLog | null> {
    return this.prisma.auditLog.findFirst({ where: { id, schoolId } });
  }

  async paginate(
    query: AuditLogQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<AuditLog>> {
    const where: Prisma.AuditLogWhereInput = {
      schoolId,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: items,
      meta: buildPaginationMeta(query.page, query.limit, total),
    };
  }
}
