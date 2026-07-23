import { Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationLanguage,
  NotificationTemplate,
  Prisma,
} from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Notification-template master (soft-deleted, identity-unique per code). */
@Injectable()
export class NotificationTemplatesRepository extends BaseRepository<
  NotificationTemplate,
  Prisma.NotificationTemplateWhereInput,
  Prisma.NotificationTemplateUncheckedCreateInput,
  Prisma.NotificationTemplateUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(
      prisma,
      (client) => client.notificationTemplate,
      'NotificationTemplate',
    );
  }

  async findAllForSchool(schoolId: string): Promise<NotificationTemplate[]> {
    return this.prisma.notificationTemplate.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: [{ code: 'asc' }, { channel: 'asc' }, { language: 'asc' }],
    });
  }

  /** The active body to render for a (code, channel, language). */
  async findActive(
    schoolId: string,
    code: string,
    channel: NotificationChannel,
    language: NotificationLanguage,
  ): Promise<NotificationTemplate | null> {
    return this.prisma.notificationTemplate.findFirst({
      where: {
        schoolId,
        code,
        channel,
        language,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  /** The identity clash for a (code, channel, language) among live rows. */
  async findIdentity(
    schoolId: string,
    code: string,
    channel: NotificationChannel,
    language: NotificationLanguage,
    excludeId?: string,
  ): Promise<NotificationTemplate | null> {
    return this.prisma.notificationTemplate.findFirst({
      where: {
        schoolId,
        code,
        channel,
        language,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }
}
