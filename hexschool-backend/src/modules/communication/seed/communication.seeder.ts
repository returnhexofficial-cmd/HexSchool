import { PrismaClient } from '@prisma/client';
import { NOTIFICATION_CODES } from '../communication.constants';

/**
 * Idempotent seed of the default EN notification templates per school
 * (Module 17). A school can re-word any of these in the template manager;
 * the seeder only *inserts* missing (code, channel, EN) rows, never
 * overwrites an admin's edits — the permission/settings-registry pattern.
 *
 * BN variants are intentionally NOT seeded: the sender falls back to EN,
 * and a school authors Bangla bodies where it wants them.
 */
export async function seedNotificationTemplates(
  prisma: PrismaClient,
  schoolId: string,
): Promise<number> {
  let created = 0;
  for (const def of NOTIFICATION_CODES) {
    for (const channel of def.channels) {
      const existing = await prisma.notificationTemplate.findFirst({
        where: {
          schoolId,
          code: def.code,
          channel,
          language: 'EN',
          deletedAt: null,
        },
      });
      if (existing) continue;
      await prisma.notificationTemplate.create({
        data: {
          schoolId,
          code: def.code,
          channel,
          language: 'EN',
          subject: channel === 'EMAIL' ? (def.defaultSubject ?? null) : null,
          body: def.defaultBody,
          isActive: true,
        },
      });
      created++;
    }
  }
  return created;
}
