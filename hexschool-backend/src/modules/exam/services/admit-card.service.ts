import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { UserType } from '../../../common/constants';
import { timeColumnMinutes } from '../../../common/utils/clock.util';
import { isoDate } from '../../academic/calendar/date.util';
import { ClassSubjectsRepository } from '../../academic/repositories/class-subjects.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import type { EnrollmentWithRelations } from '../../enrollment/repositories/enrollments.repository';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StorageService } from '../../storage/storage.service';
import { clock } from '../calc/exam-clash.engine';
import { AdmitCardBatchDto } from '../dto';
import {
  ExamSubjectsRepository,
  ExamSubjectWithRelations,
} from '../repositories/exam-subjects.repository';
import { SeatPlansRepository } from '../repositories/seat-plans.repository';
import { ExamSettingsService } from './exam-settings.service';
import { EXAM_DUES_GATE } from './exam.gates';
import type { ExamDuesGate } from './exam.gates';
import { ExamsService } from './exams.service';

export interface AdmitCardResult {
  pdf: Buffer;
  issued: number;
  /** Cards printed without a photo (flagged incomplete — the M09 rule). */
  incomplete: Array<{ studentUid: string; studentName: string }>;
  /** Candidates refused because of outstanding dues (Module 16). */
  blocked: Array<{
    studentUid: string;
    studentName: string;
    outstanding?: number;
  }>;
}

const PAGE_MARGIN = 36;

/**
 * Admit cards (roadmap M14 §4): one A4 page per candidate carrying the
 * student's identity and photo, the full sitting schedule of their class,
 * their seat, and signature blocks.
 *
 * Two policies worth noting:
 *   - a missing photo never blocks issuance — the card prints with a
 *     placeholder and is reported as incomplete (the M09 ID-card rule);
 *   - the dues block is real code behind an inert gate. Module 16 binds
 *     `EXAM_DUES_GATE` and `exam.admit_card_block_dues` starts biting
 *     without a change here.
 */
@Injectable()
export class AdmitCardService {
  private readonly logger = new Logger(AdmitCardService.name);

  constructor(
    private readonly examSubjects: ExamSubjectsRepository,
    private readonly seatPlans: SeatPlansRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly schools: SchoolsRepository,
    private readonly storage: StorageService,
    private readonly exams: ExamsService,
    private readonly config: ExamSettingsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
    @Inject(EXAM_DUES_GATE) private readonly duesGate: ExamDuesGate,
  ) {}

  async generate(
    examId: string,
    dto: AdmitCardBatchDto,
    actor: AccessTokenPayload,
  ): Promise<AdmitCardResult> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);

    const papers = await this.examSubjects.findForExam(examId);
    if (papers.every((p) => p.examDate === null)) {
      throw new BadRequestException(
        'This exam has no scheduled sittings — build the routine before issuing admit cards',
      );
    }

    const candidates = await this.resolveCandidates(exam, dto, schoolId);
    if (candidates.length === 0) {
      throw new BadRequestException(
        'No active candidates matched that selection',
      );
    }

    const blocked = await this.applyDuesPolicy(candidates, dto, actor);
    const blockedIds = new Set(blocked.map((b) => b.enrollmentId));
    const issuable = candidates.filter((c) => !blockedIds.has(c.id));
    if (issuable.length === 0) {
      throw new ConflictException({
        message: 'Every selected candidate has outstanding dues',
        details: { blocked: blocked.length },
      });
    }

    const [school, config, seats] = await Promise.all([
      this.schools.findByIdOrFail(schoolId),
      this.config.load(schoolId),
      this.seatPlans.findSeatsForEnrollments(
        examId,
        issuable.map((c) => c.id),
      ),
    ]);

    const seatsByEnrollment = new Map<string, typeof seats>();
    for (const seat of seats) {
      seatsByEnrollment.set(seat.enrollmentId, [
        ...(seatsByEnrollment.get(seat.enrollmentId) ?? []),
        seat,
      ]);
    }

    const logo = school.logoUrl
      ? await this.fetchImage(school.logoUrl, 'branding')
      : null;

    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      autoFirstPage: false,
      info: { Title: `Admit cards — ${exam.name}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Optional-subject map per attached class, resolved once.
    const optionalByClass = new Map<string, Set<string>>();
    for (const classId of new Set(issuable.map((c) => c.classId))) {
      optionalByClass.set(
        classId,
        await this.optionalSubjectIds(classId, exam.sessionId, schoolId),
      );
    }

    const incomplete: AdmitCardResult['incomplete'] = [];
    for (const candidate of issuable) {
      const photo = candidate.student.photoUrl
        ? await this.fetchImage(candidate.student.photoUrl, 'photos')
        : null;
      const name = `${candidate.student.firstName} ${candidate.student.lastName}`;
      if (!photo) {
        incomplete.push({
          studentUid: candidate.student.studentUid,
          studentName: name,
        });
      }

      this.drawCard(doc, {
        examName: exam.name,
        examTypeName: exam.examType.name,
        sessionName: exam.session.name,
        schoolName: school.name,
        schoolAddress: school.address ?? '',
        instructions: config.admitCardInstructions,
        candidate,
        photo,
        logo,
        // A candidate only sits their own class's papers.
        sittings: papers
          .filter((p) => p.classId === candidate.classId && p.examDate !== null)
          .filter((p) =>
            this.sitsPaper(
              candidate,
              p,
              optionalByClass.get(candidate.classId) ?? new Set(),
            ),
          )
          .sort(this.byDateTime),
        seats: seatsByEnrollment.get(candidate.id) ?? [],
      });
    }
    doc.end();
    const pdf = await done;

    this.auditContext.set({
      entityType: 'Exam',
      entityId: examId,
      newValues: {
        action: 'ISSUE_ADMIT_CARDS',
        issued: issuable.length,
        incomplete: incomplete.length,
        blocked: blocked.length,
        ...(dto.ignoreDues ? { duesOverride: true } : {}),
      },
    });

    return {
      pdf,
      issued: issuable.length,
      incomplete,
      blocked: blocked.map((b) => ({
        studentUid: b.studentUid,
        studentName: b.studentName,
        outstanding: b.outstanding,
      })),
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async resolveCandidates(
    exam: {
      id: string;
      sessionId: string;
      examClasses: Array<{ classId: string }>;
    },
    dto: AdmitCardBatchDto,
    schoolId: string,
  ): Promise<EnrollmentWithRelations[]> {
    const selectors = [dto.sectionId, dto.classId, dto.enrollmentIds].filter(
      (s) => s !== undefined,
    );
    if (selectors.length !== 1) {
      throw new BadRequestException(
        'Choose exactly one of sectionId, classId or enrollmentIds',
      );
    }

    const attached = new Set(exam.examClasses.map((c) => c.classId));

    if (dto.enrollmentIds) {
      const rows: EnrollmentWithRelations[] = [];
      for (const id of dto.enrollmentIds) {
        const row = await this.enrollments.findDetail(id, schoolId);
        if (row && attached.has(row.classId)) rows.push(row);
      }
      return rows;
    }

    if (dto.sectionId) {
      const roster = await this.enrollments.findSectionRoster(
        dto.sectionId,
        schoolId,
      );
      return roster.filter((r) => attached.has(r.classId));
    }

    if (!attached.has(dto.classId!)) {
      throw new BadRequestException('That class does not sit this exam');
    }
    return this.enrollments.findClassRoster(
      dto.classId!,
      exam.sessionId,
      schoolId,
    );
  }

  /**
   * The Module 16 hook. When the setting is on and the gate reports dues,
   * a candidate is refused unless the caller both asked to ignore dues
   * and holds `exam.admit-card.dues-override`.
   */
  private async applyDuesPolicy(
    candidates: EnrollmentWithRelations[],
    dto: AdmitCardBatchDto,
    actor: AccessTokenPayload,
  ): Promise<
    Array<{
      enrollmentId: string;
      studentUid: string;
      studentName: string;
      outstanding?: number;
    }>
  > {
    const config = await this.config.load(actor.schoolId);
    if (!config.blockAdmitCardOnDues) return [];

    if (dto.ignoreDues) {
      await this.assertDuesOverrideAllowed(actor);
      return [];
    }

    const statuses = await this.duesGate.check(
      candidates.map((c) => c.id),
      actor.schoolId,
    );
    const withDues = new Map(
      statuses.filter((s) => s.hasDues).map((s) => [s.enrollmentId, s]),
    );

    return candidates
      .filter((c) => withDues.has(c.id))
      .map((c) => ({
        enrollmentId: c.id,
        studentUid: c.student.studentUid,
        studentName: `${c.student.firstName} ${c.student.lastName}`,
        outstanding: withDues.get(c.id)?.outstanding,
      }));
  }

  private async assertDuesOverrideAllowed(
    actor: AccessTokenPayload,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes('exam.admit-card.dues-override')) {
      throw new ForbiddenException(
        'Issuing an admit card despite dues requires exam.admit-card.dues-override',
      );
    }
  }

  /**
   * A candidate sits every compulsory paper of their class plus the one
   * optional subject they chose (roadmap §6) — printing the whole
   * optional block on every card would send students to papers they are
   * not registered for.
   */
  private sitsPaper(
    candidate: EnrollmentWithRelations,
    paper: ExamSubjectWithRelations,
    optionalSubjectIds: Set<string>,
  ): boolean {
    if (!optionalSubjectIds.has(paper.subjectId)) return true;
    return candidate.optionalSubjectId === paper.subjectId;
  }

  /** Subject ids mapped as optional (4th subject) for a class this session. */
  private async optionalSubjectIds(
    classId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<Set<string>> {
    const curriculum = await this.classSubjects.findForClassSession(
      classId,
      sessionId,
      schoolId,
    );
    return new Set(
      curriculum.filter((row) => row.isOptional).map((row) => row.subjectId),
    );
  }

  private byDateTime = (
    a: ExamSubjectWithRelations,
    b: ExamSubjectWithRelations,
  ): number => {
    const dateDiff =
      (a.examDate?.getTime() ?? 0) - (b.examDate?.getTime() ?? 0);
    if (dateDiff !== 0) return dateDiff;
    return (
      (a.startTime ? timeColumnMinutes(a.startTime) : 0) -
      (b.startTime ? timeColumnMinutes(b.startTime) : 0)
    );
  };

  private drawCard(
    doc: PDFKit.PDFDocument,
    data: {
      examName: string;
      examTypeName: string;
      sessionName: string;
      schoolName: string;
      schoolAddress: string;
      instructions: string;
      candidate: EnrollmentWithRelations;
      photo: Buffer | null;
      logo: Buffer | null;
      sittings: ExamSubjectWithRelations[];
      seats: Array<{ date: Date; room: string; seatNo: number }>;
    },
  ): void {
    doc.addPage({ size: 'A4', margin: PAGE_MARGIN });
    const width = doc.page.width - PAGE_MARGIN * 2;
    const left = PAGE_MARGIN;

    // ── header ──
    if (data.logo) {
      try {
        doc.image(data.logo, left, PAGE_MARGIN, { fit: [46, 46] });
      } catch {
        // A non-decodable logo never blocks a card.
      }
    }
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(data.schoolName, left + (data.logo ? 56 : 0), PAGE_MARGIN, {
        width: width - (data.logo ? 56 : 0),
      });
    if (data.schoolAddress) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#6b7280')
        .text(data.schoolAddress, { width: width - (data.logo ? 56 : 0) });
    }

    doc.moveDown(0.8);
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#1e3a5f')
      .text('ADMIT CARD', left, doc.y, { width, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#374151')
      .text(`${data.examName} · ${data.examTypeName} · ${data.sessionName}`, {
        width,
        align: 'center',
      });

    doc.moveDown(0.8);
    const detailsTop = doc.y;

    // ── photo box ──
    const photoW = 84;
    const photoH = 100;
    const photoX = left + width - photoW;
    doc
      .rect(photoX, detailsTop, photoW, photoH)
      .fillAndStroke('#f3f4f6', '#d1d5db');
    if (data.photo) {
      try {
        doc.image(data.photo, photoX + 2, detailsTop + 2, {
          fit: [photoW - 4, photoH - 4],
          align: 'center',
          valign: 'center',
        });
      } catch {
        this.logger.warn(
          `Undecodable photo for student ${data.candidate.student.studentUid}`,
        );
      }
    } else {
      doc
        .fillColor('#9ca3af')
        .font('Helvetica')
        .fontSize(8)
        .text('PHOTO\nMISSING', photoX, detailsTop + 40, {
          width: photoW,
          align: 'center',
        });
    }

    // ── candidate details ──
    const student = data.candidate.student;
    const rows: Array<[string, string]> = [
      ['Name', `${student.firstName} ${student.lastName}`],
      ['Student ID', student.studentUid],
      ['Class', data.candidate.class.name],
      ['Section', data.candidate.section.name],
      ['Roll No', String(data.candidate.rollNo)],
      ...(data.candidate.group
        ? ([['Group', data.candidate.group.name]] as Array<[string, string]>)
        : []),
      ...(data.candidate.optionalSubject
        ? ([['Optional Subject', data.candidate.optionalSubject.name]] as Array<
            [string, string]
          >)
        : []),
    ];

    let y = detailsTop + 4;
    for (const [label, value] of rows) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#6b7280')
        .text(label, left, y, { width: 100 });
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#111827')
        .text(value, left + 104, y - 1, {
          width: width - photoW - 116,
          ellipsis: true,
          lineBreak: false,
        });
      y += 15;
    }

    doc.y = Math.max(y, detailsTop + photoH) + 12;

    // ── sitting schedule ──
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text('Examination schedule', left, doc.y);
    doc.moveDown(0.3);

    const seatByDate = new Map(data.seats.map((s) => [isoDate(s.date), s]));
    const columns = [
      { title: 'Date', width: 74 },
      { title: 'Subject', width: width - 74 - 96 - 60 - 90 },
      { title: 'Time', width: 96 },
      { title: 'Full Marks', width: 60 },
      { title: 'Room / Seat', width: 90 },
    ];

    const writeRow = (cells: string[], bold: boolean): void => {
      if (doc.y > doc.page.height - 150)
        doc.addPage({ size: 'A4', margin: PAGE_MARGIN });
      const top = doc.y;
      let x = left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      doc.fillColor(bold ? '#111827' : '#374151');
      cells.forEach((cell, i) => {
        doc.text(cell, x, top, {
          width: columns[i].width - 4,
          ellipsis: true,
          lineBreak: false,
        });
        x += columns[i].width;
      });
      doc.y = top + 14;
    };

    writeRow(
      columns.map((c) => c.title),
      true,
    );
    doc
      .moveTo(left, doc.y - 3)
      .lineTo(left + width, doc.y - 3)
      .strokeColor('#9ca3af')
      .stroke();

    if (data.sittings.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .text('No sittings scheduled.', left, doc.y);
    }
    for (const paper of data.sittings) {
      const date = isoDate(paper.examDate!);
      const start = paper.startTime ? timeColumnMinutes(paper.startTime) : 0;
      const seat = seatByDate.get(date);
      writeRow(
        [
          date,
          paper.subject.name,
          `${clock(start)} – ${clock(start + (paper.durationMin ?? 0))}`,
          String(paper.fullMarks),
          seat ? `${seat.room} / ${seat.seatNo}` : (paper.room ?? '—'),
        ],
        false,
      );
    }

    // ── instructions ──
    if (data.instructions) {
      doc.moveDown(1);
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#111827')
        .text('Instructions', left, doc.y);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#374151')
        .text(data.instructions, left, doc.y + 2, { width });
    }

    // ── signature blocks ──
    const signY = Math.max(doc.y + 40, doc.page.height - 110);
    const blockW = (width - 40) / 3;
    ['Candidate', 'Class Teacher', 'Principal'].forEach((role, i) => {
      const x = left + i * (blockW + 20);
      doc
        .moveTo(x, signY)
        .lineTo(x + blockW, signY)
        .strokeColor('#6b7280')
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#6b7280')
        .text(role, x, signY + 4, { width: blockW, align: 'center' });
    });
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
