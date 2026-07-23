import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Notice, Prisma } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { CreateNoticeDto, UpdateNoticeDto } from '../dto';
import { NoticesRepository } from '../repositories/notices.repository';

/**
 * Notices / circulars (roadmap M17 §4/§5). Content targeted at an
 * audience, surfaced through the portal + website feeds. A future
 * `publish_at` is honoured by the scheduled-publisher job; publishing with
 * a *past-or-absent* publish_at flips it live now, and a future one is
 * refused at publish time (the CHECK cannot use a non-immutable now()).
 */
@Injectable()
export class NoticeService {
  constructor(
    private readonly notices: NoticesRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  list(
    schoolId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Notice>> {
    return this.notices.paginate(query, {
      schoolId,
      searchColumns: ['title'],
      sortableColumns: ['createdAt', 'title', 'publishAt'],
    });
  }

  async get(id: string, schoolId: string): Promise<Notice> {
    const notice = await this.notices.findById(id, schoolId);
    if (!notice) throw new NotFoundException(`Notice ${id} not found`);
    return notice;
  }

  feed(schoolId: string, websiteOnly = false): Promise<Notice[]> {
    return this.notices.publishedFeed(schoolId, { websiteOnly });
  }

  async create(
    dto: CreateNoticeDto,
    actor: AccessTokenPayload,
  ): Promise<Notice> {
    this.assertAudienceRef(dto);
    const publishNow = dto.isPublished === true;
    if (publishNow) this.assertNotFuture(dto.publishAt);

    const created = await this.notices.create({
      schoolId: actor.schoolId,
      title: dto.title,
      body: dto.body,
      audience: dto.audience,
      audienceRef: (dto.audienceRef ?? undefined) as Prisma.InputJsonValue,
      attachmentUrls: dto.attachmentUrls ?? undefined,
      isPublished: publishNow,
      publishAt: dto.publishAt ? new Date(dto.publishAt) : null,
      isWebsiteVisible: dto.isWebsiteVisible ?? false,
      pinned: dto.pinned ?? false,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Notice',
      entityId: created.id,
      newValues: { title: created.title, audience: created.audience },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateNoticeDto,
    actor: AccessTokenPayload,
  ): Promise<Notice> {
    const existing = await this.get(id, actor.schoolId);

    const updated = await this.notices.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.body !== undefined ? { body: dto.body } : {}),
      ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
      ...(dto.audienceRef !== undefined
        ? { audienceRef: dto.audienceRef as Prisma.InputJsonValue }
        : {}),
      ...(dto.attachmentUrls !== undefined
        ? { attachmentUrls: dto.attachmentUrls }
        : {}),
      ...(dto.isWebsiteVisible !== undefined
        ? { isWebsiteVisible: dto.isWebsiteVisible }
        : {}),
      ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
      ...(dto.publishAt !== undefined
        ? { publishAt: dto.publishAt ? new Date(dto.publishAt) : null }
        : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Notice',
      entityId: id,
      oldValues: { title: existing.title },
      newValues: { title: updated.title },
    });
    return updated;
  }

  /** Flip a notice's published state; publishing refuses a future date. */
  async setPublished(
    id: string,
    publish: boolean,
    actor: AccessTokenPayload,
  ): Promise<Notice> {
    const existing = await this.get(id, actor.schoolId);
    if (publish) this.assertNotFuture(existing.publishAt?.toISOString());

    const updated = await this.notices.update(id, {
      isPublished: publish,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Notice',
      entityId: id,
      oldValues: { isPublished: existing.isPublished },
      newValues: { isPublished: publish },
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor.schoolId);
    await this.notices.softDelete(id);
    this.auditContext.set({
      entityType: 'Notice',
      entityId: id,
      oldValues: { title: existing.title },
    });
  }

  private assertAudienceRef(dto: CreateNoticeDto): void {
    if (
      (dto.audience === 'CLASS' || dto.audience === 'SECTION') &&
      !dto.audienceRef
    ) {
      throw new BadRequestException(
        `A ${dto.audience} notice needs an audienceRef id list`,
      );
    }
  }

  private assertNotFuture(publishAt?: string | null): void {
    if (publishAt && new Date(publishAt).getTime() > Date.now()) {
      throw new BadRequestException(
        'Cannot publish now — publishAt is in the future. Let the scheduler publish it, or clear the date.',
      );
    }
  }
}
