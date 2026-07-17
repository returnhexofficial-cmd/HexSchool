import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StorageService } from '../../storage/storage.service';
import {
  StudentsRepository,
  StudentWithRelations,
} from '../repositories/students.repository';

/** CR80 card: 85.6 × 53.98 mm → PDF points (1 mm = 2.83465 pt). */
const CARD_W = 242.65;
const CARD_H = 153.0;
const MARGIN = 8;

export interface IdCardBatchResult {
  pdf: Buffer;
  /** Cards printed without a photo (flagged incomplete — M09 §8). */
  incomplete: Array<{ studentId: string; studentUid: string }>;
}

/**
 * Student ID card PDFs (roadmap M09): CR80 layout, one card per page
 * (print shops impose the sheet), school branding from the M04 profile,
 * QR encoding the rotatable qr_token (never the row id). Missing photo →
 * placeholder + card flagged incomplete, generation never blocks.
 */
@Injectable()
export class IdCardService {
  private readonly logger = new Logger(IdCardService.name);

  constructor(
    private readonly students: StudentsRepository,
    private readonly schools: SchoolsRepository,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
  ) {}

  async generateSingle(
    studentId: string,
    actor: AccessTokenPayload,
  ): Promise<IdCardBatchResult> {
    const student = await this.students.findDetail(studentId, actor.schoolId);
    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }
    return this.generate([student], actor);
  }

  async generateBatch(
    studentIds: string[],
    actor: AccessTokenPayload,
  ): Promise<IdCardBatchResult> {
    const students = await this.students.findManyDetailed(
      studentIds,
      actor.schoolId,
    );
    if (students.length === 0) {
      throw new NotFoundException('No matching students found');
    }
    return this.generate(students, actor);
  }

  private async generate(
    students: StudentWithRelations[],
    actor: AccessTokenPayload,
  ): Promise<IdCardBatchResult> {
    const school = await this.schools.findByIdOrFail(actor.schoolId);

    const logo = school.logoUrl
      ? await this.fetchImage(school.logoUrl, 'branding')
      : null;

    const doc = new PDFDocument({
      size: [CARD_W, CARD_H],
      margin: 0,
      autoFirstPage: false,
      info: { Title: 'HexSchool Student ID Cards' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const incomplete: Array<{ studentId: string; studentUid: string }> = [];
    for (const student of students) {
      const photo = student.photoUrl
        ? await this.fetchImage(student.photoUrl, 'photos')
        : null;
      if (!photo) {
        incomplete.push({
          studentId: student.id,
          studentUid: student.studentUid,
        });
      }
      const qr = await QRCode.toBuffer(student.qrToken, {
        errorCorrectionLevel: 'M',
        margin: 0,
        width: 120,
      });
      this.drawCard(doc, student, school.name, logo, photo, qr);
    }
    doc.end();
    const pdf = await done;

    this.auditContext.set({
      entityType: 'StudentIdCard',
      entityId: students[0].id,
      newValues: {
        cards: students.length,
        incomplete: incomplete.length,
        studentUids: students.slice(0, 20).map((s) => s.studentUid),
      },
    });

    return { pdf, incomplete };
  }

  private drawCard(
    doc: PDFKit.PDFDocument,
    student: StudentWithRelations,
    schoolName: string,
    logo: Buffer | null,
    photo: Buffer | null,
    qr: Buffer,
  ): void {
    doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });

    // Header band with school identity.
    doc.rect(0, 0, CARD_W, 30).fill('#1e3a5f');
    if (logo) {
      try {
        doc.image(logo, MARGIN, 5, { fit: [20, 20] });
      } catch {
        // Non-decodable logo never blocks card generation.
      }
    }
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(schoolName, logo ? MARGIN + 24 : MARGIN, 7, {
        width: CARD_W - (logo ? MARGIN + 24 : MARGIN) - MARGIN,
        height: 20,
        ellipsis: true,
      });
    doc
      .fontSize(5.5)
      .font('Helvetica')
      .text('STUDENT IDENTITY CARD', logo ? MARGIN + 24 : MARGIN, 20);

    // Photo box.
    const photoX = MARGIN;
    const photoY = 38;
    const photoW = 58;
    const photoH = 70;
    doc
      .rect(photoX, photoY, photoW, photoH)
      .fillAndStroke('#f0f2f5', '#c8ccd4');
    if (photo) {
      try {
        doc.image(photo, photoX + 1, photoY + 1, {
          fit: [photoW - 2, photoH - 2],
          align: 'center',
          valign: 'center',
        });
      } catch {
        this.logger.warn(`Undecodable photo for student ${student.id}`);
      }
    } else {
      doc
        .fillColor('#9aa1ad')
        .font('Helvetica')
        .fontSize(6)
        .text('PHOTO\nMISSING', photoX, photoY + 26, {
          width: photoW,
          align: 'center',
        });
    }

    // Detail column.
    const infoX = photoX + photoW + 8;
    const infoW = CARD_W - infoX - 58 - MARGIN;
    let y = 38;
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`${student.firstName} ${student.lastName}`, infoX, y, {
        width: infoW + 50,
        ellipsis: true,
      });
    y += 16;

    const rows: Array<[string, string]> = [
      ['ID', student.studentUid],
      ['Class', student.admissionClass?.name ?? '—'],
      ['Date of Birth', this.formatDate(student.dob)],
      ['Blood Group', student.bloodGroup ?? '—'],
      [
        'Guardian',
        student.guardians.find((g) => g.isPrimary)?.guardian.name ?? '—',
      ],
    ];
    for (const [label, value] of rows) {
      doc
        .font('Helvetica')
        .fontSize(6.5)
        .fillColor('#6b7280')
        .text(label, infoX, y);
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor('#111827')
        .text(value, infoX + 48, y - 1, { width: infoW, ellipsis: true });
      y += 12;
    }

    // QR (verification token) bottom-right.
    doc.image(qr, CARD_W - 52 - MARGIN, CARD_H - 52 - MARGIN - 6, {
      width: 52,
      height: 52,
    });

    // Footer strip.
    doc.rect(0, CARD_H - 12, CARD_W, 12).fill('#1e3a5f');
    doc
      .fillColor('#ffffff')
      .font('Helvetica')
      .fontSize(5)
      .text(
        'If found, please return to the school office.',
        MARGIN,
        CARD_H - 9,
      );
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private async fetchImage(
    key: string,
    purpose: string,
  ): Promise<Buffer | null> {
    try {
      return await this.storage.download(key, purpose);
    } catch (err) {
      this.logger.warn(
        `Could not fetch image ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
