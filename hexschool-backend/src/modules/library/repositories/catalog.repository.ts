import { Injectable } from '@nestjs/common';
import { Author, Book, BookCategory, Prisma, Publisher } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The bibliographic side of Module 23: three masters and the title
 * record over them. Grouped in one file the way M20's
 * `payroll.repository.ts` groups the run and the PF ledger — they are
 * never used apart, and four one-method files would be four files.
 */

@Injectable()
export class BookCategoriesRepository extends BaseRepository<
  BookCategory,
  Prisma.BookCategoryWhereInput,
  Prisma.BookCategoryUncheckedCreateInput,
  Prisma.BookCategoryUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.bookCategory, 'BookCategory');
  }

  async findByName(
    schoolId: string,
    name: string,
  ): Promise<BookCategory | null> {
    return this.prisma.bookCategory.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
      },
    });
  }

  /** Books still hanging off a category — the delete guard's count. */
  async countBooks(categoryId: string): Promise<number> {
    return this.prisma.book.count({ where: { categoryId, deletedAt: null } });
  }
}

@Injectable()
export class AuthorsRepository extends BaseRepository<
  Author,
  Prisma.AuthorWhereInput,
  Prisma.AuthorUncheckedCreateInput,
  Prisma.AuthorUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.author, 'Author');
  }

  async findByName(schoolId: string, name: string): Promise<Author | null> {
    return this.prisma.author.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
      },
    });
  }

  async countBooks(authorId: string): Promise<number> {
    return this.prisma.bookAuthor.count({
      where: { authorId, book: { deletedAt: null } },
    });
  }

  /** Resolves a mixed list of ids and names, creating the names. */
  async ensureMany(
    schoolId: string,
    names: string[],
    actorId: string,
  ): Promise<Author[]> {
    const out: Author[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (name.length === 0) continue;
      const existing = await this.findByName(schoolId, name);
      out.push(
        existing ??
          (await this.create({
            schoolId,
            name,
            createdBy: actorId,
            updatedBy: actorId,
          })),
      );
    }
    return out;
  }
}

@Injectable()
export class PublishersRepository extends BaseRepository<
  Publisher,
  Prisma.PublisherWhereInput,
  Prisma.PublisherUncheckedCreateInput,
  Prisma.PublisherUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.publisher, 'Publisher');
  }

  async findByName(schoolId: string, name: string): Promise<Publisher | null> {
    return this.prisma.publisher.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
      },
    });
  }

  async countBooks(publisherId: string): Promise<number> {
    return this.prisma.book.count({ where: { publisherId, deletedAt: null } });
  }
}

const BOOK_INCLUDE = {
  category: { select: { id: true, name: true, nameBn: true } },
  publisher: { select: { id: true, name: true } },
  authors: {
    orderBy: { position: 'asc' },
    select: {
      position: true,
      author: { select: { id: true, name: true, nameBn: true } },
    },
  },
} satisfies Prisma.BookInclude;

export type BookWithRelations = Prisma.BookGetPayload<{
  include: typeof BOOK_INCLUDE;
}>;

export interface BookFilter {
  categoryId?: string;
  publisherId?: string;
  authorId?: string;
  language?: string;
  rackNo?: string;
  /** Title, ISBN or author — one box, the way a catalogue is searched. */
  search?: string;
  /** OPAC only: titles with at least one copy that could be borrowed. */
  availableOnly?: boolean;
}

@Injectable()
export class BooksRepository extends BaseRepository<
  Book,
  Prisma.BookWhereInput,
  Prisma.BookUncheckedCreateInput,
  Prisma.BookUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.book, 'Book');
  }

  private whereFor(
    schoolId: string,
    filter: BookFilter,
  ): Prisma.BookWhereInput {
    const search = filter.search?.trim();
    return {
      schoolId,
      deletedAt: null,
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter.publisherId ? { publisherId: filter.publisherId } : {}),
      ...(filter.language ? { language: filter.language } : {}),
      ...(filter.rackNo ? { rackNo: filter.rackNo } : {}),
      ...(filter.authorId
        ? { authors: { some: { authorId: filter.authorId } } }
        : {}),
      ...(filter.availableOnly
        ? { copies: { some: { deletedAt: null, status: 'AVAILABLE' } } }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { titleBn: { contains: search, mode: 'insensitive' } },
              // Searching "978-0-306" has to find "9780306…", so the
              // separators come out of the needle the same way
              // `parseIsbn` takes them out of the stored value.
              { isbn: { contains: search.replace(/[\s-]/g, '') } },
              {
                authors: {
                  some: {
                    author: {
                      name: { contains: search, mode: 'insensitive' },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: BookFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: BookWithRelations[]; total: number }> {
    const where = this.whereFor(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.book.findMany({
        where,
        include: BOOK_INCLUDE,
        orderBy: [{ title: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.book.count({ where }),
    ]);
    return { rows, total };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<BookWithRelations | null> {
    return this.prisma.book.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: BOOK_INCLUDE,
    });
  }

  /**
   * Copy counts per title, in one query rather than one per row — the
   * availability badge the catalogue list and the OPAC both render.
   */
  async copyCounts(
    bookIds: string[],
  ): Promise<Map<string, { total: number; available: number }>> {
    if (bookIds.length === 0) return new Map();
    const rows = await this.prisma.bookCopy.groupBy({
      by: ['bookId', 'status'],
      where: { bookId: { in: bookIds }, deletedAt: null },
      _count: { _all: true },
    });

    const out = new Map<string, { total: number; available: number }>();
    for (const row of rows) {
      const entry = out.get(row.bookId) ?? { total: 0, available: 0 };
      const count = row._count._all;
      // A LOST or WITHDRAWN copy is not stock (roadmap §6), so it counts
      // toward neither figure — a school's "we hold 40 copies" must not
      // include the twelve that went missing in 2019.
      if (
        row.status === 'LOST' ||
        row.status === 'DAMAGED' ||
        row.status === 'WITHDRAWN'
      ) {
        out.set(row.bookId, entry);
        continue;
      }
      entry.total += count;
      if (row.status === 'AVAILABLE') entry.available += count;
      out.set(row.bookId, entry);
    }
    return out;
  }

  /** Author links are replaced as a set — see the model doc. */
  async replaceAuthors(
    bookId: string,
    authorIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.bookAuthor.deleteMany({ where: { bookId } });
    if (authorIds.length === 0) return;
    await client.bookAuthor.createMany({
      data: authorIds.map((authorId, position) => ({
        bookId,
        authorId,
        position,
      })),
      skipDuplicates: true,
    });
  }

  async countCopies(bookId: string): Promise<number> {
    return this.prisma.bookCopy.count({ where: { bookId, deletedAt: null } });
  }

  /** Roadmap §4's "popular titles" — issue counts over a window. */
  async popularTitles(
    schoolId: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<Array<{ book: BookWithRelations; issues: number }>> {
    const grouped = await this.prisma.bookIssue.groupBy({
      by: ['copyId'],
      where: { schoolId, issuedAt: { gte: from, lte: to } },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];

    const copies = await this.prisma.bookCopy.findMany({
      where: { id: { in: grouped.map((g) => g.copyId) } },
      select: { id: true, bookId: true },
    });
    const bookOf = new Map(copies.map((c) => [c.id, c.bookId]));

    const perBook = new Map<string, number>();
    for (const row of grouped) {
      const bookId = bookOf.get(row.copyId);
      if (!bookId) continue;
      perBook.set(bookId, (perBook.get(bookId) ?? 0) + row._count._all);
    }

    const top = [...perBook.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit);

    const books = await this.prisma.book.findMany({
      where: { id: { in: top.map(([id]) => id) } },
      include: BOOK_INCLUDE,
    });
    const byId = new Map(books.map((b) => [b.id, b]));

    return top
      .map(([id, issues]) => ({ book: byId.get(id), issues }))
      .filter(
        (row): row is { book: BookWithRelations; issues: number } =>
          row.book !== undefined,
      );
  }

  /** Roadmap §4's "category stock" report. */
  async stockByCategory(schoolId: string): Promise<
    Array<{
      categoryId: string;
      categoryName: string;
      titles: number;
      copies: number;
      available: number;
      issued: number;
      lost: number;
    }>
  > {
    const categories = await this.prisma.bookCategory.findMany({
      where: { schoolId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const books = await this.prisma.book.findMany({
      where: { schoolId, deletedAt: null },
      select: {
        id: true,
        categoryId: true,
        copies: { where: { deletedAt: null }, select: { status: true } },
      },
    });

    return categories.map((category) => {
      const mine = books.filter((b) => b.categoryId === category.id);
      const copies = mine.flatMap((b) => b.copies);
      return {
        categoryId: category.id,
        categoryName: category.name,
        titles: mine.length,
        copies: copies.length,
        available: copies.filter((c) => c.status === 'AVAILABLE').length,
        issued: copies.filter((c) => c.status === 'ISSUED').length,
        lost: copies.filter(
          (c) =>
            c.status === 'LOST' ||
            c.status === 'DAMAGED' ||
            c.status === 'WITHDRAWN',
        ).length,
      };
    });
  }
}
