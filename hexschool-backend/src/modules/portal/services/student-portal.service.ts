import { Injectable, NotFoundException } from '@nestjs/common';
import { dhakaToday } from '../../../common/utils/clock.util';
import { EnrollmentsService } from '../../enrollment/services/enrollments.service';
import { InvoicesRepository } from '../../fee/repositories/invoices.repository';
import { LedgerService } from '../../fee/services/ledger.service';
import { NoticesRepository } from '../../communication/repositories/notices.repository';
import type { ResultExportQueryDto } from '../../result/dto';
import { ResultExportService } from '../../result/services/result-export.service';
import { ResultReportsService } from '../../result/services/result-reports.service';
import { RoutineService } from '../../timetable/services/routine.service';
import { SessionsService } from '../../academic/services/sessions.service';
import { StudentDocumentsService } from '../../student/services/student-documents.service';
import { StudentsService } from '../../student/services/students.service';

// Indexed by JS getUTCDay() (0 = Sunday). The PG enum uses 3-letter codes.
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * The student experience, assembled from existing per-student services
 * (roadmap M18 §1 "mostly frontend composition"). Every method is keyed
 * on a `studentId` the caller has already proven ownership of (the portal
 * controller runs `OwnershipGuard` + `assertOwnsStudent` first), so the
 * same service serves a student reading themselves and a parent reading a
 * linked child.
 *
 * It reuses the already-scoped reads — `StudentsService.performanceHistory`
 * / `attendanceHistory`, `LedgerService.studentLedger`,
 * `RoutineService.sectionRoutine` — rather than re-querying, so the portal
 * can never disagree with the admin views.
 */
@Injectable()
export class StudentPortalService {
  constructor(
    private readonly students: StudentsService,
    private readonly enrollments: EnrollmentsService,
    private readonly ledger: LedgerService,
    private readonly invoices: InvoicesRepository,
    private readonly routine: RoutineService,
    private readonly sessions: SessionsService,
    private readonly notices: NoticesRepository,
    private readonly studentDocuments: StudentDocumentsService,
    private readonly resultReports: ResultReportsService,
    private readonly resultExports: ResultExportService,
  ) {}

  async overview(studentId: string, schoolId: string) {
    const session = await this.sessions.getCurrent(schoolId);
    const [detail, enrollment, attendance, performance, notices] =
      await Promise.all([
        this.students.getDetail(studentId, schoolId),
        session
          ? this.enrollments.getStudentCurrentEnrollment(
              studentId,
              session.id,
              schoolId,
            )
          : Promise.resolve(null),
        this.students.attendanceHistory(studentId, schoolId),
        this.students.performanceHistory(studentId, schoolId),
        this.notices.publishedFeed(schoolId, { take: 5 }),
      ]);

    const dues = session
      ? await this.ledger.studentLedger(studentId, schoolId, session.id)
      : null;

    const todayPeriods =
      enrollment && session
        ? await this.todayRoutine(enrollment.sectionId, session.id, schoolId)
        : [];

    const latestResult =
      performance.items
        .filter((r) => r.publishedAt !== null)
        .sort((a, b) => (b.publishedAt! > a.publishedAt! ? 1 : -1))[0] ?? null;

    return {
      student: {
        id: detail.id,
        name: `${detail.firstName} ${detail.lastName}`.trim(),
        studentUid: detail.studentUid,
        status: detail.status,
        photoUrl: detail.photoUrl ?? null,
      },
      enrollment: enrollment
        ? {
            className: enrollment.class.name,
            sectionName: enrollment.section.name,
            rollNo: enrollment.rollNo,
            groupName: enrollment.group?.name ?? null,
            shiftName: enrollment.shift?.name ?? null,
          }
        : null,
      attendance: {
        percentage: attendance.percentage,
        markedDays: attendance.markedDays,
        present: attendance.counts.PRESENT ?? 0,
        absent: attendance.counts.ABSENT ?? 0,
      },
      result: latestResult,
      averageGpa: performance.averageGpa,
      dues: dues
        ? { outstanding: dues.outstanding, totalBilled: dues.totalBilled }
        : { outstanding: 0, totalBilled: 0 },
      todayPeriods,
      notices: notices.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        pinned: n.pinned,
        createdAt: n.createdAt,
      })),
    };
  }

  attendance(studentId: string, schoolId: string) {
    return this.students.attendanceHistory(studentId, schoolId);
  }

  results(studentId: string, schoolId: string) {
    return this.students.performanceHistory(studentId, schoolId);
  }

  async dues(studentId: string, schoolId: string) {
    const session = await this.sessions.getCurrent(schoolId);
    const ledger = await this.ledger.studentLedger(
      studentId,
      schoolId,
      session?.id,
    );
    return {
      ...ledger,
      // What Pay Now can actually be pointed at. The ledger is a running
      // balance and carries no invoice ids, so without this the portal
      // would have nothing to select — and the M16 init refuses an id the
      // student does not own anyway.
      payableInvoices: await this.payableInvoices(ledger.enrollments, schoolId),
    };
  }

  /** Open invoices across every enrollment the student has held. */
  private async payableInvoices(enrollmentIds: string[], schoolId: string) {
    if (enrollmentIds.length === 0) return [];
    const rows = await this.invoices.findOutstanding(enrollmentIds, schoolId);
    return rows
      .map((invoice) => ({
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        dueDate: invoice.dueDate,
        payable: Number(invoice.payable),
        paidTotal: Number(invoice.paidTotal),
        outstanding:
          Math.round((Number(invoice.payable) - Number(invoice.paidTotal)) * 100) /
          100,
        status: invoice.status,
      }))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  }

  async routineFor(studentId: string, schoolId: string) {
    const session = await this.sessions.getCurrent(schoolId);
    // A school mid-setup has no current session yet (roadmap §8). Say so in
    // the payload, as the teacher overview already does — a portal landing
    // page must not 404 because the office has not finished configuring.
    if (!session) {
      return { available: false, reason: 'No current academic session' };
    }
    const enrollment = await this.enrollments.getStudentCurrentEnrollment(
      studentId,
      session.id,
      schoolId,
    );
    if (!enrollment) {
      return { available: false, reason: 'Not enrolled this session' };
    }
    const routine = await this.routine.sectionRoutine(
      enrollment.sectionId,
      { sessionId: session.id },
      schoolId,
    );
    return { available: true, ...routine };
  }

  /**
   * The portal Profile panel (roadmap M18 §5). Deliberately *not*
   * `getFull()` passed through: that payload carries the status trail with
   * the office's internal change reasons, and medical data sits behind its
   * own permission for a reason. What a family may read about itself is
   * the identity fields, the guardians already linked to them, and the
   * current enrollment — so the projection here is the policy.
   */
  async profile(studentId: string, schoolId: string) {
    const session = await this.sessions.getCurrent(schoolId);
    const [full, enrollment] = await Promise.all([
      this.students.getFull(studentId, schoolId),
      session
        ? this.enrollments.getStudentCurrentEnrollment(
            studentId,
            session.id,
            schoolId,
          )
        : Promise.resolve(null),
    ]);

    return {
      student: {
        id: full.id,
        name: `${full.firstName} ${full.lastName}`.trim(),
        studentUid: full.studentUid,
        status: full.status,
        dob: full.dob,
        gender: full.gender,
        religion: full.religion,
        bloodGroup: full.bloodGroup,
        admissionDate: full.admissionDate,
        presentAddress: full.presentAddress,
        permanentAddress: full.permanentAddress,
        photoUrl: full.photoSignedUrl,
      },
      contact: {
        email: full.user?.email ?? null,
        phone: full.user?.phone ?? null,
      },
      guardians: full.guardians.map((link) => ({
        id: link.guardian.id,
        name: link.guardian.name,
        relation: link.guardian.relation,
        phone: link.guardian.phone,
        isPrimary: link.isPrimary,
      })),
      enrollment: enrollment
        ? {
            className: enrollment.class.name,
            sectionName: enrollment.section.name,
            rollNo: enrollment.rollNo,
            groupName: enrollment.group?.name ?? null,
            shiftName: enrollment.shift?.name ?? null,
          }
        : null,
    };
  }

  /**
   * Downloads panel: the student's own paperwork (signed S3 URLs, 1 h).
   * Certificates are Module 27's; until then the panel says so in the
   * payload rather than rendering an empty list that looks like a bug —
   * the M09/M19 self-describing-stub pattern.
   */
  async documents(studentId: string, schoolId: string) {
    const docs = await this.studentDocuments.list(studentId, schoolId);
    return {
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        sizeBytes: d.sizeBytes,
        createdAt: d.createdAt,
        signedUrl: d.signedUrl,
      })),
      certificates: {
        available: false,
        reason: 'Certificate issuing arrives with Module 27',
      },
    };
  }

  /**
   * A student's own report card for one exam, as the same PDF the office
   * prints. Scoped two ways: the caller has already proven ownership of
   * `studentId`, and the exam must have an **active publication** — an
   * unpublished or withheld result is a 404 here, exactly as the M19
   * public search treats it, so the PDF route cannot become a side door
   * around publication state.
   */
  async reportCard(studentId: string, examId: string, schoolId: string) {
    const performance = await this.students.performanceHistory(
      studentId,
      schoolId,
    );
    const row = performance.items.find(
      (r) => r.examId === examId && r.publishedAt !== null,
    );
    if (!row) {
      throw new NotFoundException('No published result for this exam');
    }
    const cards = await this.resultReports.reportCards(
      examId,
      { enrollmentId: row.enrollmentId } as ResultExportQueryDto,
      schoolId,
    );
    if (cards.length === 0) {
      throw new NotFoundException('No published result for this exam');
    }
    return this.resultExports.reportCardsPdf(cards);
  }

  private async todayRoutine(
    sectionId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<
    Array<{
      subject: string;
      teacher: string;
      roomNo: string | null;
      time: string;
    }>
  > {
    try {
      const routine = await this.routine.sectionRoutine(
        sectionId,
        { sessionId },
        schoolId,
      );
      const today = WEEKDAYS[new Date(`${dhakaToday()}T00:00:00Z`).getUTCDay()];
      const timeBySlot = new Map(routine.slots.map((s) => [s.id, s.startTime]));
      return routine.cells
        .filter((c) => c.day === today)
        .map((c) => ({
          subject: c.subject.name,
          teacher: c.teacher.name,
          roomNo: c.roomNo,
          time: timeBySlot.get(c.periodSlotId) ?? '',
        }));
    } catch {
      return [];
    }
  }
}
