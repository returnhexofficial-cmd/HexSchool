import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContactMessage } from '@prisma/client';
import {
  ContactMessageStatus,
  NotificationChannel,
  NotificationRecipientType,
} from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RecaptchaService } from '../../admission/services/recaptcha.service';
import { NotificationService } from '../../communication/services/notification.service';
import {
  ContactMessageQueryDto,
  PublicContactDto,
  UpdateContactMessageStatusDto,
} from '../dto';
import { htmlToText } from '../calc/html-sanitize.util';
import { ContactMessagesRepository } from '../repositories/cms-content.repository';
import { PublicSiteRepository } from '../repositories/public-site.repository';
import { WebsiteSettingsService } from './website-settings.service';

/** A single IP may leave this many messages per hour. */
const IP_HOURLY_LIMIT = 5;

/**
 * The public contact form and the inbox behind it (roadmap M19 §4).
 *
 * Three defences, because this is the one endpoint that lets an anonymous
 * visitor write a row: reCAPTCHA (shared with the M10 admission service),
 * the global throttler on the route, and a per-IP hourly count here — the
 * last one is what actually stops a script that solved the captcha once.
 */
@Injectable()
export class ContactService {
  constructor(
    private readonly messages: ContactMessagesRepository,
    private readonly people: PublicSiteRepository,
    private readonly recaptcha: RecaptchaService,
    private readonly notifications: NotificationService,
    private readonly config: WebsiteSettingsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── public ──────────────────────────────────────────────────────────

  async submit(
    schoolId: string,
    dto: PublicContactDto,
    ip?: string,
  ): Promise<{ message: string }> {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException(
        'Leave a phone number or an email address so the school can reply',
      );
    }
    await this.recaptcha.assertValid(dto.recaptchaToken, ip);

    if (ip) {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await this.messages.countRecentFromIp(schoolId, ip, since);
      if (recent >= IP_HOURLY_LIMIT) {
        throw new BadRequestException(
          'Too many messages from this connection. Please try again later.',
        );
      }
    }

    // Plain text only: the inbox renders it as text, and stripping markup
    // at the door means nothing stored can ever be rendered as markup.
    const created = await this.messages.create({
      schoolId,
      name: dto.name,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      subject: dto.subject ? htmlToText(dto.subject) : null,
      body: htmlToText(dto.body),
      status: ContactMessageStatus.NEW,
      ip: ip ?? null,
    });

    await this.notifyOffice(schoolId, created).catch(() => undefined);
    return { message: 'Thank you — the school has received your message.' };
  }

  // ── inbox ───────────────────────────────────────────────────────────

  list(
    schoolId: string,
    query: ContactMessageQueryDto,
  ): Promise<PaginatedResult<ContactMessage>> {
    return this.messages.paginate(query, {
      schoolId,
      where: query.status ? { status: query.status } : {},
      searchColumns: ['name', 'subject', 'phone', 'email'],
      sortableColumns: ['createdAt', 'status', 'name'],
    });
  }

  async get(id: string, schoolId: string): Promise<ContactMessage> {
    const row = await this.messages.findById(id, schoolId);
    if (!row) throw new NotFoundException(`Message ${id} not found`);
    return row;
  }

  /**
   * Status changes carry their evidence: READ stamps `read_at`, REPLIED
   * stamps `replied_at` (and keeps whatever `read_at` was already there).
   * The DB CHECK refuses the row otherwise, so this is the only shape the
   * write can take.
   */
  async setStatus(
    id: string,
    dto: UpdateContactMessageStatusDto,
    actor: AccessTokenPayload,
  ): Promise<ContactMessage> {
    const existing = await this.get(id, actor.schoolId);
    const now = new Date();

    const updated = await this.messages.update(id, {
      status: dto.status,
      readAt:
        dto.status === ContactMessageStatus.NEW
          ? null
          : (existing.readAt ?? now),
      repliedAt:
        dto.status === ContactMessageStatus.REPLIED
          ? (existing.repliedAt ?? now)
          : existing.repliedAt,
      ...(dto.replyNote !== undefined ? { replyNote: dto.replyNote } : {}),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'ContactMessage',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: dto.status },
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor.schoolId);
    await this.messages.softDelete(id);
    this.audit.set({
      entityType: 'ContactMessage',
      entityId: id,
      oldValues: { name: existing.name, subject: existing.subject },
    });
  }

  /**
   * In-app to every admin, plus an email when `website.contact_email` is
   * configured — through `NotificationService.send()`, never a direct
   * mailer (the M17 single-entry-point rule).
   */
  private async notifyOffice(
    schoolId: string,
    message: ContactMessage,
  ): Promise<void> {
    const vars = {
      name: message.name,
      phone: message.phone ?? '',
      email: message.email ?? '',
      subject: message.subject ?? '(no subject)',
      body: message.body.slice(0, 300),
    };

    const admins = await this.people.adminUserIds(schoolId);
    await Promise.all(
      admins.map((userId) =>
        this.notifications.send({
          schoolId,
          code: 'CONTACT_MESSAGE',
          channel: NotificationChannel.IN_APP,
          recipient: { type: NotificationRecipientType.USER, id: userId },
          vars,
        }),
      ),
    );

    const cfg = await this.config.load(schoolId);
    if (cfg.contactEmail) {
      await this.notifications.send({
        schoolId,
        code: 'CONTACT_MESSAGE',
        channel: NotificationChannel.EMAIL,
        recipient: {
          type: NotificationRecipientType.RAW,
          destination: cfg.contactEmail,
        },
        vars,
      });
    }
  }
}
