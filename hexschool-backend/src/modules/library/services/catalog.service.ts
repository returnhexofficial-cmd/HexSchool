import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { parseIsbn } from '../calc/isbn.util';
import type {
  BookQueryDto,
  CreateBookDto,
  MasterQueryDto,
  UpdateBookDto,
  UpsertAuthorDto,
  UpsertCategoryDto,
  UpsertPublisherDto,
} from '../dto';
import {
  AuthorsRepository,
  BooksRepository,
  BookCategoriesRepository,
  PublishersRepository,
  type BookWithRelations,
} from '../repositories/catalog.repository';

/**
 * The catalogue: three masters and the title record over them.
 *
 * The delete guards follow the M06 rule verbatim — a master in use is
 * refused with a count and an explanation rather than cascading, because
 * "delete the Science category" must never be a way to lose four hundred
 * books.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly categories: BookCategoriesRepository,
    private readonly authors: AuthorsRepository,
    private readonly publishers: PublishersRepository,
    private readonly books: BooksRepository,
    private readonly audit: AuditContextService,
  ) {}

  // ── categories ──────────────────────────────────────────────────────

  async listCategories(query: MasterQueryDto, actor: AccessTokenPayload) {
    return this.categories.paginate(query, {
      searchColumns: ['name', 'nameBn'],
      sortableColumns: ['name', 'createdAt'],
      schoolId: actor.schoolId,
    });
  }

  async createCategory(dto: UpsertCategoryDto, actor: AccessTokenPayload) {
    await this.assertCategoryNameFree(dto.name, actor.schoolId);
    const created = await this.categories.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      description: dto.description?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'BookCategory',
      entityId: created.id,
      newValues: { name: created.name },
    });
    return created;
  }

  async updateCategory(
    id: string,
    dto: UpsertCategoryDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.categories.findByIdOrFail(id, actor.schoolId);
    if (dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertCategoryNameFree(dto.name, actor.schoolId);
    }
    const updated = await this.categories.update(id, {
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      description: dto.description?.trim() || null,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'BookCategory',
      entityId: id,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
    });
    return updated;
  }

  async removeCategory(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.categories.findByIdOrFail(id, actor.schoolId);
    const books = await this.categories.countBooks(id);
    if (books > 0) {
      throw new ConflictException(
        `${books} book(s) are catalogued under "${existing.name}" — move them to another category first`,
      );
    }
    await this.categories.softDelete(id);
    this.audit.set({
      entityType: 'BookCategory',
      entityId: id,
      oldValues: { name: existing.name },
    });
  }

  // ── authors ─────────────────────────────────────────────────────────

  async listAuthors(query: MasterQueryDto, actor: AccessTokenPayload) {
    return this.authors.paginate(query, {
      searchColumns: ['name', 'nameBn'],
      sortableColumns: ['name', 'createdAt'],
      schoolId: actor.schoolId,
    });
  }

  async createAuthor(dto: UpsertAuthorDto, actor: AccessTokenPayload) {
    if (await this.authors.findByName(actor.schoolId, dto.name)) {
      throw new ConflictException(
        `An author named "${dto.name}" already exists`,
      );
    }
    const created = await this.authors.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      note: dto.note?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Author',
      entityId: created.id,
      newValues: { name: created.name },
    });
    return created;
  }

  async updateAuthor(
    id: string,
    dto: UpsertAuthorDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.authors.findByIdOrFail(id, actor.schoolId);
    if (dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await this.authors.findByName(actor.schoolId, dto.name);
      if (clash) {
        throw new ConflictException(
          `An author named "${dto.name}" already exists`,
        );
      }
    }
    return this.authors.update(id, {
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      note: dto.note?.trim() || null,
      updatedBy: actor.sub,
    });
  }

  async removeAuthor(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.authors.findByIdOrFail(id, actor.schoolId);
    const books = await this.authors.countBooks(id);
    if (books > 0) {
      throw new ConflictException(
        `${books} book(s) credit "${existing.name}" — remove them from those books first`,
      );
    }
    await this.authors.softDelete(id);
  }

  // ── publishers ──────────────────────────────────────────────────────

  async listPublishers(query: MasterQueryDto, actor: AccessTokenPayload) {
    return this.publishers.paginate(query, {
      searchColumns: ['name', 'nameBn'],
      sortableColumns: ['name', 'createdAt'],
      schoolId: actor.schoolId,
    });
  }

  async createPublisher(dto: UpsertPublisherDto, actor: AccessTokenPayload) {
    if (await this.publishers.findByName(actor.schoolId, dto.name)) {
      throw new ConflictException(
        `A publisher named "${dto.name}" already exists`,
      );
    }
    const created = await this.publishers.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      phone: dto.phone?.trim() || null,
      email: dto.email?.trim() || null,
      address: dto.address?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Publisher',
      entityId: created.id,
      newValues: { name: created.name },
    });
    return created;
  }

  async updatePublisher(
    id: string,
    dto: UpsertPublisherDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.publishers.findByIdOrFail(id, actor.schoolId);
    if (dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await this.publishers.findByName(actor.schoolId, dto.name);
      if (clash) {
        throw new ConflictException(
          `A publisher named "${dto.name}" already exists`,
        );
      }
    }
    return this.publishers.update(id, {
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      phone: dto.phone?.trim() || null,
      email: dto.email?.trim() || null,
      address: dto.address?.trim() || null,
      updatedBy: actor.sub,
    });
  }

  async removePublisher(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.publishers.findByIdOrFail(id, actor.schoolId);
    const books = await this.publishers.countBooks(id);
    if (books > 0) {
      throw new ConflictException(
        `${books} book(s) are published by "${existing.name}" — reassign them first`,
      );
    }
    await this.publishers.softDelete(id);
  }

  // ── books ───────────────────────────────────────────────────────────

  async listBooks(query: BookQueryDto, actor: AccessTokenPayload) {
    const { page, limit } = query;
    const { rows, total } = await this.books.findMany(
      actor.schoolId,
      {
        categoryId: query.categoryId,
        publisherId: query.publisherId,
        authorId: query.authorId,
        language: query.language,
        rackNo: query.rackNo,
        search: query.search,
        availableOnly: query.availableOnly,
      },
      page,
      limit,
    );
    return { rows: await this.withCopyCounts(rows), total, page, limit };
  }

  async getBook(id: string, schoolId: string) {
    const book = await this.books.findDetail(id, schoolId);
    if (!book) throw new NotFoundException(`Book ${id} not found`);
    const [withCounts] = await this.withCopyCounts([book]);
    return withCounts;
  }

  async createBook(dto: CreateBookDto, actor: AccessTokenPayload) {
    await this.categories.findByIdOrFail(dto.categoryId, actor.schoolId);
    if (dto.publisherId) {
      await this.publishers.findByIdOrFail(dto.publisherId, actor.schoolId);
    }
    const isbn = this.parseIsbnOr400(dto.isbn);

    const created = await this.books.withTransaction(async (tx) => {
      const book = await this.books.create(
        {
          schoolId: actor.schoolId,
          title: dto.title.trim(),
          titleBn: dto.titleBn?.trim() || null,
          isbn,
          categoryId: dto.categoryId,
          publisherId: dto.publisherId ?? null,
          edition: dto.edition?.trim() || null,
          language: dto.language?.trim() || 'English',
          price: dto.price ?? null,
          coverUrl: dto.coverUrl?.trim() || null,
          rackNo: dto.rackNo?.trim() || null,
          description: dto.description?.trim() || null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      const authorIds = await this.resolveAuthors(dto, actor);
      await this.books.replaceAuthors(book.id, authorIds, tx);
      return book;
    });

    this.audit.set({
      entityType: 'Book',
      entityId: created.id,
      newValues: { title: created.title, isbn: created.isbn },
    });
    return this.getBook(created.id, actor.schoolId);
  }

  async updateBook(id: string, dto: UpdateBookDto, actor: AccessTokenPayload) {
    const existing = await this.books.findByIdOrFail(id, actor.schoolId);
    if (dto.categoryId) {
      await this.categories.findByIdOrFail(dto.categoryId, actor.schoolId);
    }
    if (dto.publisherId) {
      await this.publishers.findByIdOrFail(dto.publisherId, actor.schoolId);
    }
    const isbn =
      dto.isbn === undefined ? undefined : this.parseIsbnOr400(dto.isbn);

    await this.books.withTransaction(async (tx) => {
      await this.books.update(
        id,
        {
          ...(dto.title ? { title: dto.title.trim() } : {}),
          ...(dto.titleBn !== undefined
            ? { titleBn: dto.titleBn?.trim() || null }
            : {}),
          ...(isbn !== undefined ? { isbn } : {}),
          ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
          ...(dto.publisherId !== undefined
            ? { publisherId: dto.publisherId ?? null }
            : {}),
          ...(dto.edition !== undefined
            ? { edition: dto.edition?.trim() || null }
            : {}),
          ...(dto.language ? { language: dto.language.trim() } : {}),
          ...(dto.price !== undefined ? { price: dto.price ?? null } : {}),
          ...(dto.coverUrl !== undefined
            ? { coverUrl: dto.coverUrl?.trim() || null }
            : {}),
          ...(dto.rackNo !== undefined
            ? { rackNo: dto.rackNo?.trim() || null }
            : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          updatedBy: actor.sub,
        },
        tx,
      );
      if (dto.authorIds !== undefined || dto.authorNames !== undefined) {
        const authorIds = await this.resolveAuthors(dto, actor);
        await this.books.replaceAuthors(id, authorIds, tx);
      }
    });

    this.audit.set({
      entityType: 'Book',
      entityId: id,
      oldValues: { title: existing.title, isbn: existing.isbn },
      newValues: { title: dto.title, isbn },
    });
    return this.getBook(id, actor.schoolId);
  }

  /**
   * Deleting a title is refused once any copy exists — the M14/M15/M22
   * "blocked once real data hangs off it" guard. The FK is RESTRICT, so
   * the alternative would be a 500 from the database rather than a
   * sentence the librarian can act on.
   */
  async removeBook(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.books.findByIdOrFail(id, actor.schoolId);
    const copies = await this.books.countCopies(id);
    if (copies > 0) {
      throw new ConflictException(
        `"${existing.title}" has ${copies} copy/copies on the shelves — withdraw them before removing the title`,
      );
    }
    await this.books.softDelete(id);
    this.audit.set({
      entityType: 'Book',
      entityId: id,
      oldValues: { title: existing.title },
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────

  /** Availability badges for a page of titles, in one query. */
  async withCopyCounts(rows: BookWithRelations[]) {
    const counts = await this.books.copyCounts(rows.map((r) => r.id));
    return rows.map((row) => ({
      ...row,
      copies: counts.get(row.id) ?? { total: 0, available: 0 },
    }));
  }

  private async assertCategoryNameFree(
    name: string,
    schoolId: string,
  ): Promise<void> {
    if (await this.categories.findByName(schoolId, name)) {
      throw new ConflictException(`A category named "${name}" already exists`);
    }
  }

  private parseIsbnOr400(raw: string | undefined): string | null {
    try {
      return parseIsbn(raw);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /**
   * Ids first, then names — a librarian cataloguing at speed types
   * "Humayun Ahmed" and expects the author to exist afterwards, which is
   * a nicer failure mode than being sent to a different screen.
   */
  private async resolveAuthors(
    dto: { authorIds?: string[]; authorNames?: string[] },
    actor: AccessTokenPayload,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const id of dto.authorIds ?? []) {
      await this.authors.findByIdOrFail(id, actor.schoolId);
      ids.push(id);
    }
    const created = await this.authors.ensureMany(
      actor.schoolId,
      dto.authorNames ?? [],
      actor.sub,
    );
    for (const author of created) {
      if (!ids.includes(author.id)) ids.push(author.id);
    }
    return ids;
  }
}
