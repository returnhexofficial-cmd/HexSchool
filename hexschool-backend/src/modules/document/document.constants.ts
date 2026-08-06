/**
 * Module 27's cross-module contract, kept in a bare constants file with no
 * Nest imports beyond the token symbol — the M12 `hr.leave.approved` / M23
 * `LIBRARY_CLEARANCE` / M25 `TRANSPORT_FEE_SOURCE` / M26 `HOSTEL_FEE_SOURCE`
 * trick that lets a *consumer* depend on the shape without importing the
 * module that owns it.
 */

/**
 * DI token for the public certificate lookup.
 *
 * M19 left `GET /public/verify/certificate` answering
 * `{ available: false, reason }` and wrote in `website.module.ts` that M27
 * would replace the body "the way M15 bound `EXAM_RESULT_GATE` into
 * ExamModule". This is that binding: `CertificateVerifierService` depends
 * on **PrismaService alone**, so WebsiteModule provides it a second time
 * behind this token rather than importing DocumentModule — which would
 * pull Student, Result, Fee, Library and Hostel into the public site's
 * graph for one lookup, and would reverse the direction of an edge
 * PortalModule already relies on.
 *
 * The token is **always bound**, never conditional (the M08/M14 lesson
 * that the call site is the part that is easy to forget).
 */
export const CERTIFICATE_VERIFIER = Symbol('CERTIFICATE_VERIFIER');

/** What the public page shows. `NOT_FOUND` carries nothing else. */
export interface CertificateVerification {
  outcome: 'VALID' | 'REVOKED' | 'NOT_FOUND';
  message: string;
  /**
   * Present only for a resolved certificate. **This object is the privacy
   * policy** — the M19 rule that the SELECT list is the policy, not a
   * filter over a richer result. A verifier is entitled to know that the
   * document in their hand is genuine and who it describes; they are not
   * entitled to the student's phone number, address, guardian or marks,
   * so those are never fetched rather than fetched and dropped.
   */
  certificate?: {
    certificateNo: string;
    type: string;
    studentName: string;
    className: string | null;
    session: string | null;
    issueDate: string;
    isDuplicate: boolean;
    originalNo: string | null;
    revokedAt: string | null;
  };
}

export interface CertificateVerifier {
  /** Resolve a typed-in or scanned code. Never throws for a bad code. */
  verify(code: string): Promise<CertificateVerification>;
}
