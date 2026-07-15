import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { buildPaginationMeta, PaginatedResult } from '../dto/paginated.dto';

/** PrismaService or an interactive-transaction client. */
export type PrismaClientLike = PrismaService | Prisma.TransactionClient;

/**
 * The structural subset of a Prisma model delegate that BaseRepository
 * uses. Prisma generates a distinct delegate type per model with no
 * common generic interface, so args/results are typed `unknown` here and
 * narrowed by the generics on the public methods (justified `unknown`
 * casts — see class doc).
 */
interface BaseDelegate {
  findFirst(args?: unknown): Promise<unknown>;
  findMany(args?: unknown): Promise<unknown[]>;
  count(args?: unknown): Promise<number>;
  create(args: { data: unknown }): Promise<unknown>;
  update(args: { where: unknown; data: unknown }): Promise<unknown>;
  updateMany(args: { where: unknown; data: unknown }): Promise<unknown>;
}

export interface BaseRepositoryOptions {
  /** Applies `deleted_at IS NULL` scoping to every default query. */
  softDeletable?: boolean;
  /** Entity carries `school_id`; enables tenant scoping. */
  schoolScoped?: boolean;
}

export interface PaginateOptions<Where> {
  /** Columns `search` is matched against (case-insensitive contains, OR-combined). */
  searchColumns?: string[];
  /** Whitelist for `sort=field:dir`; defaults to createdAt only. */
  sortableColumns?: string[];
  where?: Where;
  /** Tenant scope — applied to every clause when the entity is school-scoped. */
  schoolId?: string;
}

/**
 * Repository-pattern foundation (PROJECT_CONTEXT §4), Prisma edition: all
 * data access goes through per-entity repositories extending this class.
 * Services never touch PrismaService directly; controllers never touch
 * repositories. Provides CRUD, pagination, automatic soft-delete scoping,
 * `school_id` scoping, and a `withTransaction` unit-of-work helper.
 *
 * `T` is the Prisma model type, `Where`/`Create`/`Update` the generated
 * `Prisma.XWhereInput`/`XUncheckedCreateInput`/`XUpdateInput` types.
 * Internals cast through the untyped BaseDelegate — the generics keep the
 * public surface fully typed.
 */
export abstract class BaseRepository<
  T extends { id: string },
  Where extends Record<string, unknown> = Record<string, unknown>,
  Create = unknown,
  Update = unknown,
> {
  private readonly softDeletable: boolean;
  private readonly schoolScoped: boolean;

  protected constructor(
    protected readonly prisma: PrismaService,
    /** Resolves the model delegate from a client (supports transactions). */
    private readonly resolveDelegate: (client: PrismaClientLike) => unknown,
    private readonly modelName: string,
    options: BaseRepositoryOptions = {},
  ) {
    this.softDeletable = options.softDeletable ?? true;
    this.schoolScoped = options.schoolScoped ?? true;
  }

  protected delegate(tx?: PrismaClientLike): BaseDelegate {
    return this.resolveDelegate(tx ?? this.prisma) as BaseDelegate;
  }

  async findById(id: string, schoolId?: string): Promise<T | null> {
    return this.findOne({ id } as unknown as Where, schoolId);
  }

  async findByIdOrFail(id: string, schoolId?: string): Promise<T> {
    const entity = await this.findById(id, schoolId);
    if (!entity) {
      throw new NotFoundException(`${this.modelName} ${id} not found`);
    }
    return entity;
  }

  async findOne(where: Where, schoolId?: string): Promise<T | null> {
    return (await this.delegate().findFirst({
      where: this.scope(where, schoolId),
    })) as T | null;
  }

  async findAll(where?: Where, schoolId?: string): Promise<T[]> {
    return (await this.delegate().findMany({
      where: this.scope(where ?? ({} as Where), schoolId),
    })) as T[];
  }

  /**
   * Standard list query implementing `?page&limit&sort=field:asc&search=`
   * with the `meta: { page, limit, total, totalPages }` envelope contract.
   */
  async paginate(
    query: PaginationQueryDto,
    options: PaginateOptions<Where> = {},
  ): Promise<PaginatedResult<T>> {
    const { page, limit } = query;
    const where = this.buildPaginateWhere(query, options);
    const orderBy = this.buildOrder(query, options);

    const [items, total] = await Promise.all([
      this.delegate().findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.delegate().count({ where }),
    ]);

    return {
      data: items as T[],
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async create(data: Create, tx?: PrismaClientLike): Promise<T> {
    return (await this.delegate(tx).create({ data })) as T;
  }

  async update(id: string, data: Update, tx?: PrismaClientLike): Promise<T> {
    await this.findByIdOrFail(id); // respects soft-delete scope
    return (await this.delegate(tx).update({ where: { id }, data })) as T;
  }

  async softDelete(id: string): Promise<void> {
    if (!this.softDeletable) {
      throw new Error(`${this.modelName} does not support soft delete`);
    }
    await this.delegate().updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string): Promise<void> {
    if (!this.softDeletable) {
      throw new Error(`${this.modelName} does not support soft delete`);
    }
    await this.delegate().updateMany({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async count(where?: Where, schoolId?: string): Promise<number> {
    return this.delegate().count({
      where: this.scope(where ?? ({} as Where), schoolId),
    });
  }

  /**
   * Unit-of-work helper: runs `fn` inside a single interactive
   * transaction. Pass the provided client to other repositories' methods
   * (they all accept an optional `tx`) when an operation spans entities.
   */
  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }

  // ── internals ─────────────────────────────────────────────────────

  protected scope(where: Where, schoolId?: string): Record<string, unknown> {
    return {
      ...where,
      ...(this.softDeletable ? { deletedAt: null } : {}),
      ...(this.schoolScoped && schoolId ? { schoolId } : {}),
    };
  }

  private buildPaginateWhere(
    query: PaginationQueryDto,
    options: PaginateOptions<Where>,
  ): Record<string, unknown> {
    const base = this.scope(options.where ?? ({} as Where), options.schoolId);

    if (query.search && options.searchColumns?.length) {
      return {
        AND: [
          base,
          {
            OR: options.searchColumns.map((col) => ({
              [col]: { contains: query.search, mode: 'insensitive' },
            })),
          },
        ],
      };
    }
    return base;
  }

  private buildOrder(
    query: PaginationQueryDto,
    options: PaginateOptions<Where>,
  ): Record<string, 'asc' | 'desc'> {
    const sortable = options.sortableColumns ?? ['createdAt'];
    if (query.sort) {
      const [field, dir] = query.sort.split(':');
      if (sortable.includes(field)) {
        return { [field]: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' };
      }
    }
    return { createdAt: 'desc' };
  }
}
