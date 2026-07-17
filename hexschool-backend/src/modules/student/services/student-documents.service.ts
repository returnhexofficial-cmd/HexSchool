import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StudentDocument } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StorageService } from '../../storage/storage.service';
import { UploadStudentDocumentDto } from '../dto';
import { StudentDocumentsRepository } from '../repositories/student-documents.repository';
import { StudentsRepository } from '../repositories/students.repository';

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);

export interface StudentDocumentWithUrl extends StudentDocument {
  signedUrl: string;
}

/** Student paperwork — same contract as staff/teacher documents (M07/08). */
@Injectable()
export class StudentDocumentsService {
  constructor(
    private readonly documents: StudentDocumentsRepository,
    private readonly students: StudentsRepository,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    studentId: string,
    schoolId: string,
  ): Promise<StudentDocumentWithUrl[]> {
    await this.students.findByIdOrFail(studentId, schoolId);
    const docs = await this.documents.listForStudent(studentId);
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
    studentId: string,
    dto: UploadStudentDocumentDto,
    file:
      | {
          buffer: Buffer;
          mimetype: string;
          size: number;
          originalname?: string;
        }
      | undefined,
    actor: AccessTokenPayload,
  ): Promise<StudentDocumentWithUrl> {
    await this.students.findByIdOrFail(studentId, actor.schoolId);
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
      prefix: `students/${actor.schoolId}/${studentId}/documents`,
      filename: `document${ext}`,
      purpose: 'documents',
    });

    const doc = await this.documents.create({
      schoolId: actor.schoolId,
      studentId,
      title: dto.title,
      type: dto.type,
      fileUrl: uploaded.key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'StudentDocument',
      entityId: doc.id,
      newValues: { studentId, title: dto.title, type: doc.type },
    });
    return { ...doc, signedUrl: uploaded.url };
  }

  async remove(
    studentId: string,
    documentId: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    await this.students.findByIdOrFail(studentId, actor.schoolId);
    const doc = await this.documents.findOne(
      { id: documentId, studentId },
      actor.schoolId,
    );
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    await this.documents.hardDelete(documentId);
    await this.storage.delete(doc.fileUrl, 'documents').catch(() => undefined);

    this.auditContext.set({
      entityType: 'StudentDocument',
      entityId: documentId,
      oldValues: { studentId, title: doc.title, type: doc.type },
    });
  }
}
