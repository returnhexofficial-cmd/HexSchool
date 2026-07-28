import { Injectable, NotFoundException } from '@nestjs/common';
import { Gallery, GalleryItem } from '@prisma/client';
import { WebContentStatus } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { parseDate } from '../../academic/calendar/date.util';
import {
  CreateGalleryDto,
  GalleryItemInputDto,
  UpdateGalleryDto,
} from '../dto';
import {
  GalleriesRepository,
  GalleryItemsRepository,
} from '../repositories/cms-content.repository';
import { WebsiteCacheService } from './website-cache.service';

/**
 * Photo/video albums. An album's items are edited as a SET: the incoming
 * list replaces what is there, inside one transaction. Piecemeal item
 * endpoints would leave the display order to be reconciled across N
 * requests, and re-ordering a 60-photo album is exactly the case that
 * would break (the M13/M14 "regenerate the child rows wholesale"
 * precedent, applied to authored content).
 */
@Injectable()
export class GalleryService {
  constructor(
    private readonly galleries: GalleriesRepository,
    private readonly items: GalleryItemsRepository,
    private readonly audit: AuditContextService,
    private readonly cache: WebsiteCacheService,
  ) {}

  list(
    schoolId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Gallery>> {
    return this.galleries.paginate(query, {
      schoolId,
      searchColumns: ['title'],
      sortableColumns: ['createdAt', 'title', 'eventDate', 'displayOrder'],
    });
  }

  async get(
    id: string,
    schoolId: string,
  ): Promise<Gallery & { items: GalleryItem[] }> {
    const gallery = await this.galleries.findById(id, schoolId);
    if (!gallery) throw new NotFoundException(`Gallery ${id} not found`);
    const { items } = await this.items.listForGallery(id, { take: 500 });
    return { ...gallery, items };
  }

  async create(
    dto: CreateGalleryDto,
    actor: AccessTokenPayload,
  ): Promise<Gallery> {
    const created = await this.galleries.create({
      schoolId: actor.schoolId,
      title: dto.title,
      titleBn: dto.titleBn ?? null,
      description: dto.description ?? null,
      eventDate: dto.eventDate ? parseDate(dto.eventDate) : null,
      coverUrl: dto.coverUrl ?? null,
      status: dto.status ?? WebContentStatus.DRAFT,
      displayOrder: dto.displayOrder ?? 0,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    if (dto.items) await this.replaceItems(created.id, dto.items, actor);

    this.audit.set({
      entityType: 'Gallery',
      entityId: created.id,
      newValues: { title: created.title, items: dto.items?.length ?? 0 },
    });
    await this.cache.bust(actor.schoolId);
    return created;
  }

  async update(
    id: string,
    dto: UpdateGalleryDto,
    actor: AccessTokenPayload,
  ): Promise<Gallery> {
    const existing = await this.galleries.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Gallery ${id} not found`);

    const updated = await this.galleries.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.titleBn !== undefined ? { titleBn: dto.titleBn } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.eventDate !== undefined
        ? {
            eventDate: dto.eventDate ? parseDate(dto.eventDate) : null,
          }
        : {}),
      ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    });
    if (dto.items) await this.replaceItems(id, dto.items, actor);

    this.audit.set({
      entityType: 'Gallery',
      entityId: id,
      oldValues: { title: existing.title, status: existing.status },
      newValues: { title: updated.title, status: updated.status },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async setPublished(
    id: string,
    publish: boolean,
    actor: AccessTokenPayload,
  ): Promise<Gallery> {
    const existing = await this.galleries.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Gallery ${id} not found`);
    const status = publish
      ? WebContentStatus.PUBLISHED
      : WebContentStatus.DRAFT;
    const updated = await this.galleries.update(id, {
      status,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Gallery',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.galleries.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Gallery ${id} not found`);
    await this.galleries.softDelete(id);
    this.audit.set({
      entityType: 'Gallery',
      entityId: id,
      oldValues: { title: existing.title },
    });
    await this.cache.bust(actor.schoolId);
  }

  /** Items are replaced as a set, in one transaction. */
  private async replaceItems(
    galleryId: string,
    incoming: GalleryItemInputDto[],
    actor: AccessTokenPayload,
  ): Promise<void> {
    await this.items.withTransaction(async (tx) => {
      await tx.galleryItem.deleteMany({ where: { galleryId } });
      if (incoming.length === 0) return;
      await tx.galleryItem.createMany({
        data: incoming.map((item, index) => ({
          schoolId: actor.schoolId,
          galleryId,
          type: item.type,
          url: item.url,
          caption: item.caption ?? null,
          displayOrder: item.displayOrder ?? index,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        })),
      });
    });
  }
}
