import {
  DeepPartial,
  EntityManager,
  FindOptionsOrder,
  FindOptionsRelations,
  FindOptionsWhere,
  ILike,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { NotFoundException } from '@nestjs/common';
import { AppBaseEntity } from './base.entity';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { buildPaginationMeta, PaginatedResult } from '../dto/paginated.dto';

export interface PaginateOptions<T> {
  /** Columns `search` is matched against with ILIKE (OR-combined). */
  searchColumns?: (keyof T & string)[];
  /** Whitelist for `sort=field:dir`; defaults to createdAt only. */
  sortableColumns?: (keyof T & string)[];
  where?: FindOptionsWhere<T> | FindOptionsWhere<T>[];
  relations?: FindOptionsRelations<T>;
  /** Tenant scope — applied to every clause when the entity carries school_id. */
  schoolId?: string;
}

/**
 * Repository-pattern foundation (PROJECT_CONTEXT §4): all data access goes
 * through per-entity repositories extending this class. Services never touch
 * the ORM/QueryBuilder; controllers never touch repositories.
 *
 * Provides: CRUD, pagination, automatic soft-delete scoping (via
 * DeleteDateColumn), `school_id` scoping, and a `withTransaction`
 * unit-of-work helper.
 */
export abstract class BaseRepository<T extends AppBaseEntity> {
  protected constructor(protected readonly repo: Repository<T>) {}

  get manager(): EntityManager {
    return this.repo.manager;
  }

  async findById(id: string, schoolId?: string): Promise<T | null> {
    return this.repo.findOne({
      where: this.scope({ id } as FindOptionsWhere<T>, schoolId),
    });
  }

  async findByIdOrFail(id: string, schoolId?: string): Promise<T> {
    const entity = await this.findById(id, schoolId);
    if (!entity) {
      throw new NotFoundException(`${this.repo.metadata.name} ${id} not found`);
    }
    return entity;
  }

  async findOne(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    schoolId?: string,
  ): Promise<T | null> {
    return this.repo.findOne({ where: this.scopeAll(where, schoolId) });
  }

  async findAll(
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    schoolId?: string,
  ): Promise<T[]> {
    return this.repo.find({
      where: where ? this.scopeAll(where, schoolId) : this.scope({}, schoolId),
    });
  }

  /**
   * Standard list query implementing `?page&limit&sort=field:asc&search=`
   * with the `meta: { page, limit, total, totalPages }` envelope contract.
   */
  async paginate(
    query: PaginationQueryDto,
    options: PaginateOptions<T> = {},
  ): Promise<PaginatedResult<T>> {
    const { page, limit } = query;
    const where = this.buildPaginateWhere(query, options);
    const order = this.buildOrder(query, options);

    const [items, total] = await this.repo.findAndCount({
      where,
      order,
      relations: options.relations,
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  create(data: DeepPartial<T>): T {
    return this.repo.create(data);
  }

  async save(entity: DeepPartial<T>): Promise<T> {
    return this.repo.save(entity);
  }

  async update(id: string, data: QueryDeepPartialEntity<T>): Promise<T> {
    await this.repo.update(id, data);
    return this.findByIdOrFail(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  async restore(id: string): Promise<void> {
    await this.repo.restore(id);
  }

  async count(
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    schoolId?: string,
  ): Promise<number> {
    return this.repo.count({
      where: where ? this.scopeAll(where, schoolId) : this.scope({}, schoolId),
    });
  }

  /**
   * Unit-of-work helper: runs `fn` inside a single DB transaction. Pass the
   * provided EntityManager to other repositories via their `withManager`
   * escape hatch when a business operation spans entities.
   */
  async withTransaction<R>(
    fn: (manager: EntityManager) => Promise<R>,
  ): Promise<R> {
    return this.repo.manager.transaction(fn);
  }

  /** Transactional variant of this repository bound to `manager`. */
  withManager(manager: EntityManager): Repository<T> {
    return manager.getRepository<T>(this.repo.target);
  }

  // ── internals ─────────────────────────────────────────────────────

  private hasSchoolColumn(): boolean {
    return this.repo.metadata.columns.some(
      (c) => c.databaseName === 'school_id',
    );
  }

  protected scope(
    where: FindOptionsWhere<T>,
    schoolId?: string,
  ): FindOptionsWhere<T> {
    if (schoolId && this.hasSchoolColumn()) {
      return { ...where, schoolId };
    }
    return where;
  }

  private scopeAll(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    schoolId?: string,
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    return Array.isArray(where)
      ? where.map((w) => this.scope(w, schoolId))
      : this.scope(where, schoolId);
  }

  private buildPaginateWhere(
    query: PaginationQueryDto,
    options: PaginateOptions<T>,
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined {
    const base = this.scope(
      (options.where as FindOptionsWhere<T>) ?? {},
      options.schoolId,
    );

    if (query.search && options.searchColumns?.length) {
      // OR across searchable columns, AND-ed with the base filter.
      return options.searchColumns.map((col) => ({
        ...base,
        [col]: ILike(`%${query.search}%`),
      }));
    }
    return base;
  }

  private buildOrder(
    query: PaginationQueryDto,
    options: PaginateOptions<T>,
  ): FindOptionsOrder<T> {
    const sortable = options.sortableColumns ?? ['createdAt'];
    if (query.sort) {
      const [field, dir] = query.sort.split(':');
      if ((sortable as string[]).includes(field)) {
        return { [field]: dir.toUpperCase() } as FindOptionsOrder<T>;
      }
    }
    return { createdAt: 'DESC' } as FindOptionsOrder<T>;
  }
}
