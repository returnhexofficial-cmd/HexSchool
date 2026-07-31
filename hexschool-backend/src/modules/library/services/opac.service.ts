import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LibraryMember, LibraryMemberStatus } from '@prisma/client';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { canRenew } from '../calc/circulation.engine';
import { outstandingFine } from '../calc/fine.engine';
import type { CreateReservationDto, OpacQueryDto } from '../dto';
import { BooksRepository } from '../repositories/catalog.repository';
import {
  BookIssuesRepository,
  BookReservationsRepository,
} from '../repositories/circulation.repository';
import { LibraryDirectoryRepository } from '../repositories/library-directory.repository';
import { LibraryMembersRepository } from '../repositories/library-members.repository';
import { CatalogService } from './catalog.service';
import { LibrarySettingsService } from './library-settings.service';
import { ReservationsService } from './reservations.service';

/**
 * The OPAC — roadmap §5's "search page in student/teacher portal:
 * availability badge, my-issues list with due dates".
 *
 * This is the module's portal-facing surface, and M18's PortalModule
 * mounts it at `/portal/library` the way it mounts M22's assignments.
 * The split is the usual one: **this service decides what a library
 * member may see and do; PortalModule answers only "which person is this
 * account?"**.
 *
 * Two deliberate shapes:
 *
 *   - A portal caller with **no library card** gets an empty,
 *     self-describing answer rather than a 404. Most of a school has
 *     never borrowed anything, and "you have no loans" is the true
 *     answer to "what have I got out?" (the M09 self-describing-stub
 *     pattern).
 *   - The catalogue search is the **same repository query** the admin
 *     catalogue uses, but the projection is narrower: no purchase price,
 *     no per-copy accession numbers, no rack for a title with nothing
 *     available. A reader needs to know whether they can have the book,
 *     not what the school paid for it (the M19 "the SELECT list is the
 *     privacy policy" rule).
 */
@Injectable()
export class OpacService {
  constructor(
    private readonly books: BooksRepository,
    private readonly catalog: CatalogService,
    private readonly issues: BookIssuesRepository,
    private readonly reservations: BookReservationsRepository,
    private readonly reservationsService: ReservationsService,
    private readonly members: LibraryMembersRepository,
    private readonly directory: LibraryDirectoryRepository,
    private readonly config: LibrarySettingsService,
  ) {}

  async search(query: OpacQueryDto, schoolId: string) {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.opacEnabled) {
      return {
        available: false,
        reason: 'The library catalogue is not published to the portal',
        rows: [],
        total: 0,
        page: query.page,
        limit: query.limit,
      };
    }

    const { page, limit } = query;
    const { rows, total } = await this.books.findMany(
      schoolId,
      {
        categoryId: query.categoryId,
        search: query.search,
        availableOnly: query.availableOnly,
      },
      page,
      limit,
    );
    const withCounts = await this.catalog.withCopyCounts(rows);

    return {
      available: true,
      reason: null,
      rows: withCounts.map((book) => ({
        id: book.id,
        title: book.title,
        titleBn: book.titleBn,
        isbn: book.isbn,
        edition: book.edition,
        language: book.language,
        coverUrl: book.coverUrl,
        category: book.category,
        publisher: book.publisher,
        authors: book.authors.map((a) => a.author),
        copies: book.copies,
        // Only tell a reader where to look when there is something to
        // find — a rack number for a title with nothing on the shelf
        // sends them across the library for nothing.
        rackNo: book.copies.available > 0 ? book.rackNo : null,
      })),
      total,
      page,
      limit,
    };
  }

  /** "What have I got out?" — loans, holds and what is owed. */
  async myLibrary(schoolId: string, userId: string) {
    const cfg = await this.config.load(schoolId);
    const member = await this.memberForUser(schoolId, userId);

    if (!member) {
      return {
        member: null,
        loans: [],
        reservations: [],
        summary: {
          onLoan: 0,
          overdue: 0,
          outstandingFine: 0,
          maxBooks: 0,
        },
        opacEnabled: cfg.enabled && cfg.opacEnabled,
        canReserve: false,
      };
    }

    const now = new Date();
    const [loans, holds, standing] = await Promise.all([
      this.issues.findAllFor(schoolId, { memberId: member.id }, now),
      this.reservations.findMany(
        schoolId,
        { memberId: member.id, liveOnly: true },
        1,
        50,
      ),
      this.members.standing(member.id, now),
    ]);

    const open = loans.filter((l) => l.returnedAt === null);

    return {
      member: {
        id: member.id,
        cardNo: member.cardNo,
        status: member.status,
        maxBooks: member.maxBooks,
      },
      loans: open.map((row) => {
        const verdict = canRenew(
          {
            returnedAt: row.returnedAt,
            dueAt: row.dueAt,
            renewCount: row.renewCount,
            memberStatus: member.status,
            reservationsByOthers: 0,
          },
          cfg.maxRenews,
          now,
          cfg.enabled,
        );
        return {
          issueId: row.id,
          title: row.copy.book.title,
          accessionNo: row.copy.accessionNo,
          issuedAt: row.issuedAt,
          dueAt: row.dueAt,
          renewCount: row.renewCount,
          overdue: row.dueAt.getTime() < now.getTime(),
          outstandingFine: outstandingFine({
            fineAmount: Number(row.fineAmount),
            fineCollected: Number(row.fineCollected),
            fineWaived: Number(row.fineWaived),
          }),
          // The portal shows why a renewal is unavailable in the same
          // words the desk would use — one engine, one message.
          canRenew: verdict.allowed,
          renewBlockedReason: verdict.reason,
        };
      }),
      // History is the last twenty returned loans; the full list is on
      // the member's admin page, which is where a dispute is settled.
      history: loans
        .filter((l) => l.returnedAt !== null)
        .slice(0, 20)
        .map((row) => ({
          issueId: row.id,
          title: row.copy.book.title,
          issuedAt: row.issuedAt,
          returnedAt: row.returnedAt,
          fineAmount: Number(row.fineAmount),
        })),
      reservations: holds.rows.map((row) => ({
        id: row.id,
        bookId: row.bookId,
        title: row.book.title,
        status: row.status,
        reservedAt: row.reservedAt,
        readyAt: row.readyAt,
        expiresAt: row.expiresAt,
      })),
      summary: {
        onLoan: standing.openLoans,
        overdue: standing.overdueLoans,
        outstandingFine: standing.outstandingFine,
        maxBooks: member.maxBooks,
      },
      opacEnabled: cfg.enabled && cfg.opacEnabled,
      canReserve: cfg.opacAllowReservation,
    };
  }

  /** A reader placing their own hold. */
  async reserve(dto: CreateReservationDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    if (!cfg.opacAllowReservation) {
      throw new ConflictException(
        'Holds are placed at the library desk in this school',
      );
    }
    const member = await this.requireMember(actor.schoolId, actor.sub);
    return this.reservationsService.create(dto, member.id, actor);
  }

  async cancelReservation(id: string, actor: AccessTokenPayload) {
    const member = await this.requireMember(actor.schoolId, actor.sub);
    return this.reservationsService.cancel(id, actor, member.id);
  }

  /** The card behind a logged-in portal account, if there is one. */
  async memberForUser(
    schoolId: string,
    userId: string,
  ): Promise<LibraryMember | null> {
    const person = await this.directory.personForUser(schoolId, userId);
    if (!person) return null;
    return this.members.findByPerson(
      schoolId,
      person.personType,
      person.personId,
    );
  }

  /**
   * Used only by the write paths. A reader who has never borrowed has no
   * card, and "reserve" is not the moment to silently create one — the
   * desk enrols people, and a card generated by a stray tap would burn a
   * card number nobody ever collects.
   */
  private async requireMember(
    schoolId: string,
    userId: string,
  ): Promise<LibraryMember> {
    const member = await this.memberForUser(schoolId, userId);
    if (!member) {
      throw new NotFoundException(
        'You do not have a library card yet — ask at the library desk',
      );
    }
    if (member.status !== LibraryMemberStatus.ACTIVE) {
      throw new ConflictException(
        `Your library card is ${member.status.toLowerCase()} — please speak to the librarian`,
      );
    }
    return member;
  }

  /**
   * The parent's view of a child's library account. **Read-only by
   * construction** — this returns no renew verdict and no reserve path,
   * because the card belongs to the reader (the M22 rule that a parent
   * reads their child's work and never submits it).
   */
  async childLibrary(schoolId: string, studentId: string) {
    const member = await this.members.findByPerson(
      schoolId,
      'STUDENT',
      studentId,
    );
    if (!member) {
      return {
        member: null,
        loans: [],
        summary: { onLoan: 0, overdue: 0, outstandingFine: 0 },
      };
    }

    const now = new Date();
    const [loans, standing] = await Promise.all([
      this.issues.findAllFor(
        schoolId,
        { memberId: member.id, openOnly: true },
        now,
      ),
      this.members.standing(member.id, now),
    ]);

    return {
      member: { id: member.id, cardNo: member.cardNo, status: member.status },
      loans: loans.map((row) => ({
        issueId: row.id,
        title: row.copy.book.title,
        accessionNo: row.copy.accessionNo,
        issuedAt: row.issuedAt,
        dueAt: row.dueAt,
        overdue: row.dueAt.getTime() < now.getTime(),
        outstandingFine: outstandingFine({
          fineAmount: Number(row.fineAmount),
          fineCollected: Number(row.fineCollected),
          fineWaived: Number(row.fineWaived),
        }),
      })),
      summary: {
        onLoan: standing.openLoans,
        overdue: standing.overdueLoans,
        outstandingFine: standing.outstandingFine,
      },
    };
  }
}
