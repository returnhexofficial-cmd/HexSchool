import type { CertificateTypeCode } from './types';

/**
 * The frozen record of what a certificate says (roadmap M27 §3
 * `data_snapshot JSONB (name, class, session, GPA, conduct...)`, §6 "data
 * immutable post-issue (snapshot)", §9 "Unit: snapshot completeness").
 *
 * **Why a snapshot and not a join.** Every other read in this system
 * resolves live: the register could join the student, the enrollment and
 * the result and print today's values. It must not. A transfer certificate
 * issued in March 2026 states the class the child was in and the GPA they
 * earned; if the office later corrects a spelling, promotes a cohort or
 * re-processes an exam, the paper in the family's hands does not change,
 * and a re-print that disagreed with it would be a *different document
 * under the same number*. This is the M14/M15 grading-snapshot rule and
 * the M21 payslip-breakdown rule, applied to the only artifact in the
 * system that leaves the building on letterhead.
 *
 * The variables here ARE the template palette — one list, so a template
 * cannot reference a variable the snapshot never carries.
 */

export interface SnapshotInput {
  school: { name: string; address?: string | null; eiin?: string | null };
  student: {
    name: string;
    nameBn?: string | null;
    studentUid: string;
    fatherName?: string | null;
    motherName?: string | null;
    dob?: string | null;
    gender?: string | null;
    religion?: string | null;
    admissionDate?: string | null;
    photoUrl?: string | null;
  };
  enrollment?: {
    className?: string | null;
    section?: string | null;
    roll?: number | string | null;
    group?: string | null;
    session?: string | null;
  } | null;
  result?: {
    examName?: string | null;
    gpa?: number | null;
    grade?: string | null;
    /** Merit position within the class, when the exam produced one. */
    position?: number | null;
  } | null;
  attendance?: { percentage?: number | null } | null;
  conduct: string;
  /** Free-text the office adds per certificate (a prize name, a reason). */
  extra?: Record<string, string>;
  issue: {
    certificateNo: string;
    verifyCode: string;
    verifyUrl: string;
    issueDate: string;
    /** Set on a DUPLICATE re-issue — roadmap §8's watermark reference. */
    originalNo?: string | null;
  };
}

/** Every variable a certificate template may reference. Append-only. */
export const CERTIFICATE_VARIABLES: readonly string[] = [
  'school_name',
  'school_address',
  'school_eiin',
  'student_name',
  'student_name_bn',
  'student_uid',
  'father_name',
  'mother_name',
  'date_of_birth',
  'gender',
  'religion',
  'admission_date',
  'class',
  'section',
  'roll',
  'group',
  'session',
  'exam_name',
  'gpa',
  'grade',
  'position',
  'attendance_percentage',
  'conduct',
  'certificate_no',
  'verify_code',
  'verify_url',
  'issue_date',
  'original_no',
];

/**
 * The subset each type is *expected* to carry. Roadmap §9 asks for a
 * "snapshot completeness" unit test, and this table is what it tests
 * against — but note what it is NOT: a validation that refuses to issue.
 * A school issuing a character certificate for a child whose father's name
 * was never entered still needs the certificate; what it needs from this
 * module is to be **told**, on the wizard's review step, before the paper
 * is printed. So `missingFields` returns a list and the caller decides.
 */
const REQUIRED_BY_TYPE: Record<CertificateTypeCode, readonly string[]> = {
  // The document that ends the relationship: it has to identify the child
  // unambiguously to whichever school receives it, which means the
  // parents' names and the date of birth, not just a roll number.
  TRANSFER: [
    'student_name',
    'student_uid',
    'father_name',
    'date_of_birth',
    'class',
    'session',
    'admission_date',
  ],
  CHARACTER: ['student_name', 'student_uid', 'class', 'session', 'conduct'],
  // A testimonial is read by an admissions committee, so it is the one
  // type whose academic half is not optional.
  TESTIMONIAL: [
    'student_name',
    'student_uid',
    'class',
    'session',
    'conduct',
    'gpa',
  ],
  PRIZE: ['student_name', 'class', 'session'],
  PARTICIPATION: ['student_name', 'class', 'session'],
  CUSTOM: ['student_name'],
};

export type CertificateSnapshot = Record<string, string>;

/**
 * Flatten the inputs into the variable bag a template renders against.
 *
 * Everything is stringified here rather than at render time, because this
 * bag is what gets **stored**: a GPA that arrives as `4` and a GPA that
 * arrives as `4.00` must print identically on a re-issue three years
 * later, and the only way to guarantee that is to decide the formatting
 * once, at issue.
 */
export function buildSnapshot(input: SnapshotInput): CertificateSnapshot {
  const enrollment = input.enrollment ?? {};
  const result = input.result ?? {};
  const snapshot: CertificateSnapshot = {
    school_name: text(input.school.name),
    school_address: text(input.school.address),
    school_eiin: text(input.school.eiin),
    student_name: text(input.student.name),
    student_name_bn: text(input.student.nameBn),
    student_uid: text(input.student.studentUid),
    father_name: text(input.student.fatherName),
    mother_name: text(input.student.motherName),
    date_of_birth: text(input.student.dob),
    gender: text(input.student.gender),
    religion: text(input.student.religion),
    admission_date: text(input.student.admissionDate),
    class: text(enrollment.className),
    section: text(enrollment.section),
    roll: text(enrollment.roll),
    group: text(enrollment.group),
    session: text(enrollment.session),
    exam_name: text(result.examName),
    gpa: result.gpa == null ? '' : result.gpa.toFixed(2),
    grade: text(result.grade),
    position: text(result.position),
    attendance_percentage:
      input.attendance?.percentage == null
        ? ''
        : `${input.attendance.percentage.toFixed(2)}%`,
    conduct: text(input.conduct),
    certificate_no: text(input.issue.certificateNo),
    verify_code: text(input.issue.verifyCode),
    verify_url: text(input.issue.verifyUrl),
    issue_date: text(input.issue.issueDate),
    original_no: text(input.issue.originalNo),
  };

  // Per-certificate extras are merged LAST but may not shadow a resolved
  // fact: letting the office type a `gpa` into a free-text box would make
  // the one number a testimonial exists to state editable by hand.
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (!(key in snapshot)) snapshot[key] = text(value);
  }
  return snapshot;
}

/** Fields this type expects that the snapshot does not carry. */
export function missingFields(
  snapshot: CertificateSnapshot,
  type: CertificateTypeCode,
): string[] {
  return REQUIRED_BY_TYPE[type].filter(
    (field) => (snapshot[field] ?? '').trim().length === 0,
  );
}

/** Human sentence for the wizard's review step; null when complete. */
export function completenessWarning(
  snapshot: CertificateSnapshot,
  type: CertificateTypeCode,
): string | null {
  const missing = missingFields(snapshot, type);
  if (missing.length === 0) return null;
  return (
    `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} blank on ` +
    `this ${type} certificate — check the student's record before printing, ` +
    `because the snapshot is frozen at issue.`
  );
}

/**
 * Scalar coercion, matching M17's `template.engine` `coerce`.
 *
 * A blanket `String(value)` would print `[object Object]` for anything
 * non-scalar — onto a certificate, frozen there forever. A blank is the
 * honest rendering of a value this bag has no way to show, and
 * `missingFields` then reports it on the wizard's review step.
 */
function text(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value).trim();
  }
  return '';
}
