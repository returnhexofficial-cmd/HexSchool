/**
 * Module 22 — module-level constants and the one DI hook it declares.
 */

/**
 * Roadmap §4 asks for a "virus-scan hook placeholder (ClamAV container
 * optional)". It ships as a **DI token bound to a pass-through scanner**,
 * which is the established convention for a policy this project intends
 * to make real later: M08's `TIMETABLE_CONFLICT_CHECKER` (bound for real
 * in M13) and M14's `EXAM_RESULT_GATE` / `EXAM_DUES_GATE` (bound in M15 /
 * M16) shipped exactly this way.
 *
 * Why a token rather than a `TODO` comment: the *call site* is the part
 * that is easy to forget. Every upload path already asks the scanner and
 * already handles a refusal, so switching a school to ClamAV is one
 * provider binding in `AssignmentModule` — no upload endpoint changes and
 * none of them can quietly skip the check.
 */
export const ATTACHMENT_SCANNER = Symbol('ATTACHMENT_SCANNER');

export interface AttachmentScanResult {
  clean: boolean;
  /** Why it was refused — surfaced to the uploader. */
  reason?: string;
}

export interface AttachmentScanner {
  scan(file: {
    buffer: Buffer;
    filename: string;
    contentType: string;
  }): Promise<AttachmentScanResult>;
}

/** The no-op binding: everything passes until a real scanner is wired. */
export class PassThroughAttachmentScanner implements AttachmentScanner {
  scan(): Promise<AttachmentScanResult> {
    return Promise.resolve({ clean: true });
  }
}

/** S3 prefixes, so the bucket stays readable. */
export const ASSIGNMENT_PREFIX = 'assignments';
export const SUBMISSION_PREFIX = 'assignments/submissions';
export const MATERIAL_PREFIX = 'learning-materials';
/** Bucket purpose — reuses `S3_BUCKET_DOCUMENTS` like M07/M09. */
export const ASSIGNMENT_BUCKET_PURPOSE = 'documents';
