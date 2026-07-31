import { Injectable } from '@nestjs/common';
import {
  BookIssue,
  BookReservation,
  BookReservationStatus,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const ISSUE_INCLUDE = {
  copy: {
    select: {
      id: true,
      accessionNo: true,
      status: true,
      book: {
        select: {
          id: true,
          title: true,
          titleBn: true,
          price: true,
          rackNo: true,
        },
      },
    },
  },
  member: {
    select: {
      id: true,
      cardNo: true,
      personType: true,
      personId: true,
      status: true,
      maxBooks: true,
    },
  },
} satisfies Prisma.BookIssueInclude;

export type IssueWithRelations = Prisma.BookIssueGetPayload<{
  include: typeof ISSUE_INCLUDE;
}>;

export interface IssueFilter {
  memberId?: string;
  copyId?: string;
  bookId?: string;
  /** Only loans still out. */
  openOnly?: boolean;
  /** Only loans still out and past their due date. */
  overdueOnly?: boolean;
  /** Only loans with money still owed on them. */
  unpaidFineOnly?: boolean;
  issuedFrom?: Date;
  issuedTo?: Date;
}

@Injectable()
export class BookIssuesRepository extends BaseRepository<
  BookIssue,
  Prisma.BookIssueWhereInput,
  Prisma.BookIssueUncheckedCreateInput,
  Prisma.BookIssueUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    // No `deleted_at` on this table — a loan is history (see the model
    // doc), so the base class must not add a soft-delete predicate that
    // would reference a column which does not exist.
    super(prisma, (client) => client.bookIssue, 'BookIssue', {
      softDeletable: false,
    });
  }

  private whereFor(
    schoolId: string,
    filter: IssueFilter,
    now: Date,
  ): Prisma.BookIssueWhereInput {
    return {
      schoolId,
      ...(filter.memberId ? { memberId: filter.memberId } : {}),
      ...(filter.copyId ? { copyId: filter.copyId } : {}),
      ...(filter.bookId ? { copy: { bookId: filter.bookId } } : {}),
      ...(filter.openOnly || filter.overdueOnly ? { returnedAt: null } : {}),
      ...(filter.overdueOnly ? { dueAt: { lt: now } } : {}),
      ...(filter.unpaidFineOnly ? { finePaid: false } : {}),
      ...(filter.issuedFrom || filter.issuedTo
        ? {
            issuedAt: {
              ...(filter.issuedFrom ? { gte: filter.issuedFrom } : {}),
              ...(filter.issuedTo ? { lte: filter.issuedTo } : {}),
            },
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: IssueFilter,
    page: number,
    limit: number,
    now = new Date(),
  ): Promise<{ rows: IssueWithRelations[]; total: number }> {
    const where = this.whereFor(schoolId, filter, now);
    const [rows, total] = await Promise.all([
      this.prisma.bookIssue.findMany({
        where,
        include: ISSUE_INCLUDE,
        orderBy: [{ issuedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bookIssue.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(
    schoolId: string,
    filter: IssueFilter,
    now = new Date(),
  ): Promise<IssueWithRelations[]> {
    return this.prisma.bookIssue.findMany({
      where: this.whereFor(schoolId, filter, now),
      include: ISSUE_INCLUDE,
      orderBy: [{ dueAt: 'asc' }],
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<IssueWithRelations | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.bookIssue.findFirst({
      where: { id, schoolId },
      include: ISSUE_INCLUDE,
    });
  }

  /** The open loan on a copy, if there is one. */
  async findOpenForCopy(
    copyId: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<IssueWithRelations | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.bookIssue.findFirst({
      where: { copyId, schoolId, returnedAt: null },
      include: ISSUE_INCLUDE,
    });
  }

  /**
   * Overdue loans that have not been chased inside the repeat window —
   * the weekly job's work list. The `overdue_notified_at` predicate is
   * the idempotency (the M12 `absent_notified_at` pattern), and it is a
   * *window* rather than a null check because a book six weeks overdue
   * should be chased more than once.
   */
  async findOverdueToNotify(
    schoolId: string,
    now: Date,
    repeatBefore: Date,
  ): Promise<IssueWithRelations[]> {
    return this.prisma.bookIssue.findMany({
      where: {
        schoolId,
        returnedAt: null,
        dueAt: { lt: now },
        OR: [
          { overdueNotifiedAt: null },
          { overdueNotifiedAt: { lt: repeatBefore } },
        ],
      },
      include: ISSUE_INCLUDE,
      orderBy: { dueAt: 'asc' },
    });
  }

  async markNotified(
    id: string,
    at: Date,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.bookIssue.update({
      where: { id },
      data: { overdueNotifiedAt: at },
    });
  }

  /** Roadmap §4's "daily/period collection" equivalent for fines. */
  async fineTotals(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<{ assessed: number; collected: number; waived: number }> {
    const rows = await this.prisma.bookIssue.aggregate({
      where: { schoolId, updatedAt: { gte: from, lte: to } },
      _sum: { fineAmount: true, fineCollected: true, fineWaived: true },
    });
    return {
      assessed: Number(rows._sum.fineAmount ?? 0),
      collected: Number(rows._sum.fineCollected ?? 0),
      waived: Number(rows._sum.fineWaived ?? 0),
    };
  }

  /** Loans out and money owed per member — the clearance query. */
  async standingForMembers(
    memberIds: string[],
  ): Promise<Map<string, { booksOut: number; outstandingFine: number }>> {
    const out = new Map<
      string,
      { booksOut: number; outstandingFine: number }
    >();
    if (memberIds.length === 0) return out;

    const rows = await this.prisma.bookIssue.findMany({
      where: {
        memberId: { in: memberIds },
        OR: [{ returnedAt: null }, { finePaid: false }],
      },
      select: {
        memberId: true,
        returnedAt: true,
        fineAmount: true,
        fineCollected: true,
        fineWaived: true,
        finePaid: true,
      },
    });

    for (const id of memberIds)
      out.set(id, { booksOut: 0, outstandingFine: 0 });
    for (const row of rows) {
      const entry = out.get(row.memberId);
      if (!entry) continue;
      if (row.returnedAt === null) entry.booksOut++;
      if (!row.finePaid) {
        entry.outstandingFine += Math.max(
          0,
          Number(row.fineAmount) -
            Number(row.fineCollected) -
            Number(row.fineWaived),
        );
      }
    }
    for (const entry of out.values()) {
      entry.outstandingFine = Math.round(entry.outstandingFine * 100) / 100;
    }
    return out;
  }
}

const RESERVATION_INCLUDE = {
  book: { select: { id: true, title: true, titleBn: true } },
  member: {
    select: { id: true, cardNo: true, personType: true, personId: true },
  },
} satisfies Prisma.BookReservationInclude;

export type ReservationWithRelations = Prisma.BookReservationGetPayload<{
  include: typeof RESERVATION_INCLUDE;
}>;

@Injectable()
export class BookReservationsRepository extends BaseRepository<
  BookReservation,
  Prisma.BookReservationWhereInput,
  Prisma.BookReservationUncheckedCreateInput,
  Prisma.BookReservationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.bookReservation, 'BookReservation', {
      softDeletable: false,
    });
  }

  async findMany(
    schoolId: string,
    filter: {
      bookId?: string;
      memberId?: string;
      status?: BookReservationStatus;
      liveOnly?: boolean;
    },
    page: number,
    limit: number,
  ): Promise<{ rows: ReservationWithRelations[]; total: number }> {
    const where: Prisma.BookReservationWhereInput = {
      schoolId,
      ...(filter.bookId ? { bookId: filter.bookId } : {}),
      ...(filter.memberId ? { memberId: filter.memberId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.liveOnly
        ? {
            status: {
              in: [BookReservationStatus.ACTIVE, BookReservationStatus.READY],
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.bookReservation.findMany({
        where,
        include: RESERVATION_INCLUDE,
        orderBy: [{ reservedAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bookReservation.count({ where }),
    ]);
    return { rows, total };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<ReservationWithRelations | null> {
    return this.prisma.bookReservation.findFirst({
      where: { id, schoolId },
      include: RESERVATION_INCLUDE,
    });
  }

  /** The queue for a title, oldest first — `reserved_at` IS the rank. */
  async queueFor(
    bookId: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<BookReservation[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.bookReservation.findMany({
      where: {
        bookId,
        schoolId,
        status: {
          in: [BookReservationStatus.ACTIVE, BookReservationStatus.READY],
        },
      },
      orderBy: { reservedAt: 'asc' },
    });
  }

  async countLiveForBookExcluding(
    bookId: string,
    schoolId: string,
    memberId: string,
  ): Promise<number> {
    return this.prisma.bookReservation.count({
      where: {
        bookId,
        schoolId,
        memberId: { not: memberId },
        status: {
          in: [BookReservationStatus.ACTIVE, BookReservationStatus.READY],
        },
      },
    });
  }

  async findLiveFor(
    bookId: string,
    memberId: string,
    schoolId: string,
  ): Promise<BookReservation | null> {
    return this.prisma.bookReservation.findFirst({
      where: {
        bookId,
        memberId,
        schoolId,
        status: {
          in: [BookReservationStatus.ACTIVE, BookReservationStatus.READY],
        },
      },
    });
  }

  /** READY holds whose window has closed — the expiry sweep's work list. */
  async findLapsed(
    schoolId: string,
    now: Date,
  ): Promise<ReservationWithRelations[]> {
    return this.prisma.bookReservation.findMany({
      where: {
        schoolId,
        status: BookReservationStatus.READY,
        expiresAt: { lt: now },
      },
      include: RESERVATION_INCLUDE,
    });
  }

  /** READY holds nobody has been told about yet. */
  async findUnnotified(schoolId: string): Promise<ReservationWithRelations[]> {
    return this.prisma.bookReservation.findMany({
      where: {
        schoolId,
        status: BookReservationStatus.READY,
        notifiedAt: null,
      },
      include: RESERVATION_INCLUDE,
    });
  }

  async findHeldCopy(
    copyId: string,
    tx?: PrismaClientLike,
  ): Promise<BookReservation | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.bookReservation.findFirst({
      where: { heldCopyId: copyId, status: BookReservationStatus.READY },
    });
  }
}
