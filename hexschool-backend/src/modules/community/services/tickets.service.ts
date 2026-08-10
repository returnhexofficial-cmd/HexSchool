import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Ticket,
  TicketComment,
  TicketRaiserType,
  TicketStatus,
} from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { RecaptchaService } from '../../admission/services/recaptcha.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import { htmlToText } from '../../website/calc/html-sanitize.util';
import {
  canTransition,
  isAnonymous,
  isSensitiveCategory,
  reopenWindow,
  statusPatch,
} from '../calc/ticket.engine';
import type { TicketCategoryCode } from '../calc/types';
import {
  AssignTicketDto,
  CreateTicketDto,
  PortalTicketDto,
  PublicTicketDto,
  TicketCommentDto,
  TicketQueryDto,
  TicketRatingDto,
  TicketStatusDto,
} from '../dto';
import {
  TicketCommentsRepository,
  TicketsRepository,
} from '../repositories/tickets.repository';
import { CommunityDirectoryRepository } from '../repositories/community-directory.repository';
import { CommunityNotificationsService } from './community-notifications.service';
import { CommunitySettingsService } from './community-settings.service';

/** Who may read a restricted complaint (roadmap §8). */
const SENSITIVE_CODE = 'ticket.sensitive.view';
/** Holding this makes you a manager of the inbox, not just its assignee. */
const MANAGE_CODE = 'ticket.assign';

export interface TicketView extends Ticket {
  assigneeName: string | null;
  requesterName: string | null;
  commentCount: number;
  reopenClosesAt: Date | null;
}

/**
 * The complaints workflow (roadmap M28 §4, §6, §8).
 *
 * Three rules run through everything here and are worth stating once:
 *
 * **1. Anonymity is structural.** An ANONYMOUS ticket stores no raiser id,
 * no contact block and no IP — the DTO refuses to build one, this service
 * refuses to write one, and `chk_tickets_raiser` refuses the row if both
 * were somehow wrong. Nothing can notify the complainant because there is
 * nothing there to notify.
 *
 * **2. A sensitive ticket is invisible, not forbidden.** A caller without
 * `ticket.sensitive.view` gets the same 404 an unknown id gets — the
 * M15/M19/M22 rule that a read must not confirm what the caller may not
 * see. A 403 would tell a member of staff that a complaint about them
 * exists, which is precisely the disclosure roadmap §8 is preventing.
 *
 * **3. Status belongs to the assignee or an inbox manager**, roadmap §6.
 * The permission code (`ticket.respond`) is checked at the controller; the
 * *relationship* is checked in `ticket.engine`, because "your own ticket"
 * is not something a permission can express.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly comments: TicketCommentsRepository,
    private readonly directory: CommunityDirectoryRepository,
    private readonly config: CommunitySettingsService,
    private readonly notifications: CommunityNotificationsService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly permissions: PermissionsService,
    private readonly recaptcha: RecaptchaService,
    private readonly audit: AuditContextService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────

  async list(query: TicketQueryDto, user: AccessTokenPayload) {
    const includeSensitive = await this.maySeeSensitive(user);
    const { rows, total } = await this.tickets.findMany(
      user.schoolId,
      {
        type: query.type,
        category: query.category,
        status: query.status,
        priority: query.priority,
        assignedTo: query.assignedTo,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        search: query.search,
        includeSensitive,
      },
      query.page,
      query.limit,
    );

    const views = await this.decorate(rows, user.schoolId);
    return {
      data: views,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async get(id: string, user: AccessTokenPayload): Promise<TicketView> {
    const ticket = await this.tickets.findDetail(id, user.schoolId);
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);

    if (ticket.isSensitive && !(await this.maySeeSensitive(user))) {
      // Deliberately the SAME message an unknown id gets. See the class
      // note: a 403 here confirms that a complaint about somebody exists.
      throw new NotFoundException(`Ticket ${id} not found`);
    }

    const [view] = await this.decorate([ticket], user.schoolId);
    return view;
  }

  /** The thread. Internal notes only for staff who may manage the inbox. */
  async thread(id: string, user: AccessTokenPayload): Promise<TicketComment[]> {
    await this.get(id, user);
    return this.comments.findForTicket(id, user.schoolId, true);
  }

  // ── writes ──────────────────────────────────────────────────────────

  /** Raised from the admin desk — the office logging a walk-in complaint. */
  async create(
    dto: CreateTicketDto,
    user: AccessTokenPayload,
  ): Promise<TicketView> {
    const cfg = await this.config.load(user.schoolId);
    this.assertEnabled(cfg.enabled);

    const raisedByType = dto.raisedByType ?? TicketRaiserType.STAFF;
    if (raisedByType === TicketRaiserType.ANONYMOUS) {
      throw new BadRequestException(
        'An anonymous complaint can only be filed through the public form — a ticket typed at the counter is not anonymous.',
      );
    }
    if (raisedByType !== TicketRaiserType.PUBLIC && !dto.raisedById) {
      throw new BadRequestException(
        `A ${raisedByType} ticket must name the person who raised it`,
      );
    }
    if (
      raisedByType === TicketRaiserType.PUBLIC &&
      !dto.contactPhone &&
      !dto.contactEmail
    ) {
      throw new BadRequestException(
        'A ticket with no account behind it needs a phone number or an email, or the school cannot reply',
      );
    }

    const ticket = await this.write({
      schoolId: user.schoolId,
      cfg,
      dto,
      raisedByType,
      raisedById: dto.raisedById ?? null,
      contact:
        raisedByType === TicketRaiserType.PUBLIC
          ? {
              name: dto.contactName ?? '',
              phone: dto.contactPhone ?? '',
              email: dto.contactEmail ?? '',
            }
          : null,
      ip: null,
      actorId: user.sub,
      isSensitive: dto.isSensitive,
      assignedTo: dto.assignedTo ?? null,
      priority: dto.priority,
    });

    this.audit.set({
      entityType: 'Ticket',
      entityId: ticket.id,
      newValues: { ticketNo: ticket.ticketNo, subject: ticket.subject },
    });
    await this.notifications.announceTicket(ticket);

    const [view] = await this.decorate([ticket], user.schoolId);
    return view;
  }

  /**
   * The unauthenticated website form. Three defences, the M19 contact-form
   * shape: reCAPTCHA, the route throttle, and a per-IP hourly cap here —
   * the last is what stops a script that solved the captcha once.
   *
   * **The IP is not recorded for an anonymous complaint.** An IP address is
   * a contact detail, and storing one beside a complaint the school
   * promised not to trace is the promise broken by a different name. That
   * means an anonymous submission is rate-limited by the captcha and the
   * throttle only, which is the price of the promise.
   */
  async submitPublic(
    schoolId: string,
    dto: PublicTicketDto,
    ip?: string,
  ): Promise<{ message: string; ticketNo: string }> {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    if (!cfg.ticketAllowPublic) {
      throw new BadRequestException(
        'The school is not accepting complaints through the website at the moment',
      );
    }
    const anonymous = dto.anonymous === true;
    if (anonymous && !cfg.ticketAllowAnonymous) {
      throw new BadRequestException(
        'This school does not accept anonymous complaints. Please leave a name and a contact.',
      );
    }
    if (!anonymous && !dto.phone && !dto.email) {
      throw new BadRequestException(
        'Leave a phone number or an email address so the school can reply, or submit anonymously',
      );
    }

    await this.recaptcha.assertValid(dto.recaptchaToken, ip);

    if (!anonymous && ip) {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await this.tickets.countRecentFromIp(schoolId, ip, since);
      if (recent >= cfg.ticketPublicHourlyLimit) {
        throw new BadRequestException(
          'Too many submissions from this connection. Please try again later.',
        );
      }
    }

    const ticket = await this.write({
      schoolId,
      cfg,
      dto,
      raisedByType: anonymous
        ? TicketRaiserType.ANONYMOUS
        : TicketRaiserType.PUBLIC,
      raisedById: null,
      contact: anonymous
        ? null
        : {
            name: dto.name ?? 'Anonymous',
            phone: dto.phone ?? '',
            email: dto.email ?? '',
          },
      ip: anonymous ? null : (ip ?? null),
      actorId: null,
    });

    await this.notifications.announceTicket(ticket);
    return {
      message: anonymous
        ? 'Thank you — the school has received your complaint. It carries no name and no contact, so there will be no reply; quote this reference if you follow it up.'
        : 'Thank you — the school has received your ticket and will be in touch.',
      ticketNo: ticket.ticketNo,
    };
  }

  /**
   * The portal "Contact School" form. **This is what replaces M18's stub**
   * — the message used to land in the M19 office inbox, and now it opens a
   * real thread the family can follow.
   *
   * None of the public defences apply: the sender is an authenticated
   * parent or student, so the account is the rate limit and a captcha
   * would only punish them. The requester is taken from the resolved
   * principal, never from the request body — a signed-in sender does not
   * get to file under somebody else's name (the M18 rule, carried over).
   */
  async submitFromPortal(
    schoolId: string,
    sender: { raiserType: TicketRaiserType; raiserId: string },
    dto: PortalTicketDto,
  ): Promise<{ message: string; ticketNo: string; id: string }> {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    const ticket = await this.write({
      schoolId,
      cfg,
      dto,
      raisedByType: sender.raiserType,
      raisedById: sender.raiserId,
      contact: null,
      ip: null,
      actorId: null,
    });

    await this.notifications.announceTicket(ticket);
    return {
      message: 'Thank you — the school has received your message.',
      ticketNo: ticket.ticketNo,
      id: ticket.id,
    };
  }

  /** What a portal user raised — their own tickets and nobody else's. */
  async mine(
    schoolId: string,
    raiserType: TicketRaiserType,
    raiserId: string,
  ): Promise<Array<Ticket & { comments: TicketComment[] }>> {
    const rows = await this.tickets.findForRaiser(
      schoolId,
      raiserType,
      raiserId,
    );
    return Promise.all(
      rows.map(async (ticket) => ({
        ...ticket,
        // `includeInternal: false` — an internal note is what the office
        // says to itself, and the portal thread must never carry one.
        comments: await this.comments.findForTicket(ticket.id, schoolId, false),
      })),
    );
  }

  async assign(
    id: string,
    dto: AssignTicketDto,
    user: AccessTokenPayload,
  ): Promise<TicketView> {
    const existing = await this.get(id, user);

    const updated = await this.tickets.update(id, {
      ...(dto.assignedTo !== undefined ? { assignedTo: dto.assignedTo } : {}),
      ...(dto.priority ? { priority: dto.priority } : {}),
      ...(dto.category ? { category: dto.category } : {}),
      ...(dto.isSensitive !== undefined
        ? { isSensitive: dto.isSensitive }
        : {}),
      updatedBy: user.sub,
    });

    this.audit.set({
      entityType: 'Ticket',
      entityId: id,
      oldValues: {
        assignedTo: existing.assignedTo,
        priority: existing.priority,
        isSensitive: existing.isSensitive,
      },
      newValues: {
        assignedTo: updated.assignedTo,
        priority: updated.priority,
        isSensitive: updated.isSensitive,
      },
    });

    const [view] = await this.decorate([updated], user.schoolId);
    return view;
  }

  async setStatus(
    id: string,
    dto: TicketStatusDto,
    user: AccessTokenPayload,
  ): Promise<TicketView> {
    const existing = await this.get(id, user);
    const cfg = await this.config.load(user.schoolId);
    const now = new Date();

    const verdict = canTransition(
      {
        status: existing.status,
        closedAt: existing.closedAt,
        assignedTo: existing.assignedTo,
      },
      dto.status,
      {
        isManager: await this.hasPermission(user, MANAGE_CODE),
        isAssignee: existing.assignedTo === user.sub,
      },
      { now, reopenWindowDays: cfg.ticketReopenDays },
    );

    if (!verdict.allowed) {
      throw verdict.kind === 'STRUCTURAL'
        ? new ConflictException(verdict.reason)
        : new ForbiddenException(verdict.reason);
    }

    if (
      (dto.status === TicketStatus.RESOLVED ||
        dto.status === TicketStatus.CLOSED) &&
      !dto.resolution?.trim() &&
      !existing.resolution?.trim()
    ) {
      throw new BadRequestException(
        'Say what was done. A ticket marked resolved with nothing written on it is the one a parent rings up about and nobody can answer.',
      );
    }

    const patch = statusPatch(dto.status, now, {
      resolution: dto.resolution ?? existing.resolution,
      existingResolvedAt: existing.resolvedAt,
    });

    const updated = await this.tickets.update(id, {
      ...patch,
      // The first thing anybody said back, stamped once and never moved —
      // it is the "are we responsive" number, not the "did we finish" one.
      firstResponseAt: existing.firstResponseAt ?? now,
      updatedBy: user.sub,
    });

    this.audit.set({
      entityType: 'Ticket',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: dto.status, resolution: patch.resolution },
    });

    if (dto.notify !== false) {
      await this.notifications.notifyRequester(
        updated,
        cfg,
        patch.resolution ?? '',
      );
    }

    const [view] = await this.decorate([updated], user.schoolId);
    return view;
  }

  async comment(
    id: string,
    dto: TicketCommentDto,
    user: AccessTokenPayload,
  ): Promise<TicketComment> {
    const ticket = await this.get(id, user);
    const cfg = await this.config.load(user.schoolId);
    const now = new Date();

    const names = await this.directory.userNames([user.sub]);
    const comment = await this.comments.create({
      schoolId: user.schoolId,
      ticketId: id,
      authorId: user.sub,
      authorName: names.get(user.sub) ?? 'Staff',
      // Plain text only: the thread renders it as text, and stripping
      // markup at the door means nothing stored can ever be rendered as
      // markup (the M19 contact-inbox rule).
      body: htmlToText(dto.body),
      isInternal: dto.isInternal === true,
    });

    if (!ticket.firstResponseAt) {
      await this.tickets.update(id, { firstResponseAt: now });
    }

    // An internal note is never sent to the requester — it is the whole
    // reason the column exists.
    if (!comment.isInternal && dto.notify !== false) {
      await this.notifications.notifyRequester(ticket, cfg, comment.body);
    }
    return comment;
  }

  /** The requester's own reply, from the portal. Never internal. */
  async replyFromPortal(
    id: string,
    schoolId: string,
    sender: { raiserType: TicketRaiserType; raiserId: string; name: string },
    body: string,
  ): Promise<TicketComment> {
    const ticket = await this.assertOwnTicket(id, schoolId, sender);

    // Replying to a closed ticket is how a parent says "this is not
    // settled". It does not reopen it — that is the office's decision,
    // inside the seven-day window — but it must not be silently dropped.
    return this.comments.create({
      schoolId,
      ticketId: ticket.id,
      authorId: null,
      authorName: sender.name,
      body: htmlToText(body),
      isInternal: false,
    });
  }

  /** Roadmap §4's satisfaction prompt, answered by the person who asked. */
  async rateFromPortal(
    id: string,
    schoolId: string,
    sender: { raiserType: TicketRaiserType; raiserId: string; name: string },
    dto: TicketRatingDto,
  ): Promise<Ticket> {
    const ticket = await this.assertOwnTicket(id, schoolId, sender);

    if (
      ticket.status !== TicketStatus.RESOLVED &&
      ticket.status !== TicketStatus.CLOSED
    ) {
      throw new ConflictException(
        'A ticket can only be rated once the school has resolved it',
      );
    }
    if (ticket.satisfactionRating !== null) {
      throw new ConflictException('This ticket has already been rated');
    }

    const updated = await this.tickets.update(id, {
      satisfactionRating: dto.rating,
    });

    if (dto.comment?.trim()) {
      await this.comments.create({
        schoolId,
        ticketId: id,
        authorId: null,
        authorName: sender.name,
        body: htmlToText(dto.comment),
        isInternal: false,
      });
    }
    return updated;
  }

  /** Spam from the public form. Not how a real complaint goes away. */
  async remove(id: string, user: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, user);
    await this.tickets.softDelete(id);
    this.audit.set({
      entityType: 'Ticket',
      entityId: id,
      oldValues: {
        ticketNo: existing.ticketNo,
        subject: existing.subject,
        status: existing.status,
      },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private assertEnabled(enabled: boolean): void {
    if (!enabled) {
      throw new BadRequestException(
        'The complaints, visitor and alumni module is switched off for this school',
      );
    }
  }

  private async write(input: {
    schoolId: string;
    cfg: Awaited<ReturnType<CommunitySettingsService['load']>>;
    dto: {
      type: unknown;
      category: unknown;
      subject: string;
      description: string;
      attachments?: unknown[];
    };
    raisedByType: TicketRaiserType;
    raisedById: string | null;
    contact: { name: string; phone: string; email: string } | null;
    ip: string | null;
    actorId: string | null;
    isSensitive?: boolean;
    assignedTo?: string | null;
    priority?: Ticket['priority'];
  }): Promise<Ticket> {
    const school = await this.schools.findByIdOrFail(input.schoolId);
    const category = input.dto.category as TicketCategoryCode;

    // Roadmap §8, decided ONCE at creation and then stored. A school that
    // later drops TEACHER from its sensitive list must not thereby expose
    // the complaints already filed under it.
    const sensitive =
      input.isSensitive ??
      isSensitiveCategory(category, input.cfg.ticketSensitiveCategories);

    return this.tickets.withTransaction(async (tx) => {
      const ticketNo = await this.sequences.nextDocumentNumber({
        schoolId: input.schoolId,
        counterKey: `ticket:${new Date().getUTCFullYear() % 100}`,
        pattern: input.cfg.ticketNoPattern,
        schoolCode: school.code,
        tx,
      });

      return this.tickets.create(
        {
          schoolId: input.schoolId,
          ticketNo,
          type: input.dto.type as Ticket['type'],
          category: category,
          subject: htmlToText(input.dto.subject).slice(0, 200),
          description: htmlToText(input.dto.description),
          attachments: (input.dto.attachments ?? []) as Prisma.InputJsonValue,
          raisedByType: input.raisedByType,
          raisedById: input.raisedById,
          contact: input.contact ?? Prisma.DbNull,
          ip: input.ip,
          isSensitive: sensitive,
          ...(input.assignedTo ? { assignedTo: input.assignedTo } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          createdBy: input.actorId,
        },
        tx,
      );
    });
  }

  private async assertOwnTicket(
    id: string,
    schoolId: string,
    sender: { raiserType: TicketRaiserType; raiserId: string },
  ): Promise<Ticket> {
    const ticket = await this.tickets.findDetail(id, schoolId);
    // Ownership IS the authorization here, exactly as it is in the portal
    // (M18): a ticket somebody else raised gives the same 404 a missing
    // one does, and there is no id in the response to walk.
    if (
      !ticket ||
      ticket.raisedByType !== sender.raiserType ||
      ticket.raisedById !== sender.raiserId
    ) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    return ticket;
  }

  private async maySeeSensitive(user: AccessTokenPayload): Promise<boolean> {
    return this.hasPermission(user, SENSITIVE_CODE);
  }

  private async hasPermission(
    user: AccessTokenPayload,
    code: string,
  ): Promise<boolean> {
    if (user.userType === 'SUPER_ADMIN') return true;
    const codes = await this.permissions.getUserPermissionCodes(user.sub);
    return codes.includes(code);
  }

  private async decorate(
    rows: Ticket[],
    schoolId: string,
  ): Promise<TicketView[]> {
    const assigneeIds = [
      ...new Set(
        rows.map((r) => r.assignedTo).filter((id): id is string => !!id),
      ),
    ];
    const names = await this.directory.userNames(assigneeIds);
    const cfg = await this.config.load(schoolId);

    return Promise.all(
      rows.map(async (ticket) => {
        const window = reopenWindow(
          {
            status: ticket.status,
            closedAt: ticket.closedAt,
            assignedTo: ticket.assignedTo,
          },
          new Date(),
          cfg.ticketReopenDays,
        );

        return {
          ...ticket,
          assigneeName: ticket.assignedTo
            ? (names.get(ticket.assignedTo) ?? null)
            : null,
          // **Never resolved for an anonymous ticket.** There is nothing
          // to resolve — the row holds no id — and asking would be the
          // first step towards an answer.
          requesterName: isAnonymous(ticket.raisedByType)
            ? null
            : await this.requesterName(ticket),
          commentCount: await this.comments.countForTicket(ticket.id, schoolId),
          reopenClosesAt: window.closesAt,
        };
      }),
    );
  }

  private async requesterName(ticket: Ticket): Promise<string | null> {
    if (ticket.raisedByType === TicketRaiserType.PUBLIC) {
      const contact = (ticket.contact ?? {}) as { name?: string };
      return contact.name ?? null;
    }
    if (!ticket.raisedById) return null;
    const person = await this.directory.requester(
      ticket.schoolId,
      ticket.raisedByType as 'GUARDIAN' | 'STUDENT' | 'STAFF',
      ticket.raisedById,
    );
    return person?.name ?? null;
  }
}
