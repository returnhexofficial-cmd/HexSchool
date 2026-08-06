import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GuardianRelation, ResultStatus } from '@prisma/client';
import { CertificateType } from '../../../common/constants';
import { isoDate } from '../../academic/calendar/date.util';
import { AttendanceReportsService } from '../../attendance/services/attendance-reports.service';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { ResultsRepository } from '../../result/repositories/results.repository';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StudentsRepository } from '../../student/repositories/students.repository';
import {
  buildSnapshot,
  completenessWarning,
  type CertificateSnapshot,
} from '../calc/snapshot.engine';
import type { CertificateTypeCode } from '../calc/types';

export interface BuiltSnapshot {
  snapshot: CertificateSnapshot;
  /** The enrollment the snapshot was taken from, for the register's FK. */
  enrollmentId: string | null;
  sessionId: string | null;
  /** Non-null when a field this type expects came out blank. */
  completeness: string | null;
  /** The guardian to tell, when the school notifies on issue. */
  guardianUserId: string | null;
  studentName: string;
}

/**
 * Resolves everything a certificate prints, once, from the five modules
 * that own the facts — and then never reads them again.
 *
 * **This is where roadmap §4's "auto-fill snapshot (enrollment, results,
 * attendance %, conduct default)" happens**, and the reason it is a
 * separate service from `CertificatesService` is that it is also what the
 * template designer's preview and the wizard's review step call. All three
 * have to see the same bag, or the office reviews one document and the
 * school issues another.
 *
 * **Every source degrades rather than throws, except the student.** A
 * student with no processed result still gets a character certificate; a
 * student who does not exist gets a 404, because there is nobody to
 * certify. That asymmetry is the whole error policy: the identity is
 * required, the decoration is not, and `completenessWarning` tells the
 * office which decoration is missing *before* the paper is printed —
 * because the snapshot is frozen at issue and cannot be topped up later.
 */
@Injectable()
export class SnapshotBuilderService {
  private readonly logger = new Logger(SnapshotBuilderService.name);

  constructor(
    private readonly students: StudentsRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly results: ResultsRepository,
    private readonly attendance: AttendanceReportsService,
    private readonly schools: SchoolsRepository,
  ) {}

  async build(params: {
    schoolId: string;
    studentId: string;
    type: CertificateType | CertificateTypeCode;
    conduct: string;
    enrollmentId?: string;
    examId?: string;
    extra?: Record<string, string>;
    issue: {
      certificateNo: string;
      verifyCode: string;
      verifyUrl: string;
      issueDate: string;
      originalNo?: string | null;
    };
  }): Promise<BuiltSnapshot> {
    const [student, school] = await Promise.all([
      this.students.findDetail(params.studentId, params.schoolId),
      this.schools.findByIdOrFail(params.schoolId),
    ]);
    if (!student) {
      throw new NotFoundException(`Student ${params.studentId} not found`);
    }

    const enrollment = await this.resolveEnrollment(
      params.schoolId,
      params.studentId,
      params.enrollmentId,
    );
    const result = await this.resolveResult(
      params.schoolId,
      params.studentId,
      params.examId,
    );
    const attendance = await this.resolveAttendance(
      params.schoolId,
      params.studentId,
    );

    // The parents' names are a GUARDIAN fact, not a student column — a
    // BD certificate names the father and mother, and this system stores
    // them as linked people (M09) rather than as two text fields.
    const father = student.guardians.find(
      (link) => link.guardian.relation === GuardianRelation.FATHER,
    );
    const mother = student.guardians.find(
      (link) => link.guardian.relation === GuardianRelation.MOTHER,
    );
    const primary =
      student.guardians.find((link) => link.isPrimary) ?? student.guardians[0];

    const snapshot = buildSnapshot({
      school: {
        name: school.name,
        address: school.address,
        eiin: school.eiinNumber,
      },
      student: {
        name: `${student.firstName} ${student.lastName}`.trim(),
        nameBn: student.nameBn,
        studentUid: student.studentUid,
        fatherName: father?.guardian.name ?? null,
        motherName: mother?.guardian.name ?? null,
        dob: isoDate(student.dob),
        gender: student.gender,
        religion: student.religion,
        admissionDate: isoDate(student.admissionDate),
        photoUrl: student.photoUrl,
      },
      enrollment: enrollment
        ? {
            className: enrollment.class.name,
            section: enrollment.section?.name ?? null,
            roll: enrollment.rollNo,
            group: enrollment.group?.name ?? null,
            session: enrollment.session.name,
          }
        : null,
      result,
      attendance,
      conduct: params.conduct,
      extra: params.extra,
      issue: params.issue,
    });

    const type = params.type;
    return {
      snapshot,
      enrollmentId: enrollment?.id ?? null,
      sessionId: enrollment?.sessionId ?? null,
      completeness: completenessWarning(snapshot, type),
      guardianUserId: primary?.guardian.userId ?? null,
      studentName: snapshot.student_name,
    };
  }

  /**
   * The caller's enrollment if they named one, otherwise the student's
   * **most recent** one.
   *
   * Not the *current-session* one, which is the obvious implementation and
   * is wrong for the commonest case this module has: a transfer
   * certificate is issued for a child who is leaving, often days after the
   * office has already closed their enrollment or rolled the session over.
   * Reading "current" would print a TC with a blank class on it.
   */
  private async resolveEnrollment(
    schoolId: string,
    studentId: string,
    enrollmentId?: string,
  ) {
    if (enrollmentId) {
      const named = await this.enrollments.findDetail(enrollmentId, schoolId);
      if (!named || named.studentId !== studentId) {
        throw new NotFoundException(
          `Enrollment ${enrollmentId} does not belong to this student`,
        );
      }
      return named;
    }

    const all = await this.enrollments.findAll({ studentId }, schoolId);
    if (all.length === 0) return null;
    const latest = all.reduce((best, row) =>
      row.createdAt.getTime() > best.createdAt.getTime() ? row : best,
    );
    return this.enrollments.findDetail(latest.id, schoolId);
  }

  /**
   * The exam the caller named, or the latest **published, not withheld**
   * result.
   *
   * Withheld and unpublished results are skipped rather than printed:
   * quoting a GPA the school is still holding back on a document that
   * leaves the building would publish it by the back door — the M15 rule
   * that visibility is the active publication, not the computed number.
   */
  private async resolveResult(
    schoolId: string,
    studentId: string,
    examId?: string,
  ) {
    try {
      const rows = await this.results.findForStudent(studentId, schoolId);
      const usable = rows.filter(
        (row) =>
          row.publishedAt !== null && row.status !== ResultStatus.WITHHELD,
      );
      const chosen = examId
        ? usable.find((row) => row.examId === examId)
        : usable[0];
      if (!chosen) return null;

      return {
        examName: chosen.exam?.name ?? null,
        gpa: chosen.gpa === null ? null : Number(chosen.gpa),
        grade: chosen.grade ?? null,
        position: chosen.meritPositionClass ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `Result lookup failed for student ${studentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async resolveAttendance(schoolId: string, studentId: string) {
    try {
      const report = await this.attendance.student(studentId, {}, schoolId);
      return { percentage: report.summary.percentage };
    } catch (error) {
      // A student with no register at all (a brand-new admission, or a
      // school that never turned attendance on) is not an error — the
      // certificate simply does not quote a percentage.
      this.logger.warn(
        `Attendance lookup failed for student ${studentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
