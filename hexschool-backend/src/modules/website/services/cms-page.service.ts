import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CmsPage } from '@prisma/client';
import { WebContentStatus } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { excerptFrom, sanitizeHtml } from '../calc/html-sanitize.util';
import { slugError, slugify, uniqueSlug } from '../calc/slug.util';
import { CreateCmsPageDto, UpdateCmsPageDto } from '../dto';
import { CmsPagesRepository } from '../repositories/cms-content.repository';
import { publishedAtFor } from './publish.util';
import { WebsiteCacheService } from './website-cache.service';

/**
 * CMS pages — the institutional content (about, history, mission,
 * principal's message). Two rules the rest of the module inherits:
 * markup is sanitized on WRITE (so no reader has to trust it), and the
 * slug is validated against the reserved-segment list before it can
 * shadow an application route.
 */
@Injectable()
export class CmsPageService {
  constructor(
    private readonly pages: CmsPagesRepository,
    private readonly audit: AuditContextService,
    private readonly cache: WebsiteCacheService,
  ) {}

  list(
    schoolId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<CmsPage>> {
    return this.pages.paginate(query, {
      schoolId,
      searchColumns: ['title', 'slug'],
      sortableColumns: ['createdAt', 'title', 'slug', 'displayOrder'],
    });
  }

  async get(id: string, schoolId: string): Promise<CmsPage> {
    const page = await this.pages.findById(id, schoolId);
    if (!page) throw new NotFoundException(`CMS page ${id} not found`);
    return page;
  }

  async create(
    dto: CreateCmsPageDto,
    actor: AccessTokenPayload,
  ): Promise<CmsPage> {
    const slug = await this.resolveSlug(actor.schoolId, dto.slug, dto.title);
    const status = dto.status ?? WebContentStatus.DRAFT;

    const created = await this.pages.create({
      schoolId: actor.schoolId,
      slug,
      title: dto.title,
      titleBn: dto.titleBn ?? null,
      content: sanitizeHtml(dto.content),
      contentBn: dto.contentBn ? sanitizeHtml(dto.contentBn) : null,
      excerpt: dto.excerpt ?? excerptFrom(dto.content, 300),
      metaTitle: dto.metaTitle ?? null,
      metaDescription: dto.metaDescription ?? excerptFrom(dto.content, 300),
      ogImageUrl: dto.ogImageUrl ?? null,
      template: dto.template,
      showInMenu: dto.showInMenu ?? false,
      displayOrder: dto.displayOrder ?? 0,
      status,
      publishedAt: publishedAtFor(status, null),
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'CmsPage',
      entityId: created.id,
      newValues: { slug: created.slug, title: created.title, status },
    });
    await this.cache.bust(actor.schoolId);
    return created;
  }

  async update(
    id: string,
    dto: UpdateCmsPageDto,
    actor: AccessTokenPayload,
  ): Promise<CmsPage> {
    const existing = await this.get(id, actor.schoolId);
    const slug =
      dto.slug !== undefined && dto.slug !== existing.slug
        ? await this.resolveSlug(actor.schoolId, dto.slug, existing.title, id)
        : existing.slug;
    const status = dto.status ?? existing.status;

    const updated = await this.pages.update(id, {
      slug,
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.titleBn !== undefined ? { titleBn: dto.titleBn } : {}),
      ...(dto.content !== undefined
        ? { content: sanitizeHtml(dto.content) }
        : {}),
      ...(dto.contentBn !== undefined
        ? { contentBn: dto.contentBn ? sanitizeHtml(dto.contentBn) : null }
        : {}),
      ...(dto.excerpt !== undefined ? { excerpt: dto.excerpt } : {}),
      ...(dto.metaTitle !== undefined ? { metaTitle: dto.metaTitle } : {}),
      ...(dto.metaDescription !== undefined
        ? { metaDescription: dto.metaDescription }
        : {}),
      ...(dto.ogImageUrl !== undefined ? { ogImageUrl: dto.ogImageUrl } : {}),
      ...(dto.template !== undefined ? { template: dto.template } : {}),
      ...(dto.showInMenu !== undefined ? { showInMenu: dto.showInMenu } : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      status,
      publishedAt: publishedAtFor(status, existing.publishedAt),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'CmsPage',
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
  ): Promise<CmsPage> {
    const existing = await this.get(id, actor.schoolId);
    const status = publish
      ? WebContentStatus.PUBLISHED
      : WebContentStatus.DRAFT;

    const updated = await this.pages.update(id, {
      status,
      publishedAt: publishedAtFor(status, existing.publishedAt),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'CmsPage',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor.schoolId);
    await this.pages.softDelete(id);
    this.audit.set({
      entityType: 'CmsPage',
      entityId: id,
      oldValues: { slug: existing.slug, title: existing.title },
    });
    await this.cache.bust(actor.schoolId);
  }

  /**
   * Validates an author-supplied slug, or derives a free one from the
   * title. The partial unique index is the real guarantee; this check
   * turns the race it would lose into a readable 409 in the normal case.
   */
  private async resolveSlug(
    schoolId: string,
    supplied: string | undefined,
    title: string,
    excludeId?: string,
  ): Promise<string> {
    if (supplied) {
      const error = slugError(supplied);
      if (error) throw new BadRequestException(error);
      const clash = await this.pages.findBySlug(schoolId, supplied);
      if (clash && clash.id !== excludeId) {
        throw new ConflictException(
          `Another page already uses the slug "${supplied}"`,
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
    const taken = await this.pages.takenSlugs(schoolId);
    const derived = uniqueSlug(title, taken);
    const error = slugError(derived);
    if (error) throw new BadRequestException(error);
    return derived;
  }
}
