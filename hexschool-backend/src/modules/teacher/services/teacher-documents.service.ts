import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TeacherDocument } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StorageService } from '../../storage/storage.service';
import { UploadTeacherDocumentDto } from '../dto';
import { TeacherDocumentsRepository } from '../repositories/teacher-documents.repository';
import { TeachersRepository } from '../repositories/teachers.repository';

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);

export interface TeacherDocumentWithUrl extends TeacherDocument {
  signedUrl: string;
}

/** Teacher paperwork — same contract as staff documents (M07). */
@Injectable()
export class TeacherDocumentsService {
  constructor(
    private readonly documents: TeacherDocumentsRepository,
    private readonly teachers: TeachersRepository,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    teacherId: string,
    schoolId: string,
  ): Promise<TeacherDocumentWithUrl[]> {
    await this.teachers.findByIdOrFail(teacherId, schoolId);
    const docs = await this.documents.listForTeacher(teacherId);
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
    teacherId: string,
    dto: UploadTeacherDocumentDto,
    file:
      | {
          buffer: Buffer;
          mimetype: string;
          size: number;
          originalname?: string;
        }
      | undefined,
    actor: AccessTokenPayload,
  ): Promise<TeacherDocumentWithUrl> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);
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
      prefix: `teachers/${actor.schoolId}/${teacherId}/documents`,
      filename: `document${ext}`,
      purpose: 'documents',
    });

    const doc = await this.documents.create({
      schoolId: actor.schoolId,
      teacherId,
      title: dto.title,
      type: dto.type,
      fileUrl: uploaded.key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'TeacherDocument',
      entityId: doc.id,
      newValues: { teacherId, title: dto.title, type: doc.type },
    });
    return { ...doc, signedUrl: uploaded.url };
  }

  async remove(
    teacherId: string,
    documentId: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);
    const doc = await this.documents.findOne(
      { id: documentId, teacherId },
      actor.schoolId,
    );
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    await this.documents.hardDelete(documentId);
    await this.storage.delete(doc.fileUrl, 'documents').catch(() => undefined);

    this.auditContext.set({
      entityType: 'TeacherDocument',
      entityId: documentId,
      oldValues: { teacherId, title: doc.title, type: doc.type },
    });
  }
}
