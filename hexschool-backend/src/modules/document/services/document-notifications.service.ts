import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
} from '../../../common/constants';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { isoDate } from '../../academic/calendar/date.util';
import { NotificationService } from '../../communication/services/notification.service';
import type { CertificateWithRelations } from '../repositories/certificates.repository';

/**
 * Module 27's outbound messages, all through `NotificationService.send()`
 * — the M17 rule that there are no direct gateway calls anywhere.
 *
 * Every send is wrapped: a school with an empty SMS balance must not make
 * *issuing a certificate* fail (the M07 "delivery must never block the
 * mutation" rule, and the M23/M24/M25/M26 precedent verbatim). Both
 * messages go to the **guardian**, because a certificate is a family's
 * document — and the issue message carries the verify code, so the person
 * who will be asked to prove it is genuine has it on their phone even if
 * the paper goes missing.
 */
@Injectable()
export class DocumentNotificationsService {
  private readonly logger = new Logger(DocumentNotificationsService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  async certificateIssued(
    schoolId: string,
    certificate: CertificateWithRelations,
    url: string,
  ): Promise<boolean> {
    const guardian = await this.primaryGuardian(certificate.studentId);
    if (!guardian) return false;

    return this.deliver(schoolId, guardian, 'CERTIFICATE_ISSUED', {
      student_name: this.studentName(certificate),
      type: this.typeLabel(certificate.type),
      certificate_no: certificate.certificateNo ?? '',
      verify_code: certificate.verifyCode ?? '',
      verify_url: url,
      issue_date: certificate.issuedAt ? isoDate(certificate.issuedAt) : '',
      school: await this.schoolName(schoolId),
    });
  }

  async certificateRevoked(
    schoolId: string,
    certificate: CertificateWithRelations,
    reason: string,
  ): Promise<boolean> {
    const guardian = await this.primaryGuardian(certificate.studentId);
    if (!guardian) return false;

    return this.deliver(schoolId, guardian, 'CERTIFICATE_REVOKED', {
      student_name: this.studentName(certificate),
      type: this.typeLabel(certificate.type),
      certificate_no: certificate.certificateNo ?? '',
      reason,
      school: await this.schoolName(schoolId),
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private studentName(certificate: CertificateWithRelations): string {
    return `${certificate.student.firstName} ${certificate.student.lastName}`.trim();
  }

  /** "TRANSFER" reads as shouting on a parent's phone. */
  private typeLabel(type: string): string {
    return type.charAt(0) + type.slice(1).toLowerCase();
  }

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
   * SMS when the guardian has a phone, IN_APP otherwise — **the opposite
   * default from M22/M26**, and deliberately so. Homework is daily and the
   * bell is where a portal user already looks; a certificate is issued
   * once and the message is the family's proof that it exists. Spending an
   * SMS on it is what the credit is for.
   */
  private async deliver(
    schoolId: string,
    guardian: { name: string; phone: string; userId: string | null },
    code: string,
    vars: Record<string, string>,
  ): Promise<boolean> {
    const channel = guardian.phone
      ? NotificationChannel.SMS
      : NotificationChannel.IN_APP;

    if (channel === NotificationChannel.IN_APP && !guardian.userId)
      return false;

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
        `Certificate notification ${input.code} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
