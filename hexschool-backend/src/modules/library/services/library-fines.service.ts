import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { money } from '../../fee/calc/money.util';
import { isFineSettled, outstandingFine } from '../calc/fine.engine';
import type { CollectFineDto, WaiveFineDto } from '../dto';
import { BookIssuesRepository } from '../repositories/circulation.repository';
import { LibraryDirectoryRepository } from '../repositories/library-directory.repository';
import { CirculationService } from './circulation.service';
import { LibraryPostingService } from './library-posting.service';
import { LibrarySettingsService } from './library-settings.service';

/**
 * Roadmap §4's "fine handling: collect at desk … or waive (permission)".
 *
 * Both paths recompute `fine_paid` through the engine rather than
 * assigning it, and the database CHECK recomputes it again — if the two
 * ever disagree the write is refused rather than silently stored (the
 * M16 `deriveStatus` rule, made structural).
 *
 * The two operations are deliberately separate services-level actions
 * behind **different permission codes**, because they are different
 * decisions made by different people: `library.fine.collect` receipts
 * money, `library.fine.waive` decides it was never owed. The seeded
 * Librarian holds the first and not the second (the M16/M20/M21
 * separation-of-duties rule).
 */
@Injectable()
export class LibraryFinesService {
  constructor(
    private readonly issues: BookIssuesRepository,
    private readonly circulation: CirculationService,
    private readonly directory: LibraryDirectoryRepository,
    private readonly posting: LibraryPostingService,
    private readonly config: LibrarySettingsService,
    private readonly audit: AuditContextService,
  ) {}

  async collect(id: string, dto: CollectFineDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const issue = await this.circulation.detail(id, actor.schoolId);

    const owed = outstandingFine({
      fineAmount: Number(issue.fineAmount),
      fineCollected: Number(issue.fineCollected),
      fineWaived: Number(issue.fineWaived),
    });
    if (owed <= 0) {
      throw new ConflictException('There is nothing outstanding on this loan');
    }

    const amount = money(dto.amount ?? owed);
    if (amount <= 0) {
      throw new BadRequestException('A collection must be more than zero');
    }
    // Over-collecting would break `chk_book_issues_fine_amounts` at the
    // database; catching it here turns a 500 into a sentence.
    if (amount > owed + 0.009) {
      throw new BadRequestException(
        `Only ${owed.toFixed(2)} BDT is outstanding on this loan`,
      );
    }

    const now = new Date();
    const collected = money(Number(issue.fineCollected) + amount);
    await this.issues.update(id, {
      fineCollected: collected,
      fineCollectedAt: now,
      finePaid: isFineSettled({
        fineAmount: Number(issue.fineAmount),
        fineCollected: collected,
        fineWaived: Number(issue.fineWaived),
      }),
      remarks: dto.remarks?.trim() || issue.remarks,
      updatedBy: actor.sub,
    });

    // The ledger posting comes after the money is recorded, and its
    // failure is swallowed — see `LibraryPostingService`.
    let voucherId: string | null = issue.fineVoucherId;
    if (cfg.autoPostAccounting && voucherId === null) {
      const person = await this.directory.lookup(
        actor.schoolId,
        issue.member.personType,
        issue.member.personId,
      );
      voucherId = await this.posting.postFineReceipt({
        schoolId: actor.schoolId,
        issueId: id,
        // The whole assessed fine is the income event, not the
        // instalment — see the service doc for why the ref is per loan.
        amount: Number(issue.fineAmount) - Number(issue.fineWaived),
        reason: issue.fineReason,
        bookTitle: issue.copy.book.title,
        accessionNo: issue.copy.accessionNo,
        memberName: person?.name ?? 'Library member',
        cardNo: issue.member.cardNo,
        date: now,
        actorId: actor.sub,
      });
      if (voucherId) {
        await this.issues.update(id, { fineVoucherId: voucherId });
      }
    }

    this.audit.set({
      entityType: 'BookIssue',
      entityId: id,
      oldValues: { fineCollected: Number(issue.fineCollected) },
      newValues: { fineCollected: collected, amount, voucherId },
    });

    return {
      issue: await this.circulation.detail(id, actor.schoolId),
      collected: amount,
      outstanding: money(owed - amount),
      voucherId,
    };
  }

  async waive(id: string, dto: WaiveFineDto, actor: AccessTokenPayload) {
    const issue = await this.circulation.detail(id, actor.schoolId);

    const owed = outstandingFine({
      fineAmount: Number(issue.fineAmount),
      fineCollected: Number(issue.fineCollected),
      fineWaived: Number(issue.fineWaived),
    });
    if (owed <= 0) {
      throw new ConflictException('There is nothing outstanding on this loan');
    }

    const amount = money(dto.amount ?? owed);
    if (amount <= 0) {
      throw new BadRequestException('A waiver must be more than zero');
    }
    if (amount > owed + 0.009) {
      throw new BadRequestException(
        `Only ${owed.toFixed(2)} BDT is outstanding on this loan`,
      );
    }

    const waived = money(Number(issue.fineWaived) + amount);
    await this.issues.update(id, {
      fineWaived: waived,
      fineWaivedBy: actor.sub,
      fineWaiveReason: dto.reason.trim(),
      finePaid: isFineSettled({
        fineAmount: Number(issue.fineAmount),
        fineCollected: Number(issue.fineCollected),
        fineWaived: waived,
      }),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'BookIssue',
      entityId: id,
      oldValues: { fineWaived: Number(issue.fineWaived) },
      newValues: { fineWaived: waived, amount, reason: dto.reason },
    });

    return {
      issue: await this.circulation.detail(id, actor.schoolId),
      waived: amount,
      outstanding: money(owed - amount),
    };
  }

  /** Every loan with money still owed — the desk's "dues" list. */
  async outstanding(schoolId: string, page: number, limit: number) {
    const { rows, total } = await this.issues.findMany(
      schoolId,
      { unpaidFineOnly: true },
      page,
      limit,
    );
    return {
      rows: rows.map((row) => ({
        ...row,
        outstanding: outstandingFine({
          fineAmount: Number(row.fineAmount),
          fineCollected: Number(row.fineCollected),
          fineWaived: Number(row.fineWaived),
        }),
      })),
      total,
      page,
      limit,
    };
  }
}
