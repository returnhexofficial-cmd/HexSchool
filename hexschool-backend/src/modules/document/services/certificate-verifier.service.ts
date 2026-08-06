import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';
import {
  verificationMessage,
  verificationOutcome,
} from '../calc/certificate.engine';
import {
  isVerifyCodeShape,
  normalizeVerifyCode,
} from '../calc/verify-code.util';
import type {
  CertificateVerification,
  CertificateVerifier,
} from '../document.constants';

const NOT_FOUND: CertificateVerification = {
  outcome: 'NOT_FOUND',
  message: verificationMessage('NOT_FOUND', null),
};

/**
 * The public certificate lookup — roadmap §4's
 * `GET /public/verify/certificate/:code`, and the body M19 left as
 * `{ available: false, reason }` saying M27 would fill it in.
 *
 * **This service depends on PrismaService and nothing else**, which is what
 * lets WebsiteModule provide it a second time behind `CERTIFICATE_VERIFIER`
 * instead of importing DocumentModule — the M13 `RoutineConflictChecker` /
 * M23 `LIBRARY_CLEARANCE` shape, and the direction M19's own module doc
 * predicted.
 *
 * **The SELECT list is the privacy policy** (the M19 rule). Somebody
 * holding a certificate is entitled to know whether it is genuine and who
 * it describes; they are not entitled to the child's phone number,
 * address, guardian or marks. Those columns are never *fetched* rather
 * than fetched and dropped, so there is nothing for a future refactor to
 * accidentally include.
 *
 * **It never throws.** A malformed code is `NOT_FOUND`, not a 400 — the
 * endpoint is reached by a stranger typing off a piece of paper, and the
 * one answer that is always safe is the same answer a wrong code gets
 * (the M15 public-result-search / M19 draft-preview rule).
 */
@Injectable()
export class CertificateVerifierService implements CertificateVerifier {
  constructor(private readonly prisma: PrismaService) {}

  async verify(code: string): Promise<CertificateVerification> {
    const normalized = normalizeVerifyCode(code ?? '');
    if (!isVerifyCodeShape(normalized)) return NOT_FOUND;

    const row = await this.prisma.certificate.findFirst({
      where: { verifyCode: normalized, deletedAt: null },
      select: {
        certificateNo: true,
        type: true,
        status: true,
        issueKind: true,
        issuedAt: true,
        revokedAt: true,
        revokedReason: true,
        dataSnapshot: true,
        student: { select: { firstName: true, lastName: true } },
        original: { select: { certificateNo: true } },
      },
    });
    if (!row) return NOT_FOUND;

    const subject = {
      status: row.status,
      issueKind: row.issueKind,
      revokedReason: row.revokedReason,
    };
    const outcome = verificationOutcome(subject);
    if (outcome === 'NOT_FOUND') return NOT_FOUND;

    // The class and session come from the FROZEN snapshot, not from a join
    // to the live enrollment: the certificate says what it says, and a
    // student promoted since then must not make a genuine document read as
    // describing the wrong year.
    const snapshot = (row.dataSnapshot ?? {}) as Record<string, string>;

    return {
      outcome,
      message: verificationMessage(outcome, subject),
      certificate: {
        certificateNo: row.certificateNo ?? '',
        type: row.type,
        studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
        className: snapshot.class || null,
        session: snapshot.session || null,
        issueDate: row.issuedAt ? row.issuedAt.toISOString().slice(0, 10) : '',
        isDuplicate: row.issueKind === 'DUPLICATE',
        originalNo: row.original?.certificateNo ?? null,
        revokedAt: row.revokedAt
          ? row.revokedAt.toISOString().slice(0, 10)
          : null,
      },
    };
  }
}
