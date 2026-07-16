import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { School } from '@prisma/client';
import sharp from 'sharp';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StorageService } from '../../storage/storage.service';
import { UpdateSchoolDto } from '../dto';
import { SchoolsRepository } from '../repositories/schools.repository';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_SIZE_PX = 512;
const LOGO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * School profile (roadmap M04): single record today, addressed by the
 * actor's school_id so Module 31 can go multi-school without API churn.
 */
@Injectable()
export class SchoolService {
  constructor(
    private readonly schools: SchoolsRepository,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
  ) {}

  async get(schoolId: string): Promise<School> {
    const school = await this.schools.findById(schoolId);
    if (!school) throw new NotFoundException('School not found');
    return school;
  }

  async update(
    dto: UpdateSchoolDto,
    actor: AccessTokenPayload,
  ): Promise<School> {
    const before = await this.get(actor.schoolId);
    const updated = await this.schools.update(actor.schoolId, {
      ...dto,
      updatedBy: actor.sub,
    });

    const changed = Object.keys(dto) as Array<keyof UpdateSchoolDto>;
    this.auditContext.set({
      entityType: 'School',
      entityId: actor.schoolId,
      oldValues: Object.fromEntries(changed.map((k) => [k, before[k]])),
      newValues: Object.fromEntries(changed.map((k) => [k, updated[k]])),
    });
    return updated;
  }

  /**
   * Logo upload: type/size validated, normalized to a 512px PNG (strips
   * EXIF as a side effect), stored via StorageModule.
   */
  async uploadLogo(
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    actor: AccessTokenPayload,
  ): Promise<School> {
    if (!file) throw new BadRequestException('Logo file is required');
    if (!LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo must be a JPEG, PNG, or WebP image');
    }
    if (file.size > LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo must be 2 MB or smaller');
    }

    let resized: Buffer;
    try {
      resized = await sharp(file.buffer)
        .resize(LOGO_SIZE_PX, LOGO_SIZE_PX, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException('File is not a decodable image');
    }

    const before = await this.get(actor.schoolId);
    const uploaded = await this.storage.upload({
      body: resized,
      contentType: 'image/png',
      prefix: `schools/${actor.schoolId}`,
      filename: 'logo.png',
      purpose: 'branding',
    });

    const updated = await this.schools.update(actor.schoolId, {
      logoUrl: uploaded.key, // store the stable key; sign URLs on read
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'School',
      entityId: actor.schoolId,
      oldValues: { logoUrl: before.logoUrl },
      newValues: { logoUrl: uploaded.key },
    });
    return updated;
  }

  /** Fresh signed URL for the stored logo key (1 h expiry), if any. */
  async logoSignedUrl(school: School): Promise<string | null> {
    if (!school.logoUrl) return null;
    return this.storage.getSignedUrl(school.logoUrl, 3600, 'branding');
  }
}
