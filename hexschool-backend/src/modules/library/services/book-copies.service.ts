import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookCopy, BookCopyStatus, LibraryFineReason } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { money } from '../../fee/calc/money.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import { normalizeScannedCode } from '../calc/barcode.util';
import {
  isFineSettled,
  replacementCharge,
  totalCharge,
} from '../calc/fine.engine';
import type {
  CopyQueryDto,
  GenerateCopiesDto,
  MarkCopyDto,
  UpdateCopyDto,
} from '../dto';
import { LIBRARY_SEQUENCES } from '../library.constants';
import {
  BookCopiesRepository,
  type CopyWithBook,
} from '../repositories/book-copies.repository';
import { BooksRepository } from '../repositories/catalog.repository';
import { BookIssuesRepository } from '../repositories/circulation.repository';
import { LibrarySettingsService } from './library-settings.service';

/** The statuses `mark()` may move a copy into. */
const WRITE_OFF: ReadonlySet<BookCopyStatus> = new Set([
  BookCopyStatus.LOST,
  BookCopyStatus.DAMAGED,
  BookCopyStatus.WITHDRAWN,
]);

@Injectable()
export class BookCopiesService {
  constructor(
    private readonly copies: BookCopiesRepository,
    private readonly books: BooksRepository,
    private readonly issues: BookIssuesRepository,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly config: LibrarySettingsService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: CopyQueryDto, actor: AccessTokenPayload) {
    const { page, limit } = query;
    const { rows, total } = await this.copies.findMany(
      actor.schoolId,
      {
        bookId: query.bookId,
        status: query.status,
        rackNo: query.rackNo,
        search: query.search,
      },
      page,
      limit,
    );
    return { rows, total, page, limit };
  }

  async getDetail(id: string, schoolId: string): Promise<CopyWithBook> {
    const copy = await this.copies.findDetail(id, schoolId);
    if (!copy) throw new NotFoundException(`Copy ${id} not found`);
    return copy;
  }

  /** The desk's scan lookup, with the current loan if there is one. */
  async byAccession(raw: string, schoolId: string) {
    const accessionNo = normalizeScannedCode(raw);
    const copy = await this.copies.findByAccession(schoolId, accessionNo);
    if (!copy) {
      throw new NotFoundException(
        `No copy with accession number "${accessionNo}"`,
      );
    }
    const openIssue = await this.issues.findOpenForCopy(copy.id, schoolId);
    return { copy, openIssue };
  }

  /**
   * Roadmap §4's "bulk copy generation (N copies → sequential accession
   * numbers)".
   *
   * Every number is claimed through `SequenceService` **inside the same
   * transaction as the copy row**, which is what makes the sequence
   * gap-free: a failure halfway through rolls the claimed numbers back
   * with the copies, and a concurrent call in another request cannot
   * take the same one (the M07 row-locking upsert).
   */
  async generate(
    bookId: string,
    dto: GenerateCopiesDto,
    actor: AccessTokenPayload,
  ): Promise<BookCopy[]> {
    const cfg = await this.config.load(actor.schoolId);
    this.assertEnabled(cfg.enabled);

    const book = await this.books.findByIdOrFail(bookId, actor.schoolId);
    const school = await this.schools.findByIdOrFail(actor.schoolId);
    const now = new Date();
    const year = String(now.getUTCFullYear()).slice(2);

    const created = await this.copies.withTransaction(async (tx) => {
      const rows: BookCopy[] = [];
      for (let i = 0; i < dto.count; i++) {
        const accessionNo = await this.sequences.nextDocumentNumber({
          schoolId: actor.schoolId,
          counterKey: LIBRARY_SEQUENCES.accession(year),
          pattern: cfg.accessionPattern,
          schoolCode: school.code,
          date: now,
          tx,
        });
        rows.push(
          await this.copies.create(
            {
              schoolId: actor.schoolId,
              bookId,
              accessionNo,
              status: BookCopyStatus.AVAILABLE,
              condition: dto.condition ?? 'NEW',
              purchasePrice: dto.purchasePrice ?? null,
              createdBy: actor.sub,
              updatedBy: actor.sub,
            },
            tx,
          ),
        );
      }
      return rows;
    });

    this.audit.set({
      entityType: 'BookCopy',
      entityId: created[0]?.id ?? bookId,
      newValues: {
        book: book.title,
        count: created.length,
        from: created[0]?.accessionNo,
        to: created.at(-1)?.accessionNo,
      },
    });
    return created;
  }

  async update(id: string, dto: UpdateCopyDto, actor: AccessTokenPayload) {
    const existing = await this.getDetail(id, actor.schoolId);
    await this.copies.update(id, {
      ...(dto.condition ? { condition: dto.condition } : {}),
      ...(dto.conditionNote !== undefined
        ? { conditionNote: dto.conditionNote?.trim() || null }
        : {}),
      ...(dto.purchasePrice !== undefined
        ? { purchasePrice: dto.purchasePrice ?? null }
        : {}),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'BookCopy',
      entityId: id,
      oldValues: { condition: existing.condition },
      newValues: { condition: dto.condition },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /**
   * Roadmap §4's "mark lost/damaged".
   *
   * The interesting case is a copy that is **on loan** when it is
   * written off, which is the normal way a book is declared lost: the
   * member reports it, and the charge belongs to them. So the open loan
   * is closed in the same transaction, with the replacement charge
   * assessed against it — leaving the loan un-closed would keep the
   * member's `openLoans` count occupied by a book that no longer exists
   * and would block them from borrowing forever.
   */
  async mark(id: string, dto: MarkCopyDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const copy = await this.getDetail(id, actor.schoolId);

    if (!WRITE_OFF.has(dto.status)) {
      throw new BadRequestException(
        'A copy may only be marked LOST, DAMAGED or WITHDRAWN here — use the return desk to bring it back into circulation',
      );
    }
    if (copy.status === dto.status) {
      throw new ConflictException(`This copy is already ${dto.status}`);
    }
    if (
      dto.status === BookCopyStatus.WITHDRAWN &&
      copy.status === BookCopyStatus.ISSUED
    ) {
      throw new ConflictException(
        'This copy is on loan — it cannot be withdrawn from stock until it comes back or is written off as lost',
      );
    }

    const kind = dto.status === BookCopyStatus.DAMAGED ? 'DAMAGED' : 'LOST';
    const computed =
      dto.status === BookCopyStatus.WITHDRAWN
        ? 0
        : replacementCharge(
            copy.book.price === null ? null : Number(copy.book.price),
            cfg.fine,
            kind,
          );
    const charge = money(dto.fineAmount ?? computed);

    const result = await this.copies.withTransaction(async (tx) => {
      await this.copies.update(
        id,
        {
          status: dto.status,
          condition:
            dto.status === BookCopyStatus.WITHDRAWN ? undefined : 'DAMAGED',
          conditionNote: dto.reason.trim(),
          updatedBy: actor.sub,
        },
        tx,
      );

      const open = await this.issues.findOpenForCopy(id, actor.schoolId, tx);
      if (!open) return { chargedTo: null as string | null, charge: 0 };

      // The overdue that had already accrued still counts — a book kept
      // for two months and then reported lost owes for the delay as well
      // as for the book.
      const overdue = Number(open.fineAmount);
      const combined = totalCharge(overdue, charge);
      const settled = isFineSettled({
        fineAmount: combined.amount,
        fineCollected: Number(open.fineCollected),
        fineWaived: Number(open.fineWaived),
      });

      await this.issues.update(
        open.id,
        {
          returnedAt: new Date(),
          returnedTo: actor.sub,
          returnCondition: 'DAMAGED',
          fineAmount: combined.amount,
          fineReason:
            dto.status === BookCopyStatus.DAMAGED
              ? LibraryFineReason.DAMAGED
              : LibraryFineReason.LOST,
          finePaid: settled,
          remarks: dto.reason.trim(),
          updatedBy: actor.sub,
        },
        tx,
      );
      return { chargedTo: open.memberId, charge: combined.amount };
    });

    this.audit.set({
      entityType: 'BookCopy',
      entityId: id,
      oldValues: { status: copy.status },
      newValues: {
        status: dto.status,
        reason: dto.reason,
        charge: result.charge,
      },
    });

    return {
      copy: await this.getDetail(id, actor.schoolId),
      chargedMemberId: result.chargedTo,
      charge: result.charge,
    };
  }

  /**
   * Deleting a copy is for a cataloguing mistake made minutes ago, not
   * for a book that has left the building — a copy that has ever been
   * on loan is part of somebody's borrowing history, and the FK from
   * `book_issues` is RESTRICT. `WITHDRAWN` is the retirement path.
   */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const copy = await this.getDetail(id, actor.schoolId);
    const everIssued = await this.copies.countIssuesEver(id);
    if (everIssued > 0) {
      throw new ConflictException(
        `Copy ${copy.accessionNo} has been on loan ${everIssued} time(s) — mark it WITHDRAWN instead of deleting its history`,
      );
    }
    await this.copies.softDelete(id);
    this.audit.set({
      entityType: 'BookCopy',
      entityId: id,
      oldValues: { accessionNo: copy.accessionNo },
    });
  }

  async statusTotals(schoolId: string) {
    return this.copies.statusTotals(schoolId);
  }

  private assertEnabled(enabled: boolean): void {
    if (!enabled) {
      throw new ConflictException(
        'The library is switched off for this school (library.enabled)',
      );
    }
  }
}
