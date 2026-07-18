import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { AdmissionApplicationStatus } from '../../../common/constants';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StorageService } from '../../storage/storage.service';
import {
  AdmissionApplicationsRepository,
  ApplicationWithRelations,
} from '../repositories/admission-applications.repository';
import { AdmissionTestsRepository } from '../repositories/admission-tests.repository';

/** A5 landscape (595 × 420 pt) — prints two per A4 sheet. */
const PAGE_W = 595;
const PAGE_H = 420;
const MARGIN = 28;

/** Admit card exists from the moment the test is scheduled onward. */
const ELIGIBLE = new Set<AdmissionApplicationStatus>([
  AdmissionApplicationStatus.TEST_SCHEDULED,
  AdmissionApplicationStatus.PASSED,
  AdmissionApplicationStatus.FAILED,
  AdmissionApplicationStatus.SELECTED,
  AdmissionApplicationStatus.WAITLISTED,
  AdmissionApplicationStatus.ADMITTED,
]);

/**
 * Admission-test admit card PDF (roadmap M10 §4): school branding, the
 * application number doubles as the test roll, test date/venue, photo.
 * Downloaded from the public portal (app no + phone) and the admin desk.
 */
@Injectable()
export class AdmitCardService {
  private readonly logger = new Logger(AdmitCardService.name);

  constructor(
    private readonly applications: AdmissionApplicationsRepository,
    private readonly tests: AdmissionTestsRepository,
    private readonly schools: SchoolsRepository,
    private readonly storage: StorageService,
  ) {}

  async generateById(id: string, schoolId: string): Promise<Buffer> {
    const app = await this.applications.findDetail(id, schoolId);
    if (!app) throw new NotFoundException(`Application ${id} not found`);
    return this.generate(app);
  }

  async generateForApplicant(
    appNo: string,
    phone: string,
    schoolId: string,
  ): Promise<Buffer> {
    const app = await this.applications.findByAppNoAndPhone(
      appNo,
      phone,
      schoolId,
    );
    if (!app) {
      throw new NotFoundException(
        'No application found for that number and phone',
      );
    }
    return this.generate(app);
  }

  private async generate(app: ApplicationWithRelations): Promise<Buffer> {
    if (!ELIGIBLE.has(app.status)) {
      throw new ConflictException(
        'Admit card is available once the admission test is scheduled',
      );
    }
    const test = await this.tests.findForCycleClass(app.cycleId, app.classId);
    if (!test) {
      throw new ConflictException(
        'No admission test is scheduled for this class',
      );
    }
    const school = await this.schools.findByIdOrFail(app.schoolId);
    const logo = school.logoUrl
      ? await this.fetchImage(school.logoUrl, 'branding')
      : null;
    const photo = app.photoUrl
      ? await this.fetchImage(app.photoUrl, 'photos')
      : null;

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margin: 0,
      info: { Title: `Admit Card ${app.applicationNo}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Header band.
    doc.rect(0, 0, PAGE_W, 64).fill('#1e3a5f');
    if (logo) {
      try {
        doc.image(logo, MARGIN, 12, { fit: [40, 40] });
      } catch {
        // Undecodable logo never blocks the card.
      }
    }
    const headX = logo ? MARGIN + 52 : MARGIN;
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(school.name, headX, 14, { width: PAGE_W - headX - MARGIN });
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('ADMISSION TEST ADMIT CARD', headX, 38);

    // Photo box (right).
    const photoW = 96;
    const photoH = 120;
    const photoX = PAGE_W - MARGIN - photoW;
    const photoY = 84;
    doc
      .rect(photoX, photoY, photoW, photoH)
      .fillAndStroke('#f0f2f5', '#c8ccd4');
    if (photo) {
      try {
        doc.image(photo, photoX + 2, photoY + 2, {
          fit: [photoW - 4, photoH - 4],
          align: 'center',
          valign: 'center',
        });
      } catch {
        this.logger.warn(`Undecodable photo for application ${app.id}`);
      }
    } else {
      doc
        .fillColor('#9aa1ad')
        .font('Helvetica')
        .fontSize(8)
        .text('PHOTO', photoX, photoY + 52, {
          width: photoW,
          align: 'center',
        });
    }

    // Details.
    const rows: Array<[string, string]> = [
      ['Test Roll / Application No', app.applicationNo],
      ['Applicant Name', `${app.firstName} ${app.lastName}`],
      ['Applying for', app.class.name],
      ['Admission Cycle', app.cycle.name],
      ['Test Date', test.testDate.toISOString().slice(0, 10)],
      ['Venue', test.venue ?? 'To be announced'],
      ['Total Marks', String(test.totalMarks)],
      ['Contact Phone', app.phone],
    ];
    let y = 92;
    for (const [label, value] of rows) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#6b7280')
        .text(label, MARGIN, y);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#111827')
        .text(value, MARGIN + 170, y - 1, {
          width: PAGE_W - MARGIN * 2 - 170 - photoW - 12,
          ellipsis: true,
        });
      y += 24;
    }

    // Instructions + signature line.
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#6b7280')
      .text(
        'Bring this admit card and a pen on test day. Arrive 30 minutes early. Mobile phones are not allowed in the exam hall.',
        MARGIN,
        PAGE_H - 84,
        { width: PAGE_W - MARGIN * 2 },
      );
    doc
      .moveTo(PAGE_W - MARGIN - 160, PAGE_H - 46)
      .lineTo(PAGE_W - MARGIN, PAGE_H - 46)
      .stroke('#9aa1ad');
    doc
      .fontSize(8)
      .text('Authorized Signature', PAGE_W - MARGIN - 160, PAGE_H - 40, {
        width: 160,
        align: 'center',
      });

    doc.end();
    return done;
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
