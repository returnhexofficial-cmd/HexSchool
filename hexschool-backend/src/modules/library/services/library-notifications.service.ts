import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
} from '../../../common/constants';
import { NotificationService } from '../../communication/services/notification.service';
import { PrismaService } from '../../../database/prisma/prisma.service';
import type { IssueWithRelations } from '../repositories/circulation.repository';
import type { ReservationWithRelations } from '../repositories/circulation.repository';
import { LibraryDirectoryRepository } from '../repositories/library-directory.repository';
import type { LibraryConfig } from './library-settings.service';

/**
 * Module 23's outbound messages, all through `NotificationService.send()`
 * — the M17 rule that there are no direct gateway calls anywhere.
 *
 * Every send is wrapped: a school with an empty SMS balance must not
 * make the overdue job fail halfway down its list, and must certainly
 * not make *returning a book* fail. That is the M07 credential rule and
 * M20's "an auto-post failure is logged, never rethrown".
 *
 * Where a message goes depends on who the member is, and the asymmetry
 * is deliberate: a **student's** overdue notice goes to the guardian's
 * phone (the number on file in a BD school is the parent's, and the
 * parent is who will actually make the book come back), while a teacher
 * or staff member gets their own. The in-app bell always goes to the
 * person's own account, because that is what M17's `/notifications/me`
 * reads.
 */
@Injectable()
export class LibraryNotificationsService {
  private readonly logger = new Logger(LibraryNotificationsService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly directory: LibraryDirectoryRepository,
    private readonly prisma: PrismaService,
  ) {}

  async chaseOverdue(
    issue: IssueWithRelations,
    cfg: LibraryConfig,
    now = new Date(),
  ): Promise<boolean> {
    const person = await this.directory.lookup(
      issue.schoolId,
      issue.member.personType,
      issue.member.personId,
    );
    if (!person) return false;

    const days = Math.max(
      0,
      Math.floor((now.getTime() - issue.dueAt.getTime()) / 86_400_000),
    );
    const outstanding = Math.max(
      0,
      Number(issue.fineAmount) -
        Number(issue.fineCollected) -
        Number(issue.fineWaived),
    );

    return this.dispatch(issue.schoolId, cfg, person, 'LIBRARY_OVERDUE', {
      name: person.name,
      title: issue.copy.book.title,
      due: this.formatDate(issue.dueAt),
      days: String(days),
      fine: outstanding.toFixed(2),
    });
  }

  async announceReady(
    reservation: ReservationWithRelations,
    cfg: LibraryConfig,
  ): Promise<boolean> {
    const person = await this.directory.lookup(
      reservation.schoolId,
      reservation.member.personType,
      reservation.member.personId,
    );
    if (!person) return false;

    return this.dispatch(
      reservation.schoolId,
      cfg,
      person,
      'LIBRARY_RESERVATION_READY',
      {
        name: person.name,
        title: reservation.book.title,
        until: reservation.expiresAt
          ? this.formatDate(reservation.expiresAt)
          : 'further notice',
      },
    );
  }

  private async dispatch(
    schoolId: string,
    cfg: LibraryConfig,
    person: {
      name: string;
      userId: string | null;
      phone: string | null;
      personType: string;
    },
    code: string,
    vars: Record<string, unknown>,
  ): Promise<boolean> {
    const school = await this.prisma.school.findFirst({
      where: { id: schoolId },
      select: { name: true },
    });
    const payload = { ...vars, school: school?.name ?? 'School' };

    if (cfg.overdueNoticeChannel === NotificationChannel.SMS) {
      if (!person.phone) return false;
      return this.safeSend({
        schoolId,
        code,
        channel: NotificationChannel.SMS,
        recipient: {
          type:
            person.personType === 'STUDENT'
              ? NotificationRecipientType.GUARDIAN
              : NotificationRecipientType.USER,
          id: person.userId,
          destination: person.phone,
        },
        vars: payload,
        dedupe: true,
      });
    }

    if (!person.userId) return false;
    return this.safeSend({
      schoolId,
      code,
      channel: NotificationChannel.IN_APP,
      recipient: {
        type: NotificationRecipientType.USER,
        id: person.userId,
      },
      vars: payload,
    });
  }

  private async safeSend(
    input: Parameters<NotificationService['send']>[0],
  ): Promise<boolean> {
    try {
      await this.notifications.send(input);
      return true;
    } catch (error) {
      this.logger.warn(
        `Library notification ${input.code} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** `Thu 30 Jul 2026` in Asia/Dhaka — what a parent reads. */
  private formatDate(at: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(at);
  }
}
