import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
} from '../../../common/constants';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { NotificationService } from '../../communication/services/notification.service';
import { formatClock } from '../calc/route-plan.util';
import { timeColumnMinutes } from '../../../common/utils/clock.util';
import type { ExpiryItem } from '../calc/expiry.engine';
import { expirySummary } from '../calc/expiry.engine';
import type { AssignmentWithRelations } from '../repositories/transport-assignments.repository';
import type { TransportConfig } from './transport-settings.service';

/**
 * Module 25's outbound messages, all through `NotificationService.send()`
 * — the M17 rule that there are no direct gateway calls anywhere.
 *
 * Every send is wrapped: a school with an empty SMS balance must not make
 * the nightly expiry job fail halfway down its list, and must certainly
 * not make *assigning a child to a bus* fail (the M07 "delivery must
 * never block the mutation" rule).
 *
 * **Who gets what is the module's one asymmetry.** A document-expiry
 * alert is an office problem — it goes to the admin users on the bell,
 * never to a parent, because a family cannot renew a tax token. A route
 * assignment goes to the **guardian's** phone, because the person who
 * needs to know which bus to put a child on at 06:50 is the parent.
 */
@Injectable()
export class TransportNotificationsService {
  private readonly logger = new Logger(TransportNotificationsService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Roadmap §4's "expiry alert job … → admin notification". One message
   * per vehicle or driver, naming every paper that is wrong, because
   * four separate alerts about one bus is how an office learns to ignore
   * them.
   */
  async alertExpiry(
    schoolId: string,
    cfg: TransportConfig,
    subject: string,
    kind: 'VEHICLE' | 'DRIVER',
    items: ExpiryItem[],
  ): Promise<number> {
    if (items.length === 0) return 0;

    const admins = await this.adminUserIds(schoolId);
    if (admins.length === 0) return 0;

    const school = await this.schoolName(schoolId);
    const worst = items[0];
    const vars = {
      subject,
      kind: kind === 'VEHICLE' ? 'Vehicle' : 'Driver',
      document: worst.label,
      expiry: worst.expiry ?? 'not recorded',
      days: worst.daysLeft === null ? 'unknown' : String(worst.daysLeft),
      detail: expirySummary(subject, items),
      school,
    };

    let sent = 0;
    for (const userId of admins) {
      const ok = await this.safeSend({
        schoolId,
        code: 'TRANSPORT_DOCUMENT_EXPIRY',
        channel: cfg.expiryAlertChannel,
        recipient: {
          type: NotificationRecipientType.USER,
          id: userId,
          destination:
            cfg.expiryAlertChannel === NotificationChannel.SMS
              ? await this.userPhone(userId)
              : null,
        },
        vars,
        dedupe: true,
      });
      if (ok) sent++;
    }
    return sent;
  }

  /** Optional: tell the guardian which bus and what time (§5). */
  async announceAssignment(
    assignment: AssignmentWithRelations,
    cfg: TransportConfig,
  ): Promise<boolean> {
    if (!cfg.notifyGuardianOnAssign) return false;

    const guardian = await this.prisma.studentGuardian.findFirst({
      where: {
        studentId: assignment.enrollment.student.id,
        isPrimary: true,
      },
      select: {
        guardian: { select: { name: true, phone: true, userId: true } },
      },
    });
    if (!guardian) return false;

    const student = assignment.enrollment.student;
    const vars = {
      student_name: `${student.firstName} ${student.lastName}`.trim(),
      route: assignment.route.name,
      stop: assignment.stop.name,
      pickup: clock(assignment.stop.pickupTime) ?? 'to be confirmed',
      drop: clock(assignment.stop.dropTime) ?? 'to be confirmed',
      fee: Number(assignment.stop.monthlyFee).toFixed(2),
      school: await this.schoolName(assignment.schoolId),
    };

    // SMS when the school pays for it, the free bell otherwise — the
    // M22/M23 channel default.
    const channel =
      cfg.expiryAlertChannel === NotificationChannel.SMS &&
      guardian.guardian.phone
        ? NotificationChannel.SMS
        : NotificationChannel.IN_APP;

    if (channel === NotificationChannel.IN_APP && !guardian.guardian.userId) {
      return false;
    }

    return this.safeSend({
      schoolId: assignment.schoolId,
      code: 'TRANSPORT_ASSIGNED',
      channel,
      recipient: {
        type: NotificationRecipientType.GUARDIAN,
        id: guardian.guardian.userId,
        destination:
          channel === NotificationChannel.SMS ? guardian.guardian.phone : null,
      },
      vars,
      dedupe: true,
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private async adminUserIds(schoolId: string): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          { userType: 'SUPER_ADMIN' },
          {
            userRoles: {
              some: {
                role: {
                  slug: { in: ['admin', 'principal', 'office-staff'] },
                },
              },
            },
          },
        ],
      },
      select: { id: true },
      take: 50,
    });
    return rows.map((row) => row.id);
  }

  private async userPhone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { phone: true },
    });
    return user?.phone ?? null;
  }

  private async schoolName(schoolId: string): Promise<string> {
    const school = await this.prisma.school.findFirst({
      where: { id: schoolId },
      select: { name: true },
    });
    return school?.name ?? 'School';
  }

  private async safeSend(
    input: Parameters<NotificationService['send']>[0],
  ): Promise<boolean> {
    try {
      await this.notifications.send(input);
      return true;
    } catch (error) {
      this.logger.warn(
        `Transport notification ${input.code} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }
}

function clock(value: Date | null): string | null {
  return value === null ? null : formatClock(timeColumnMinutes(value));
}
