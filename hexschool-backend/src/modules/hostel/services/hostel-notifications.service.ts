import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
} from '../../../common/constants';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { isoDate } from '../../academic/calendar/date.util';
import { NotificationService } from '../../communication/services/notification.service';
import { mealOffDays } from '../calc/mess.engine';
import type { AllocationWithRelations } from '../repositories/hostel-allocations.repository';
import type { MealOffWithRelations } from '../repositories/mess.repository';
import type { HostelConfig } from './hostel-settings.service';

/**
 * Module 26's outbound messages, all through `NotificationService.send()`
 * — the M17 rule that there are no direct gateway calls anywhere.
 *
 * Every send is wrapped: a school with an empty SMS balance must not make
 * *giving a child a bed* fail (the M07 "delivery must never block the
 * mutation" rule, and the M25 precedent verbatim).
 *
 * Both messages go to the **guardian**, because both are things a family
 * acts on: which building to drop their child at in September, and
 * whether the kitchen is expecting them next week. There is no
 * office-facing alert in this module — the occupancy grid is where a
 * warden looks, and it is always in front of them.
 */
@Injectable()
export class HostelNotificationsService {
  private readonly logger = new Logger(HostelNotificationsService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  /** Optional (§5): tell the guardian the building, the room and the bed. */
  async announceAllocation(
    allocation: AllocationWithRelations,
    cfg: HostelConfig,
  ): Promise<boolean> {
    if (!cfg.notifyGuardianOnAllocation) return false;

    const guardian = await this.primaryGuardian(
      allocation.enrollment.student.id,
    );
    if (!guardian) return false;

    const warden = allocation.hostel.wardenStaff;
    const student = allocation.enrollment.student;

    return this.deliver(allocation.schoolId, guardian, 'HOSTEL_ALLOCATED', {
      student_name: `${student.firstName} ${student.lastName}`.trim(),
      hostel: allocation.hostel.name,
      room: allocation.bed.room.roomNo,
      bed: allocation.bed.bedNo,
      start_date: isoDate(allocation.startDate),
      warden: warden
        ? `${warden.firstName} ${warden.lastName}`.trim()
        : 'the hostel office',
      school: await this.schoolName(allocation.schoolId),
    });
  }

  /** The decision on a meal-off — approved or refused, either way. */
  async announceMealOffDecision(
    mealOff: MealOffWithRelations,
    cfg: HostelConfig,
  ): Promise<boolean> {
    void cfg;
    const student = mealOff.allocation.enrollment.student;
    const guardian = await this.primaryGuardian(student.id);
    if (!guardian) return false;

    const from = isoDate(mealOff.fromDate);
    const to = isoDate(mealOff.toDate);

    return this.deliver(mealOff.schoolId, guardian, 'MEAL_OFF_DECISION', {
      student_name: `${student.firstName} ${student.lastName}`.trim(),
      from_date: from,
      to_date: to,
      days: String(mealOffDays(from, to)),
      decision: mealOff.status === 'APPROVED' ? 'approved' : 'not approved',
      note: mealOff.decisionNote ?? '',
      school: await this.schoolName(mealOff.schoolId),
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private async primaryGuardian(studentId: string) {
    const row = await this.prisma.studentGuardian.findFirst({
      where: { studentId, isPrimary: true },
      select: {
        guardian: { select: { name: true, phone: true, userId: true } },
      },
    });
    return row?.guardian ?? null;
  }

  /**
   * IN_APP when the guardian has an account, SMS otherwise — the reverse
   * of a channel *setting*, and deliberate: the free channel is preferred
   * whenever it will actually be read, and a guardian with no portal
   * login would simply never see it (the M22/M23/M24/M25 "the cheapest
   * message is the one not sent" reasoning, with the fallback that keeps
   * it from being the one never delivered).
   */
  private async deliver(
    schoolId: string,
    guardian: { name: string; phone: string; userId: string | null },
    code: string,
    vars: Record<string, string>,
  ): Promise<boolean> {
    const channel = guardian.userId
      ? NotificationChannel.IN_APP
      : NotificationChannel.SMS;

    if (channel === NotificationChannel.SMS && !guardian.phone) return false;

    return this.safeSend({
      schoolId,
      code,
      channel,
      recipient: {
        type: NotificationRecipientType.GUARDIAN,
        id: guardian.userId,
        destination:
          channel === NotificationChannel.SMS ? guardian.phone : null,
      },
      vars,
      dedupe: true,
    });
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
        `Hostel notification ${input.code} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
