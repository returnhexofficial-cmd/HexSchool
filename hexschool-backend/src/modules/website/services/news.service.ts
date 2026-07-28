import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NewsPost, Prisma } from '@prisma/client';
import { NewsCategory, WebContentStatus } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { excerptFrom, sanitizeHtml } from '../calc/html-sanitize.util';
import { slugError, slugify, uniqueSlug } from '../calc/slug.util';
import { CreateNewsPostDto, UpdateNewsPostDto } from '../dto';
import { NewsPostsRepository } from '../repositories/cms-content.repository';
import { publishedAtFor } from './publish.util';
import { WebsiteCacheService } from './website-cache.service';

/**
 * News, blog and achievement posts (roadmap M19 §3/§5). The
 * ACHIEVEMENT category is what the separate achievements page reads —
 * one table with a bucket beats three near-identical tables.
 */
@Injectable()
export class NewsService {
  constructor(
    private readonly posts: NewsPostsRepository,
    private readonly audit: AuditContextService,
    private readonly cache: WebsiteCacheService,
  ) {}

  list(
    schoolId: string,
    query: PaginationQueryDto,
    category?: NewsCategory,
  ): Promise<PaginatedResult<NewsPost>> {
    const where: Prisma.NewsPostWhereInput = category ? { category } : {};
    return this.posts.paginate(query, {
      schoolId,
      where,
      searchColumns: ['title', 'slug'],
      sortableColumns: ['createdAt', 'publishedAt', 'title'],
    });
  }

  async get(id: string, schoolId: string): Promise<NewsPost> {
    const post = await this.posts.findById(id, schoolId);
    if (!post) throw new NotFoundException(`News post ${id} not found`);
    return post;
  }

  async create(
    dto: CreateNewsPostDto,
    actor: AccessTokenPayload,
  ): Promise<NewsPost> {
    const slug = await this.resolveSlug(actor.schoolId, dto.slug, dto.title);
    const status = dto.status ?? WebContentStatus.DRAFT;

    const created = await this.posts.create({
      schoolId: actor.schoolId,
      slug,
      title: dto.title,
      titleBn: dto.titleBn ?? null,
      excerpt: dto.excerpt ?? excerptFrom(dto.content, 300),
      content: sanitizeHtml(dto.content),
      contentBn: dto.contentBn ? sanitizeHtml(dto.contentBn) : null,
      coverUrl: dto.coverUrl ?? null,
      category: dto.category ?? NewsCategory.NEWS,
      metaTitle: dto.metaTitle ?? null,
      metaDescription: dto.metaDescription ?? excerptFrom(dto.content, 300),
      status,
      publishedAt: publishedAtFor(status, null),
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'NewsPost',
      entityId: created.id,
      newValues: { slug: created.slug, title: created.title, status },
    });
    await this.cache.bust(actor.schoolId);
    return created;
  }

  async update(
    id: string,
    dto: UpdateNewsPostDto,
    actor: AccessTokenPayload,
  ): Promise<NewsPost> {
    const existing = await this.get(id, actor.schoolId);
    const slug =
      dto.slug !== undefined && dto.slug !== existing.slug
        ? await this.resolveSlug(actor.schoolId, dto.slug, existing.title, id)
        : existing.slug;
    const status = dto.status ?? existing.status;

    const updated = await this.posts.update(id, {
      slug,
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.titleBn !== undefined ? { titleBn: dto.titleBn } : {}),
      ...(dto.excerpt !== undefined ? { excerpt: dto.excerpt } : {}),
      ...(dto.content !== undefined
        ? { content: sanitizeHtml(dto.content) }
        : {}),
      ...(dto.contentBn !== undefined
        ? { contentBn: dto.contentBn ? sanitizeHtml(dto.contentBn) : null }
        : {}),
      ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.metaTitle !== undefined ? { metaTitle: dto.metaTitle } : {}),
      ...(dto.metaDescription !== undefined
        ? { metaDescription: dto.metaDescription }
        : {}),
      status,
      publishedAt: publishedAtFor(status, existing.publishedAt),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'NewsPost',
      entityId: id,
      oldValues: { slug: existing.slug, status: existing.status },
      newValues: { slug: updated.slug, status: updated.status },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async setPublished(
    id: string,
    publish: boolean,
    actor: AccessTokenPayload,
  ): Promise<NewsPost> {
    const existing = await this.get(id, actor.schoolId);
    const status = publish
      ? WebContentStatus.PUBLISHED
      : WebContentStatus.DRAFT;
    const updated = await this.posts.update(id, {
      status,
      publishedAt: publishedAtFor(status, existing.publishedAt),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'NewsPost',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor.schoolId);
    await this.posts.softDelete(id);
    this.audit.set({
      entityType: 'NewsPost',
      entityId: id,
      oldValues: { slug: existing.slug, title: existing.title },
    });
    await this.cache.bust(actor.schoolId);
  }

  private async resolveSlug(
    schoolId: string,
    supplied: string | undefined,
    title: string,
    excludeId?: string,
  ): Promise<string> {
    if (supplied) {
      const error = slugError(supplied);
      if (error) throw new BadRequestException(error);
      const clash = await this.posts.findBySlug(schoolId, supplied);
      if (clash && clash.id !== excludeId) {
        throw new ConflictException(
          `Another post already uses the slug "${supplied}"`,
        );
      }
      return supplied;
    }
    // A Bangla-only title has no ASCII slug to transliterate from
    // (slug.util §doc), and `page-2` is not a URL anyone wants — so ask
    // the author rather than inventing one.
    if (!slugify(title)) {
      throw new BadRequestException(
        `Could not derive a URL slug from "${title}" — supply one explicitly`,
      );
    }
    const taken = await this.posts.takenSlugs(schoolId);
    const derived = uniqueSlug(title, taken);
    const error = slugError(derived);
    if (error) throw new BadRequestException(error);
    return derived;
  }
}
