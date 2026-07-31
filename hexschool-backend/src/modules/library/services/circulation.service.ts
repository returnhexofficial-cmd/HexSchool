import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookCopyStatus,
  BookReservationStatus,
  LibraryFineReason,
  LibraryMember,
} from '@prisma/client';
import type { PrismaClientLike } from '../../../common/database/base.repository';
import { CalendarService } from '../../academic/services/calendar.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { money } from '../../fee/calc/money.util';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { normalizeScannedCode } from '../calc/barcode.util';
import {
  canIssue,
  canRenew,
  dueDateFor,
  renewedDueDate,
  type IssueVerdict,
} from '../calc/circulation.engine';
import {
  assessOverdue,
  isFineSettled,
  replacementCharge,
  totalCharge,
} from '../calc/fine.engine';
import type { IssueBookDto, RenewIssueDto, ReturnBookDto } from '../dto';
import { BookCopiesRepository } from '../repositories/book-copies.repository';
import {
  BookIssuesRepository,
  BookReservationsRepository,
  type IssueWithRelations,
} from '../repositories/circulation.repository';
import { LibraryMembersRepository } from '../repositories/library-members.repository';
import { LibraryMembersService } from './library-members.service';
import {
  LibrarySettingsService,
  type LibraryConfig,
} from './library-settings.service';

export interface ReturnResult {
  issue: IssueWithRelations;
  fine: {
    amount: number;
    daysLate: number;
    chargeableDays: number;
    holidayDays: number;
    capped: boolean;
    reason: LibraryFineReason;
    collected: number;
    outstanding: number;
  };
  /** A hold that this return has just made ready. */
  heldFor: { reservationId: string; memberId: string } | null;
}

/**
 * The circulation desk: issue, return, renew.
 *
 * Two rules shape everything here.
 *
 * **One verdict.** Every "may this go out" question — the desk's greyed
 * button, the API's 409, the OPAC's blocked reason — is one call to
 * `canIssue`, so the three can never disagree (the M16 `deriveStatus` /
 * M22 submission-window lesson). The override tier comes from the
 * verdict too, so a structural refusal cannot be waved through by
 * anybody, however senior.
 *
 * **The copy's status and the loan are one transaction.** A copy marked
 * ISSUED with no open loan is a book nobody can return; an open loan on
 * an AVAILABLE copy is a book the shelf will lend twice. The partial
 * unique `uq_book_issues_open_copy` is the backstop under both.
 */
@Injectable()
export class CirculationService {
  private readonly logger = new Logger(CirculationService.name);

  constructor(
    private readonly issues: BookIssuesRepository,
    private readonly reservations: BookReservationsRepository,
    private readonly copies: BookCopiesRepository,
    private readonly members: LibraryMembersRepository,
    private readonly membersService: LibraryMembersService,
    private readonly calendar: CalendarService,
    private readonly permissions: PermissionsService,
    private readonly config: LibrarySettingsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── issue ───────────────────────────────────────────────────────────

  /**
   * A dry run of the issue decision, for the desk screen. Same call,
   * same verdict — the button's tooltip is the 409's message.
   */
  async previewIssue(dto: IssueBookDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const copy = await this.resolveCopy(dto, actor.schoolId);
    const member = await this.resolveMember(dto, actor.schoolId, false);
    if (!member) {
      return {
        copy,
        member: null,
        verdict: {
          allowed: false,
          code: null,
          reason: 'No library card yet — enrolling one is part of issuing',
          overridable: false,
        } satisfies IssueVerdict,
      };
    }
    const verdict = await this.verdictFor(member, copy.id, cfg, actor.schoolId);
    return { copy, member, verdict };
  }

  async issue(dto: IssueBookDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    this.assertEnabled(cfg);

    const copy = await this.resolveCopy(dto, actor.schoolId);
    const now = new Date();

    const created = await this.issues.withTransaction(async (tx) => {
      // Auto-provision runs inside the transaction so a card number is
      // never burnt by an issue that then fails a guard.
      const member = await this.resolveMemberTx(dto, actor, cfg, tx);
      const verdict = await this.verdictFor(
        member,
        copy.id,
        cfg,
        actor.schoolId,
        tx,
      );

      if (!verdict.allowed) {
        if (!verdict.overridable || !dto.override) {
          throw new ConflictException({
            message: verdict.reason ?? 'This book cannot be issued',
            details: { code: verdict.code, overridable: verdict.overridable },
          });
        }
        await this.assertOverridePermission(actor);
      }

      const loanDays =
        dto.loanDays ?? this.config.loanDaysFor(cfg, member.personType);
      const issue = await this.issues.create(
        {
          schoolId: actor.schoolId,
          copyId: copy.id,
          memberId: member.id,
          issuedAt: now,
          dueAt: dueDateFor(now, loanDays),
          issuedBy: actor.sub,
          remarks: dto.remarks?.trim() || null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );

      await this.copies.setStatus(
        copy.id,
        BookCopyStatus.ISSUED,
        actor.sub,
        tx,
      );

      // Issuing the copy somebody was waiting for closes their hold —
      // whether it was theirs (fulfilment) or an override took it.
      const held = await this.reservations.findHeldCopy(copy.id, tx);
      if (held) {
        await this.reservations.update(
          held.id,
          {
            status:
              held.memberId === member.id
                ? BookReservationStatus.FULFILLED
                : BookReservationStatus.CANCELLED,
            heldCopyId: null,
            closedAt: now,
            updatedBy: actor.sub,
          },
          tx,
        );
      }

      return issue;
    });

    this.audit.set({
      entityType: 'BookIssue',
      entityId: created.id,
      newValues: {
        accessionNo: copy.accessionNo,
        memberId: created.memberId,
        dueAt: created.dueAt,
        override: dto.override === true,
      },
    });

    return this.detail(created.id, actor.schoolId);
  }

  // ── return ──────────────────────────────────────────────────────────

  async return_(
    dto: ReturnBookDto,
    actor: AccessTokenPayload,
  ): Promise<ReturnResult> {
    const cfg = await this.config.load(actor.schoolId);
    const open = await this.resolveOpenIssue(dto, actor.schoolId);
    const now = new Date();

    // The holiday set is fetched OUTSIDE the transaction and handed to
    // the engine — the M12/M21 rule that a calendar read is an input,
    // not something a pure function goes and gets.
    const holidays = cfg.fine.holidayAware
      ? await this.holidaysBetween(actor.schoolId, open.dueAt, now)
      : undefined;

    const overdue = assessOverdue({
      dueAt: open.dueAt,
      returnedAt: now,
      policy: cfg.fine,
      holidays,
    });

    const damaged = dto.condition === 'DAMAGED' || dto.condition === 'POOR';
    const damageCharge = damaged
      ? replacementCharge(
          open.copy.book.price === null ? null : Number(open.copy.book.price),
          cfg.fine,
          'DAMAGED',
        )
      : 0;

    const computed = totalCharge(overdue.amount, damageCharge);
    // Roadmap §8: the librarian's figure wins, with a reason. A book
    // soaked by a burst pipe is not a book used as a coaster, and no
    // engine can tell the difference.
    const assessed =
      dto.fineOverride !== undefined
        ? money(dto.fineOverride)
        : computed.amount;
    if (dto.fineOverride !== undefined && !dto.fineReason?.trim()) {
      throw new BadRequestException(
        'A hand-set fine needs a reason — it is what the member is shown and what an audit reads',
      );
    }

    const collected =
      dto.collectFine === true
        ? await this.assertCollectPermission(actor, assessed)
        : 0;

    const result = await this.issues.withTransaction(async (tx) => {
      await this.issues.update(
        open.id,
        {
          returnedAt: now,
          returnedTo: actor.sub,
          returnCondition: dto.condition ?? null,
          fineAmount: assessed,
          fineCollected: collected,
          fineReason:
            assessed <= 0
              ? LibraryFineReason.NONE
              : damaged
                ? LibraryFineReason.DAMAGED
                : LibraryFineReason.OVERDUE,
          finePaid: isFineSettled({
            fineAmount: assessed,
            fineCollected: collected,
            fineWaived: 0,
          }),
          fineCollectedAt: collected > 0 ? now : null,
          overdueDays: overdue.chargeableDays,
          holidayDays: overdue.holidayDays,
          remarks:
            dto.fineReason?.trim() || dto.conditionNote?.trim() || open.remarks,
          updatedBy: actor.sub,
        },
        tx,
      );

      if (dto.conditionNote?.trim() || dto.condition) {
        await this.copies.update(
          open.copyId,
          {
            ...(dto.condition ? { condition: dto.condition } : {}),
            ...(dto.conditionNote
              ? { conditionNote: dto.conditionNote.trim() }
              : {}),
            updatedBy: actor.sub,
          },
          tx,
        );
      }

      // Where the copy goes next: to the next person in the queue if
      // there is one, otherwise back on the shelf. A copy returned
      // damaged beyond use is written off through `mark()`, not here —
      // that is a decision with a reason attached.
      const heldFor = await this.holdForNextInQueue(
        open.copy.book.id,
        open.copyId,
        actor,
        cfg,
        now,
        tx,
      );
      if (!heldFor) {
        await this.copies.setStatus(
          open.copyId,
          BookCopyStatus.AVAILABLE,
          actor.sub,
          tx,
        );
      }
      return heldFor;
    });

    this.audit.set({
      entityType: 'BookIssue',
      entityId: open.id,
      oldValues: { dueAt: open.dueAt },
      newValues: {
        returnedAt: now,
        fine: assessed,
        collected,
        condition: dto.condition,
      },
    });

    return {
      issue: await this.detail(open.id, actor.schoolId),
      fine: {
        amount: assessed,
        daysLate: overdue.daysLate,
        chargeableDays: overdue.chargeableDays,
        holidayDays: overdue.holidayDays,
        capped: overdue.capped,
        reason:
          assessed <= 0
            ? LibraryFineReason.NONE
            : damaged
              ? LibraryFineReason.DAMAGED
              : LibraryFineReason.OVERDUE,
        collected,
        outstanding: money(assessed - collected),
      },
      heldFor: result,
    };
  }

  // ── renew ───────────────────────────────────────────────────────────

  async renew(id: string, dto: RenewIssueDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const open = await this.detail(id, actor.schoolId);
    const now = new Date();

    if (open.returnedAt !== null) {
      throw new ConflictException('This book has already been returned');
    }

    const others = await this.reservations.countLiveForBookExcluding(
      open.copy.book.id,
      actor.schoolId,
      open.memberId,
    );

    const verdict = canRenew(
      {
        returnedAt: open.returnedAt,
        dueAt: open.dueAt,
        renewCount: open.renewCount,
        memberStatus: open.member.status,
        reservationsByOthers: others,
      },
      cfg.maxRenews,
      now,
      cfg.enabled,
    );

    if (!verdict.allowed) {
      if (!verdict.overridable || !dto.override) {
        throw new ConflictException({
          message: verdict.reason ?? 'This loan cannot be renewed',
          details: { code: verdict.code, overridable: verdict.overridable },
        });
      }
      await this.assertOverridePermission(actor);
    }

    const loanDays =
      dto.loanDays ?? this.config.loanDaysFor(cfg, open.member.personType);
    await this.issues.update(id, {
      dueAt: renewedDueDate(now, loanDays),
      renewCount: open.renewCount + 1,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'BookIssue',
      entityId: id,
      oldValues: { dueAt: open.dueAt, renewCount: open.renewCount },
      newValues: {
        dueAt: renewedDueDate(now, loanDays),
        renewCount: open.renewCount + 1,
        override: dto.override === true,
      },
    });

    return this.detail(id, actor.schoolId);
  }

  // ── reads ───────────────────────────────────────────────────────────

  async list(
    filter: Parameters<BookIssuesRepository['findMany']>[1],
    schoolId: string,
    page: number,
    limit: number,
  ) {
    const { rows, total } = await this.issues.findMany(
      schoolId,
      filter,
      page,
      limit,
    );
    return { rows, total, page, limit };
  }

  async detail(id: string, schoolId: string): Promise<IssueWithRelations> {
    const issue = await this.issues.findDetail(id, schoolId);
    if (!issue) throw new NotFoundException(`Loan ${id} not found`);
    return issue;
  }

  // ── internals ───────────────────────────────────────────────────────

  private async verdictFor(
    member: LibraryMember,
    copyId: string,
    cfg: LibraryConfig,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<IssueVerdict> {
    const now = new Date();
    const copy = await this.copies.findDetail(copyId, schoolId);
    if (!copy) throw new NotFoundException(`Copy ${copyId} not found`);

    const held =
      copy.status === BookCopyStatus.RESERVED
        ? await this.reservations.findHeldCopy(copyId, tx)
        : null;

    const standing = await this.members.standing(member.id, now, tx);

    return canIssue(
      {
        status: member.status,
        maxBooks: member.maxBooks,
        openLoans: standing.openLoans,
        outstandingFine: standing.outstandingFine,
        overdueLoans: standing.overdueLoans,
        heldBookIds: standing.heldBookIds,
      },
      {
        status: copy.status,
        bookId: copy.book.id,
        reservedForMemberId: held?.memberId ?? null,
      },
      cfg.issue,
      member.id,
    );
  }

  private async resolveCopy(
    dto: { copyId?: string; accessionNo?: string },
    schoolId: string,
  ) {
    if (dto.copyId) {
      const copy = await this.copies.findDetail(dto.copyId, schoolId);
      if (!copy) throw new NotFoundException(`Copy ${dto.copyId} not found`);
      return copy;
    }
    if (!dto.accessionNo) {
      throw new BadRequestException(
        'Scan or type an accession number (or supply a copyId)',
      );
    }
    const accessionNo = normalizeScannedCode(dto.accessionNo);
    const copy = await this.copies.findByAccession(schoolId, accessionNo);
    if (!copy) {
      throw new NotFoundException(
        `No copy with accession number "${accessionNo}"`,
      );
    }
    return copy;
  }

  private async resolveMember(
    dto: IssueBookDto,
    schoolId: string,
    required: boolean,
  ): Promise<LibraryMember | null> {
    if (dto.memberId) {
      return this.members.findByIdOrFail(dto.memberId, schoolId);
    }
    if (dto.cardNo) {
      const member = await this.members.findByCard(schoolId, dto.cardNo.trim());
      if (!member) {
        throw new NotFoundException(`No library card "${dto.cardNo.trim()}"`);
      }
      return member;
    }
    if (dto.personType && dto.personId) {
      const existing = await this.members.findByPerson(
        schoolId,
        dto.personType,
        dto.personId,
      );
      if (existing || !required) return existing;
    }
    if (required) {
      throw new BadRequestException(
        'Identify the borrower by card number, member id, or person type + id',
      );
    }
    return null;
  }

  private async resolveMemberTx(
    dto: IssueBookDto,
    actor: AccessTokenPayload,
    cfg: LibraryConfig,
    tx: PrismaClientLike,
  ): Promise<LibraryMember> {
    const existing = await this.resolveMember(dto, actor.schoolId, false);
    if (existing) return existing;

    if (!dto.personType || !dto.personId) {
      throw new BadRequestException(
        'Identify the borrower by card number, member id, or person type + id',
      );
    }
    if (!cfg.autoProvisionMembers) {
      throw new ConflictException(
        'This person has no library card, and automatic enrolment is switched off (library.auto_provision_members)',
      );
    }
    return this.membersService.ensureMember(
      actor.schoolId,
      dto.personType,
      dto.personId,
      actor.sub,
      undefined,
      tx,
    );
  }

  private async resolveOpenIssue(
    dto: ReturnBookDto,
    schoolId: string,
  ): Promise<IssueWithRelations> {
    if (dto.issueId) {
      const issue = await this.detail(dto.issueId, schoolId);
      if (issue.returnedAt !== null) {
        throw new ConflictException('This book has already been returned');
      }
      return issue;
    }
    const copy = await this.resolveCopy(dto, schoolId);
    const open = await this.issues.findOpenForCopy(copy.id, schoolId);
    if (!open) {
      throw new ConflictException(
        `Copy ${copy.accessionNo} is not on loan — nothing to return`,
      );
    }
    return open;
  }

  /**
   * The next member in the queue gets the copy held for them; the copy
   * goes RESERVED rather than AVAILABLE. Without this, a title with a
   * waiting list would be taken by whoever happened to be standing at
   * the desk when it came back, and the queue would mean nothing.
   */
  private async holdForNextInQueue(
    bookId: string,
    copyId: string,
    actor: AccessTokenPayload,
    cfg: LibraryConfig,
    now: Date,
    tx: PrismaClientLike,
  ): Promise<{ reservationId: string; memberId: string } | null> {
    const queue = await this.reservations.queueFor(bookId, actor.schoolId, tx);
    const next = queue.find((r) => r.status === BookReservationStatus.ACTIVE);
    if (!next) return null;

    await this.reservations.update(
      next.id,
      {
        status: BookReservationStatus.READY,
        heldCopyId: copyId,
        readyAt: now,
        expiresAt: new Date(now.getTime() + cfg.reservationDays * 86_400_000),
        updatedBy: actor.sub,
      },
      tx,
    );
    await this.copies.setStatus(copyId, BookCopyStatus.RESERVED, actor.sub, tx);
    return { reservationId: next.id, memberId: next.memberId };
  }

  /** Holidays in `[from, to]`, as the `YYYY-MM-DD` keys the engine uses. */
  private async holidaysBetween(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<Set<string>> {
    const isoOf = (d: Date) => d.toISOString().slice(0, 10);
    if (to.getTime() <= from.getTime()) return new Set();
    try {
      const working = await this.calendar.workingDays(schoolId, from, to);
      const open = new Set(working);
      const closed = new Set<string>();
      for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
        const key = isoOf(new Date(t));
        if (!open.has(key)) closed.add(key);
      }
      return closed;
    } catch (error) {
      // A calendar read that fails must not stop a book being taken
      // back. Charging the un-forgiven fine and letting somebody waive
      // it is better than a desk that cannot accept returns.
      this.logger.warn(
        `Holiday lookup failed, charging every overdue day: ${(error as Error).message}`,
      );
      return new Set();
    }
  }

  private async assertOverridePermission(
    actor: AccessTokenPayload,
  ): Promise<void> {
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes('library.issue.override')) {
      throw new ForbiddenException(
        'Overriding a borrowing limit, a fine block or another member’s hold needs library.issue.override',
      );
    }
  }

  private async assertCollectPermission(
    actor: AccessTokenPayload,
    amount: number,
  ): Promise<number> {
    if (amount <= 0) return 0;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes('library.fine.collect')) {
      throw new ForbiddenException(
        'Taking the fine at the return desk needs library.fine.collect — return the book and collect separately',
      );
    }
    return amount;
  }

  private assertEnabled(cfg: LibraryConfig): void {
    if (!cfg.enabled) {
      throw new ConflictException(
        'The library is switched off for this school (library.enabled)',
      );
    }
  }
}
