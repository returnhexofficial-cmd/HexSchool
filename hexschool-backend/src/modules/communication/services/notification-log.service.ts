import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationStatus,
} from '@prisma/client';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SendDirectDto } from '../dto';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { NotificationService } from './notification.service';

/**
 * The delivery-log surface (roadmap M17 §4 "GET /notifications (log,
 * filters)") plus the direct-send and retry-failed actions. Reads the
 * append-only `notifications` table; every send still flows through
 * `NotificationService` so the "no direct gateway calls" rule holds.
 */
@Injectable()
export class NotificationLogService {
  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly notificationService: NotificationService,
  ) {}

  list(
    schoolId: string,
    query: PaginationQueryDto,
    filters: { channel?: NotificationChannel; status?: NotificationStatus },
  ): Promise<PaginatedResult<Notification>> {
    return this.notifications.paginate(query, {
      schoolId,
      searchColumns: ['destination', 'templateCode', 'bodyRendered'],
      sortableColumns: ['createdAt', 'sentAt', 'status'],
      where: {
        ...(filters.channel ? { channel: filters.channel } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
    });
  }

  async get(id: string, schoolId: string): Promise<Notification> {
    const row = await this.notifications.findById(id, schoolId);
    if (!row) throw new NotFoundException(`Notification ${id} not found`);
    return row;
  }

  /** Send one ad-hoc message to a single recipient (the /send endpoint). */
  async sendDirect(
    dto: SendDirectDto,
    actor: AccessTokenPayload,
  ): Promise<Notification | null> {
    return this.notificationService.send({
      schoolId: actor.schoolId,
      code: dto.code ?? 'NOTICE',
      channel: dto.channel,
      recipient: {
        type: dto.recipientType,
        id: dto.recipientId ?? null,
        destination: dto.destination,
      },
      rawBody: dto.message,
      rawSubject: dto.subject,
      vars: dto.vars,
      emergency: dto.emergency ?? false,
      createdBy: actor.sub,
    });
  }

  /** Re-queue FAILED messages for another attempt (roadmap §6). */
  async retryFailed(schoolId: string, ids: string[]): Promise<number> {
    const rows = await this.notifications.findFailed(schoolId, ids);
    for (const row of rows) await this.notificationService.requeue(row);
    return rows.length;
  }
}
