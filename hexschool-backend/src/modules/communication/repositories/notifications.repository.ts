import { Injectable } from '@nestjs/common';
import {
  Notification,
  NotificationRecipientType,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The delivery log + in-app inbox. Append-only (no soft delete, global
 * rule §11), so BaseRepository is created with `softDeletable: false`.
 */
@Injectable()
export class NotificationsRepository extends BaseRepository<
  Notification,
  Prisma.NotificationWhereInput,
  Prisma.NotificationUncheckedCreateInput,
  Prisma.NotificationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.notification, 'Notification', {
      softDeletable: false,
    });
  }

  async createRow(
    data: Prisma.NotificationUncheckedCreateInput,
  ): Promise<Notification> {
    return this.prisma.notification.create({ data });
  }

  async markStatus(
    id: string,
    data: Prisma.NotificationUncheckedUpdateInput,
  ): Promise<Notification> {
    return this.prisma.notification.update({ where: { id }, data });
  }

  /** DLR webhook correlation by the gateway's own message id. */
  async findByProviderMsgId(
    schoolId: string,
    providerMsgId: string,
  ): Promise<Notification | null> {
    return this.prisma.notification.findFirst({
      where: { schoolId, providerMsgId },
    });
  }

  /** In-app inbox for a recipient, newest first. */
  async inbox(
    schoolId: string,
    recipientType: NotificationRecipientType,
    recipientId: string,
    onlyUnread: boolean,
    take: number,
  ): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        schoolId,
        channel: 'IN_APP',
        recipientType,
        recipientId,
        ...(onlyUnread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async countUnread(
    schoolId: string,
    recipientType: NotificationRecipientType,
    recipientId: string,
  ): Promise<number> {
    return this.prisma.notification.count({
      where: {
        schoolId,
        channel: 'IN_APP',
        recipientType,
        recipientId,
        readAt: null,
      },
    });
  }

  async markRead(
    schoolId: string,
    recipientType: NotificationRecipientType,
    recipientId: string,
    ids?: string[],
  ): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        schoolId,
        channel: 'IN_APP',
        recipientType,
        recipientId,
        readAt: null,
        ...(ids && ids.length ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  /**
   * In-app inbox keyed on the logged-in user id (any recipient_type) — the
   * admin header bell. A guardian/student portal maps its profile to a
   * user id upstream (M18).
   */
  async inboxForUser(
    schoolId: string,
    userId: string,
    onlyUnread: boolean,
    take: number,
  ): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        schoolId,
        channel: 'IN_APP',
        recipientId: userId,
        ...(onlyUnread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async countUnreadForUser(schoolId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { schoolId, channel: 'IN_APP', recipientId: userId, readAt: null },
    });
  }

  async markReadForUser(
    schoolId: string,
    userId: string,
    ids?: string[],
  ): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        schoolId,
        channel: 'IN_APP',
        recipientId: userId,
        readAt: null,
        ...(ids && ids.length ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  /** Count messages by status in a batch (bulk composer progress). */
  async countByBatch(
    schoolId: string,
    batchKey: string,
  ): Promise<Record<string, number>> {
    const rows = await this.prisma.notification.groupBy({
      by: ['status'],
      where: { schoolId, batchKey },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const row of rows) out[row.status] = row._count._all;
    return out;
  }

  /** Retryable failed messages (for the manual retry-failed action). */
  async findFailed(schoolId: string, ids: string[]): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { schoolId, id: { in: ids }, status: NotificationStatus.FAILED },
    });
  }
}
