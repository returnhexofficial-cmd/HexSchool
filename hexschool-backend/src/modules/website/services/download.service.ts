import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Download } from '@prisma/client';
import { WebContentStatus } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StorageService } from '../../storage/storage.service';
import { CreateDownloadDto, UpdateDownloadDto } from '../dto';
import { DownloadsRepository } from '../repositories/cms-content.repository';
import { WebsiteCacheService } from './website-cache.service';

/** Files a school publishes for download (syllabus, forms, routines). */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class DownloadService {
  constructor(
    private readonly downloads: DownloadsRepository,
    private readonly storage: StorageService,
    private readonly audit: AuditContextService,
    private readonly cache: WebsiteCacheService,
  ) {}

  list(
    schoolId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Download>> {
    return this.downloads.paginate(query, {
      schoolId,
      searchColumns: ['title', 'category'],
      sortableColumns: ['createdAt', 'title', 'displayOrder', 'downloadCount'],
    });
  }

  async get(id: string, schoolId: string): Promise<Download> {
    const row = await this.downloads.findById(id, schoolId);
    if (!row) throw new NotFoundException(`Download ${id} not found`);
    return row;
  }

  /** Uploads the file itself; the returned url/key feed `create`. */
  async upload(
    file: Express.Multer.File | undefined,
  ): Promise<{ fileUrl: string; fileKey: string; sizeBytes: number }> {
    if (!file) throw new BadRequestException('A file is required');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Only PDF, Word, Excel, JPG and PNG files may be published',
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('File must be 20 MB or smaller');
    }
    const result = await this.storage.upload({
      body: file.buffer,
      contentType: file.mimetype,
      prefix: 'website/downloads',
      filename: file.originalname,
      purpose: 'documents',
    });
    return {
      fileUrl: result.url,
      fileKey: result.key,
      sizeBytes: file.size,
    };
  }

  async create(
    dto: CreateDownloadDto,
    actor: AccessTokenPayload,
  ): Promise<Download> {
    const created = await this.downloads.create({
      schoolId: actor.schoolId,
      title: dto.title,
      titleBn: dto.titleBn ?? null,
      category: dto.category ?? null,
      fileUrl: dto.fileUrl,
      fileKey: dto.fileKey ?? null,
      sizeBytes: dto.sizeBytes ?? null,
      status: dto.status ?? WebContentStatus.DRAFT,
      displayOrder: dto.displayOrder ?? 0,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Download',
      entityId: created.id,
      newValues: { title: created.title, status: created.status },
    });
    await this.cache.bust(actor.schoolId);
    return created;
  }

  async update(
    id: string,
    dto: UpdateDownloadDto,
    actor: AccessTokenPayload,
  ): Promise<Download> {
    const existing = await this.get(id, actor.schoolId);
    const updated = await this.downloads.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.titleBn !== undefined ? { titleBn: dto.titleBn } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.fileUrl !== undefined ? { fileUrl: dto.fileUrl } : {}),
      ...(dto.fileKey !== undefined ? { fileKey: dto.fileKey } : {}),
      ...(dto.sizeBytes !== undefined ? { sizeBytes: dto.sizeBytes } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Download',
      entityId: id,
      oldValues: { title: existing.title, status: existing.status },
      newValues: { title: updated.title, status: updated.status },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor.schoolId);
    await this.downloads.softDelete(id);
    // The S3 object goes with the row (the M07/M09 document convention).
    if (existing.fileKey) {
      await this.storage
        .delete(existing.fileKey, 'documents')
        .catch(() => undefined);
    }
    this.audit.set({
      entityType: 'Download',
      entityId: id,
      oldValues: { title: existing.title },
    });
    await this.cache.bust(actor.schoolId);
  }
}
