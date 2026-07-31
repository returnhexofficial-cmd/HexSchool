import { Injectable } from '@nestjs/common';
import {
  LibraryMember,
  LibraryMemberStatus,
  LibraryMemberType,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface MemberFilter {
  personType?: LibraryMemberType;
  status?: LibraryMemberStatus;
  personIds?: string[];
  search?: string;
}

/** What a member currently owes and holds — one query, not N. */
export interface MemberStanding {
  openLoans: number;
  overdueLoans: number;
  outstandingFine: number;
  heldBookIds: Set<string>;
}

@Injectable()
export class LibraryMembersRepository extends BaseRepository<
  LibraryMember,
  Prisma.LibraryMemberWhereInput,
  Prisma.LibraryMemberUncheckedCreateInput,
  Prisma.LibraryMemberUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.libraryMember, 'LibraryMember');
  }

  async findMany(
    schoolId: string,
    filter: MemberFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: LibraryMember[]; total: number }> {
    const where: Prisma.LibraryMemberWhereInput = {
      schoolId,
      deletedAt: null,
      ...(filter.personType ? { personType: filter.personType } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.personIds ? { personId: { in: filter.personIds } } : {}),
      ...(filter.search
        ? { cardNo: { contains: filter.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.libraryMember.findMany({
        where,
        orderBy: [{ cardNo: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.libraryMember.count({ where }),
    ]);
    return { rows, total };
  }

  async findByPerson(
    schoolId: string,
    personType: LibraryMemberType,
    personId: string,
    tx?: PrismaClientLike,
  ): Promise<LibraryMember | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.libraryMember.findFirst({
      where: { schoolId, personType, personId, deletedAt: null },
    });
  }

  async findByCard(
    schoolId: string,
    cardNo: string,
  ): Promise<LibraryMember | null> {
    return this.prisma.libraryMember.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        cardNo: { equals: cardNo, mode: 'insensitive' },
      },
    });
  }

  /**
   * Everything the issue policy needs about a member, in one round trip.
   *
   * Note what the fine total spans: **every** loan, returned or not. A
   * member who returned a book late three months ago and never paid is
   * still carrying that debt, and the block exists precisely for them —
   * counting only open loans would let a habitual defaulter clear the
   * check by handing everything back.
   */
  async standing(
    memberId: string,
    now: Date,
    tx?: PrismaClientLike,
  ): Promise<MemberStanding> {
    const client = (tx ?? this.prisma) as PrismaService;
    const [open, fines] = await Promise.all([
      client.bookIssue.findMany({
        where: { memberId, returnedAt: null },
        select: { dueAt: true, copy: { select: { bookId: true } } },
      }),
      client.bookIssue.findMany({
        where: { memberId, finePaid: false },
        select: { fineAmount: true, fineCollected: true, fineWaived: true },
      }),
    ]);

    const outstandingFine = fines.reduce(
      (sum, row) =>
        sum +
        Math.max(
          0,
          Number(row.fineAmount) -
            Number(row.fineCollected) -
            Number(row.fineWaived),
        ),
      0,
    );

    return {
      openLoans: open.length,
      overdueLoans: open.filter((i) => i.dueAt.getTime() < now.getTime())
        .length,
      outstandingFine: Math.round(outstandingFine * 100) / 100,
      heldBookIds: new Set(open.map((i) => i.copy.bookId)),
    };
  }

  /** Standing for a whole page of members, for the members list. */
  async standings(
    memberIds: string[],
    now: Date,
  ): Promise<Map<string, MemberStanding>> {
    const out = new Map<string, MemberStanding>();
    if (memberIds.length === 0) return out;

    const [open, fines] = await Promise.all([
      this.prisma.bookIssue.findMany({
        where: { memberId: { in: memberIds }, returnedAt: null },
        select: {
          memberId: true,
          dueAt: true,
          copy: { select: { bookId: true } },
        },
      }),
      this.prisma.bookIssue.findMany({
        where: { memberId: { in: memberIds }, finePaid: false },
        select: {
          memberId: true,
          fineAmount: true,
          fineCollected: true,
          fineWaived: true,
        },
      }),
    ]);

    for (const id of memberIds) {
      out.set(id, {
        openLoans: 0,
        overdueLoans: 0,
        outstandingFine: 0,
        heldBookIds: new Set(),
      });
    }
    for (const row of open) {
      const entry = out.get(row.memberId);
      if (!entry) continue;
      entry.openLoans++;
      if (row.dueAt.getTime() < now.getTime()) entry.overdueLoans++;
      entry.heldBookIds.add(row.copy.bookId);
    }
    for (const row of fines) {
      const entry = out.get(row.memberId);
      if (!entry) continue;
      entry.outstandingFine += Math.max(
        0,
        Number(row.fineAmount) -
          Number(row.fineCollected) -
          Number(row.fineWaived),
      );
    }
    for (const entry of out.values()) {
      entry.outstandingFine = Math.round(entry.outstandingFine * 100) / 100;
    }
    return out;
  }
}
