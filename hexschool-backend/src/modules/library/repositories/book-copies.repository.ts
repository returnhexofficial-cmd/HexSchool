import { Injectable } from '@nestjs/common';
import { BookCopy, BookCopyStatus, Prisma } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const COPY_INCLUDE = {
  book: {
    select: {
      id: true,
      title: true,
      titleBn: true,
      isbn: true,
      price: true,
      rackNo: true,
      edition: true,
      category: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.BookCopyInclude;

export type CopyWithBook = Prisma.BookCopyGetPayload<{
  include: typeof COPY_INCLUDE;
}>;

export interface CopyFilter {
  bookId?: string;
  status?: BookCopyStatus;
  rackNo?: string;
  search?: string;
}

@Injectable()
export class BookCopiesRepository extends BaseRepository<
  BookCopy,
  Prisma.BookCopyWhereInput,
  Prisma.BookCopyUncheckedCreateInput,
  Prisma.BookCopyUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.bookCopy, 'BookCopy');
  }

  private whereFor(
    schoolId: string,
    filter: CopyFilter,
  ): Prisma.BookCopyWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.bookId ? { bookId: filter.bookId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.rackNo ? { book: { rackNo: filter.rackNo } } : {}),
      ...(filter.search
        ? { accessionNo: { contains: filter.search, mode: 'insensitive' } }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: CopyFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: CopyWithBook[]; total: number }> {
    const where = this.whereFor(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.bookCopy.findMany({
        where,
        include: COPY_INCLUDE,
        orderBy: [{ accessionNo: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bookCopy.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(
    schoolId: string,
    filter: CopyFilter,
  ): Promise<CopyWithBook[]> {
    return this.prisma.bookCopy.findMany({
      where: this.whereFor(schoolId, filter),
      include: COPY_INCLUDE,
      orderBy: [{ accessionNo: 'asc' }],
    });
  }

  async findDetail(id: string, schoolId: string): Promise<CopyWithBook | null> {
    return this.prisma.bookCopy.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: COPY_INCLUDE,
    });
  }

  /**
   * The circulation desk's lookup: a scanned accession number → the
   * copy. Case-insensitive because a scanner and a keyboard disagree
   * about case more often than anybody expects, and the caller has
   * already run `normalizeScannedCode`.
   */
  async findByAccession(
    schoolId: string,
    accessionNo: string,
  ): Promise<CopyWithBook | null> {
    return this.prisma.bookCopy.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        accessionNo: { equals: accessionNo, mode: 'insensitive' },
      },
      include: COPY_INCLUDE,
    });
  }

  /** Every live accession number, for the stock-take diff. */
  async shelfList(schoolId: string): Promise<
    Array<{
      id: string;
      accessionNo: string;
      status: BookCopyStatus;
      bookTitle: string;
      rackNo: string | null;
    }>
  > {
    const rows = await this.prisma.bookCopy.findMany({
      where: { schoolId, deletedAt: null },
      select: {
        id: true,
        accessionNo: true,
        status: true,
        book: { select: { title: true, rackNo: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      accessionNo: row.accessionNo,
      status: row.status,
      bookTitle: row.book.title,
      rackNo: row.book.rackNo,
    }));
  }

  async setStatus(
    id: string,
    status: BookCopyStatus,
    actorId: string,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.bookCopy.update({
      where: { id },
      data: { status, updatedBy: actorId },
    });
  }

  /**
   * The next available copy of a title, for fulfilling a hold. Oldest
   * accession first so the shelf rotates rather than one copy taking
   * every loan and wearing out while its siblings sit untouched.
   */
  async firstAvailable(
    schoolId: string,
    bookId: string,
    tx?: PrismaClientLike,
  ): Promise<BookCopy | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.bookCopy.findFirst({
      where: {
        schoolId,
        bookId,
        deletedAt: null,
        status: BookCopyStatus.AVAILABLE,
      },
      orderBy: { accessionNo: 'asc' },
    });
  }

  async countOpenIssues(copyId: string): Promise<number> {
    return this.prisma.bookIssue.count({
      where: { copyId, returnedAt: null },
    });
  }

  async countIssuesEver(copyId: string): Promise<number> {
    return this.prisma.bookIssue.count({ where: { copyId } });
  }

  /** Highest accession suffix in use — the bulk generator's preview. */
  async statusTotals(
    schoolId: string,
  ): Promise<Record<BookCopyStatus, number>> {
    const rows = await this.prisma.bookCopy.groupBy({
      by: ['status'],
      where: { schoolId, deletedAt: null },
      _count: { _all: true },
    });
    const out = {
      AVAILABLE: 0,
      ISSUED: 0,
      RESERVED: 0,
      LOST: 0,
      DAMAGED: 0,
      WITHDRAWN: 0,
    } as Record<BookCopyStatus, number>;
    for (const row of rows) out[row.status] = row._count._all;
    return out;
  }
}
