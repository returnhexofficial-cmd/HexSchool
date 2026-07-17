import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StaffDocument } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StorageService } from '../../storage/storage.service';
import { UploadStaffDocumentDto } from '../dto';
import { StaffDocumentsRepository } from '../repositories/staff-documents.repository';
import { StaffProfilesRepository } from '../repositories/staff-profiles.repository';

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);

export interface StaffDocumentWithUrl extends StaffDocument {
  signedUrl: string;
}

/** Staff paperwork uploads (pdf/jpg/png ≤10 MB — roadmap M07 §4). */
@Injectable()
export class StaffDocumentsService {
  constructor(
    private readonly documents: StaffDocumentsRepository,
    private readonly staffProfiles: StaffProfilesRepository,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    staffId: string,
    schoolId: string,
  ): Promise<StaffDocumentWithUrl[]> {
    await this.staffProfiles.findByIdOrFail(staffId, schoolId);
    const docs = await this.documents.listForStaff(staffId);
    return Promise.all(
      docs.map(async (doc) => ({
        ...doc,
        signedUrl: await this.storage.getSignedUrl(
          doc.fileUrl,
          3600,
          'documents',
        ),
      })),
    );
  }

  async upload(
    staffId: string,
    dto: UploadStaffDocumentDto,
    file:
      | {
          buffer: Buffer;
          mimetype: string;
          size: number;
          originalname?: string;
        }
      | undefined,
    actor: AccessTokenPayload,
  ): Promise<StaffDocumentWithUrl> {
    await this.staffProfiles.findByIdOrFail(staffId, actor.schoolId);
    if (!file) throw new BadRequestException('Document file is required');
    const ext = DOCUMENT_MIME_TYPES.get(file.mimetype);
    if (!ext) {
      throw new BadRequestException('Documents must be PDF, JPEG, or PNG');
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      throw new BadRequestException('Documents must be 10 MB or smaller');
    }

    const uploaded = await this.storage.upload({
      body: file.buffer,
      contentType: file.mimetype,
      prefix: `staff/${actor.schoolId}/${staffId}/documents`,
      filename: `document${ext}`,
      purpose: 'documents',
    });

    const doc = await this.documents.create({
      schoolId: actor.schoolId,
      staffId,
      title: dto.title,
      type: dto.type,
      fileUrl: uploaded.key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'StaffDocument',
      entityId: doc.id,
      newValues: { staffId, title: dto.title, type: doc.type },
    });
    return { ...doc, signedUrl: uploaded.url };
  }

  /** Hard delete: row + S3 object (audit trail keeps the history). */
  async remove(
    staffId: string,
    documentId: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    await this.staffProfiles.findByIdOrFail(staffId, actor.schoolId);
    const doc = await this.documents.findOne(
      { id: documentId, staffId },
      actor.schoolId,
    );
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    await this.documents.hardDelete(documentId);
    // Best-effort: an orphaned S3 object is harmless; a dangling DB row
    // pointing at nothing is not — so the row goes first.
    await this.storage.delete(doc.fileUrl, 'documents').catch(() => undefined);

    this.auditContext.set({
      entityType: 'StaffDocument',
      entityId: documentId,
      oldValues: { staffId, title: doc.title, type: doc.type },
    });
  }
}
