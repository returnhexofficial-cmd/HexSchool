import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Career, CareerApplication } from '@prisma/client';
import {
  CareerApplicationStatus,
  NotificationChannel,
  NotificationRecipientType,
  WebContentStatus,
} from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { parseDate } from '../../academic/calendar/date.util';
import { NotificationService } from '../../communication/services/notification.service';
import { StorageService } from '../../storage/storage.service';
import { dhakaToday } from '../../../common/utils/clock.util';
import {
  CreateCareerDto,
  PublicCareerApplyDto,
  UpdateCareerApplicationDto,
  UpdateCareerDto,
} from '../dto';
import { sanitizeHtml } from '../calc/html-sanitize.util';
import {
  CareerApplicationsRepository,
  CareersRepository,
} from '../repositories/cms-content.repository';
import { PublicSiteRepository } from '../repositories/public-site.repository';
import { WebsiteCacheService } from './website-cache.service';
import { WebsiteSettingsService } from './website-settings.service';

const CV_MIME = new Set(['application/pdf']);

/**
 * Job openings and the applications they attract. Applying is a PUBLIC
 * write: the opening must be published AND still open (a deadline that
 * passed yesterday stops accepting), the CV is a PDF within the
 * configured size, and the office is notified in-app.
 */
@Injectable()
export class CareerService {
  constructor(
    private readonly careers: CareersRepository,
    private readonly applications: CareerApplicationsRepository,
    private readonly storage: StorageService,
    private readonly people: PublicSiteRepository,
    private readonly notifications: NotificationService,
    private readonly config: WebsiteSettingsService,
    private readonly audit: AuditContextService,
    private readonly cache: WebsiteCacheService,
  ) {}

  list(
    schoolId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Career>> {
    return this.careers.paginate(query, {
      schoolId,
      searchColumns: ['title', 'location'],
      sortableColumns: ['createdAt', 'title', 'deadline', 'displayOrder'],
    });
  }

  async get(id: string, schoolId: string): Promise<Career> {
    const row = await this.careers.findById(id, schoolId);
    if (!row) throw new NotFoundException(`Job opening ${id} not found`);
    return row;
  }

  async create(
    dto: CreateCareerDto,
    actor: AccessTokenPayload,
  ): Promise<Career> {
    const created = await this.careers.create({
      schoolId: actor.schoolId,
      title: dto.title,
      description: sanitizeHtml(dto.description),
      location: dto.location ?? null,
      vacancies: dto.vacancies ?? null,
      deadline: dto.deadline ? parseDate(dto.deadline) : null,
      status: dto.status ?? WebContentStatus.DRAFT,
      displayOrder: dto.displayOrder ?? 0,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Career',
      entityId: created.id,
      newValues: { title: created.title, status: created.status },
    });
    await this.cache.bust(actor.schoolId);
    return created;
  }

  async update(
    id: string,
    dto: UpdateCareerDto,
    actor: AccessTokenPayload,
  ): Promise<Career> {
    const existing = await this.get(id, actor.schoolId);
    const updated = await this.careers.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined
        ? { description: sanitizeHtml(dto.description) }
        : {}),
      ...(dto.location !== undefined ? { location: dto.location } : {}),
      ...(dto.vacancies !== undefined ? { vacancies: dto.vacancies } : {}),
      ...(dto.deadline !== undefined
        ? { deadline: dto.deadline ? parseDate(dto.deadline) : null }
        : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Career',
      entityId: id,
      oldValues: { title: existing.title, status: existing.status },
      newValues: { title: updated.title, status: updated.status },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor.schoolId);
    await this.careers.softDelete(id);
    this.audit.set({
      entityType: 'Career',
      entityId: id,
      oldValues: { title: existing.title },
    });
    await this.cache.bust(actor.schoolId);
  }

  listApplications(
    schoolId: string,
    careerId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<CareerApplication>> {
    return this.applications.paginate(query, {
      schoolId,
      where: { careerId },
      searchColumns: ['name', 'phone', 'email'],
      sortableColumns: ['createdAt', 'name', 'status'],
    });
  }

  async updateApplication(
    id: string,
    dto: UpdateCareerApplicationDto,
    actor: AccessTokenPayload,
  ): Promise<CareerApplication> {
    const existing = await this.applications.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Application ${id} not found`);
    const updated = await this.applications.update(id, {
      status: dto.status,
      ...(dto.note !== undefined ? { note: dto.note } : {}),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'CareerApplication',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: dto.status },
    });
    return updated;
  }

  // ── public ──────────────────────────────────────────────────────────

  /**
   * A public application. The opening is re-resolved through the
   * published+open query rather than trusted from the client, so an id
   * scraped from a closed posting cannot be applied against.
   */
  async apply(
    schoolId: string,
    careerId: string,
    dto: PublicCareerApplyDto,
    file: Express.Multer.File | undefined,
  ): Promise<{ id: string; message: string }> {
    const career = await this.careers.publishedById(schoolId, careerId);
    if (!career) throw new NotFoundException('This job opening is not open');
    if (career.deadline && career.deadline < new Date(dhakaToday())) {
      throw new BadRequestException(
        'The application deadline for this opening has passed',
      );
    }

    const cfg = await this.config.load(schoolId);
    if (!file) throw new BadRequestException('A CV (PDF) is required');
    if (!CV_MIME.has(file.mimetype)) {
      throw new BadRequestException('The CV must be a PDF');
    }
    if (file.size > cfg.careerCvMaxMb * 1024 * 1024) {
      throw new BadRequestException(
        `The CV must be ${cfg.careerCvMaxMb} MB or smaller`,
      );
    }

    const stored = await this.storage.upload({
      body: file.buffer,
      contentType: file.mimetype,
      prefix: 'website/cv',
      filename: file.originalname,
      purpose: 'documents',
    });

    const created = await this.applications.create({
      schoolId,
      careerId,
      name: dto.name,
      phone: dto.phone,
      email: dto.email ?? null,
      cvUrl: stored.url,
      cvKey: stored.key,
      note: dto.note ?? null,
      status: CareerApplicationStatus.RECEIVED,
    });

    // Best-effort desk alert — a failed notification must never lose an
    // application that is already committed (the M07 fire-and-forget rule).
    await this.notifyOffice(schoolId, dto, career.title).catch(() => undefined);

    return {
      id: created.id,
      message: 'Application received. The school will contact you.',
    };
  }

  private async notifyOffice(
    schoolId: string,
    dto: PublicCareerApplyDto,
    position: string,
  ): Promise<void> {
    const admins = await this.people.adminUserIds(schoolId);
    await Promise.all(
      admins.map((userId) =>
        this.notifications.send({
          schoolId,
          code: 'CAREER_APPLICATION',
          channel: NotificationChannel.IN_APP,
          recipient: { type: NotificationRecipientType.USER, id: userId },
          vars: { name: dto.name, phone: dto.phone, position },
        }),
      ),
    );
  }
}
