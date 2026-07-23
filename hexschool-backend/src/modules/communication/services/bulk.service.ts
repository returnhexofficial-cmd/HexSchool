import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { randomUUID } from 'crypto';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { estimateSmsCost, segmentSms } from '../calc/sms-parts.util';
import { renderTemplate } from '../calc/template.engine';
import { BulkSendDto } from '../dto';
import {
  AudienceMember,
  AudienceRepository,
} from '../repositories/audience.repository';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { CommunicationSettingsService } from './communication-settings.service';
import { NotificationService } from './notification.service';

export interface BulkPreview {
  recipients: number;
  segmentsPerMessage: number;
  unicode: boolean;
  totalParts: number;
  estimatedCost: number;
  requiresLargePermission: boolean;
  sample: string;
}

export interface BulkSendResult {
  batchKey: string;
  queued: number;
}

const NORMALIZE = /[^0-9]/g;

/**
 * The bulk composer (roadmap M17 §4/§6). Resolves an audience, previews
 * the count + SMS cost, and — on confirm — renders per recipient and
 * fans the sends out through `NotificationService` in rate-spread chunks.
 *
 * A large blast (> `communication.bulk_large_threshold`) needs
 * `notification.bulk.large` (checked at runtime, the M08/M12 precedent). A
 * repeat submit of the same `batchKey` is refused, which is the
 * double-click idempotency the roadmap §8 asks for.
 */
@Injectable()
export class BulkService {
  constructor(
    private readonly audience: AudienceRepository,
    private readonly notificationService: NotificationService,
    private readonly notifications: NotificationsRepository,
    private readonly config: CommunicationSettingsService,
    private readonly schools: SchoolsRepository,
    private readonly permissions: PermissionsService,
  ) {}

  async preview(schoolId: string, dto: BulkSendDto): Promise<BulkPreview> {
    const cfg = await this.config.load(schoolId);
    const members = await this.resolveMembers(schoolId, dto);
    const seg = segmentSms(dto.message);
    const perMessageCost =
      dto.channel === NotificationChannel.SMS
        ? estimateSmsCost(
            dto.message,
            cfg.smsRatePerPart,
            cfg.smsUnicodeRatePerPart,
          )
        : 0;
    return {
      recipients: members.length,
      segmentsPerMessage: seg.segments,
      unicode: seg.unicode,
      totalParts:
        dto.channel === NotificationChannel.SMS
          ? seg.segments * members.length
          : 0,
      estimatedCost:
        Math.round(perMessageCost * members.length * 10000) / 10000,
      requiresLargePermission: members.length > cfg.bulkLargeThreshold,
      sample: renderTemplate(dto.message, {
        name: members[0]?.name ?? 'Karim Rahman',
        student_name: members[0]?.name ?? 'Karim Rahman',
        school: '',
      }),
    };
  }

  async send(
    schoolId: string,
    dto: BulkSendDto,
    actor: AccessTokenPayload,
  ): Promise<BulkSendResult> {
    const cfg = await this.config.load(schoolId);
    const members = await this.resolveMembers(schoolId, dto);
    if (members.length === 0) {
      throw new BadRequestException('The audience resolved to zero recipients');
    }

    // Double-submit idempotency (roadmap §8): a batch key already used
    // must not fan out twice.
    const batchKey = dto.batchKey ?? randomUUID();
    if (dto.batchKey) {
      const existing = await this.notifications.countByBatch(
        schoolId,
        batchKey,
      );
      const total = Object.values(existing).reduce((a, b) => a + b, 0);
      if (total > 0) {
        throw new ConflictException(
          `Batch ${batchKey} was already sent (${total} messages)`,
        );
      }
    }

    // Large-blast gate (roadmap §6) — runtime permission check (M08/M12
    // precedent), Super Admin bypass.
    if (
      members.length > cfg.bulkLargeThreshold &&
      actor.userType !== UserType.SUPER_ADMIN
    ) {
      const codes = await this.permissions.getUserPermissionCodes(actor.sub);
      if (!codes.includes('notification.bulk.large')) {
        throw new ForbiddenException(
          `Sending to ${members.length} recipients needs notification.bulk.large (threshold ${cfg.bulkLargeThreshold})`,
        );
      }
    }

    const school = await this.schools.findById(schoolId);
    const schoolName = school?.name ?? '';

    // Rate spreading: each chunk is delayed a little further so a blast
    // does not exceed the provider's per-second cap.
    const chunkSize = cfg.bulkChunkSize;
    const spacingMs = 1000;
    let queued = 0;
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const chunkIndex = Math.floor(i / chunkSize);
      const rendered = renderTemplate(dto.message, {
        name: member.name,
        student_name: member.name,
        school: schoolName,
      });
      const row = await this.notificationService.send({
        schoolId,
        code: dto.code ?? 'NOTICE',
        channel: dto.channel,
        recipient: {
          type: member.recipientType,
          id: member.recipientId === 'RAW' ? null : member.recipientId,
          destination: member.destination,
        },
        rawBody: rendered,
        rawSubject: dto.subject,
        emergency: dto.emergency ?? false,
        batchKey,
        createdBy: actor.sub,
        extraDelayMs: dto.emergency ? 0 : chunkIndex * spacingMs,
      });
      if (row) queued++;
    }

    return { batchKey, queued };
  }

  private async resolveMembers(
    schoolId: string,
    dto: BulkSendDto,
  ): Promise<AudienceMember[]> {
    if (dto.audience === 'RAW') {
      const numbers = [
        ...new Set((dto.customNumbers ?? []).map((n) => n.trim())),
      ].filter((n) => n.replace(NORMALIZE, '').length >= 10);
      return numbers.map((n) => ({
        recipientType: 'STAFF' as const, // RAW numbers have no owning profile
        recipientId: 'RAW',
        destination: n,
        name: '',
      }));
    }
    if (!dto.sessionId) {
      throw new BadRequestException(
        `A ${dto.audience} audience needs a sessionId to resolve the roster`,
      );
    }
    return this.audience.resolve({
      schoolId,
      sessionId: dto.sessionId,
      audience: dto.audience,
      classIds: dto.classIds,
      sectionIds: dto.sectionIds,
      channel: dto.channel,
    });
  }
}
