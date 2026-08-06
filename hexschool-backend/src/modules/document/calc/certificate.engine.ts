import type {
  CertificateIssueKindCode,
  CertificateStatusCode,
  CertificateTypeCode,
} from './types';

/**
 * The certificate lifecycle: what may be issued, revoked, re-issued and
 * verified, as **one verdict each** rather than as conditions scattered
 * across a service (the M16 `deriveStatus` / M23 `canIssue` / M25
 * `capacity.engine` rule).
 *
 * The distinction that runs through the whole file is roadmap §6's
 * immutability: **an issued certificate is a physical object in somebody
 * else's possession.** Nothing here edits one. A wrong name is a revoke
 * plus a CORRECTION; a lost original is a DUPLICATE; and both stay in the
 * register, linked, because the school has to be able to answer "how many
 * transfer certificates does this student hold" with a number rather than
 * a shrug (the M15 re-issue rule and the M20 reversal rule, in a third
 * ledger).
 */

/** A refusal that no permission reaches, vs one an override may pass. */
export type RefusalTier = 'STRUCTURAL' | 'POLICY';

export interface LifecycleVerdict {
  allowed: boolean;
  tier: RefusalTier | null;
  reason: string | null;
  warnings: string[];
}

const OK: LifecycleVerdict = {
  allowed: true,
  tier: null,
  reason: null,
  warnings: [],
};

function refuse(
  tier: RefusalTier,
  reason: string,
  warnings: string[] = [],
): LifecycleVerdict {
  return { allowed: false, tier, reason, warnings };
}

export interface IssueCandidate {
  status: CertificateStatusCode;
  type: CertificateTypeCode;
  /** Live certificates of the same type this student already holds. */
  existingIssued: number;
  /** The student's own record status — an exited student is normal here. */
  studentDeleted: boolean;
  /** The chosen template's type, when a template was chosen. */
  templateType?: CertificateTypeCode | null;
  templateActive?: boolean;
}

/**
 * May this draft be issued?
 *
 * **A second transfer certificate is a warning, not a refusal.** It is the
 * one case where the obvious rule is wrong: a family that lost the
 * original comes back, and the answer is roadmap §8's watermarked
 * duplicate — which is an *issue*, not an edit. Refusing outright would
 * push the office into deleting the first record to get past the check,
 * which destroys exactly the register this module exists to keep. So the
 * office is told, and the register shows both.
 */
export function canIssue(candidate: IssueCandidate): LifecycleVerdict {
  if (candidate.status === 'REVOKED') {
    return refuse(
      'STRUCTURAL',
      'This certificate was revoked. Issue a correction instead — a revoked document does not come back.',
    );
  }
  if (candidate.status === 'ISSUED') {
    return refuse(
      'STRUCTURAL',
      'This certificate has already been issued. Re-print it, or issue a duplicate.',
    );
  }
  if (candidate.studentDeleted) {
    return refuse(
      'STRUCTURAL',
      'This student record has been deleted — there is nobody to certify.',
    );
  }
  if (
    candidate.templateType != null &&
    candidate.templateType !== candidate.type
  ) {
    return refuse(
      'STRUCTURAL',
      `The chosen template is a ${candidate.templateType} layout and this is a ${candidate.type} certificate.`,
    );
  }

  const warnings: string[] = [];
  if (candidate.templateActive === false) {
    warnings.push(
      'The chosen template is switched off. It still renders, but the office has retired it — check it is the layout you want.',
    );
  }
  if (candidate.existingIssued > 0) {
    warnings.push(
      `This student already holds ${candidate.existingIssued} live ${candidate.type} certificate(s). If this is a replacement for a lost original, issue it as a DUPLICATE so the register links the two.`,
    );
  }
  return { ...OK, warnings };
}

/**
 * May this certificate be revoked? Only an ISSUED one can be: a DRAFT is
 * deleted (nothing left the building) and a REVOKED one already is.
 */
export function canRevoke(status: CertificateStatusCode): LifecycleVerdict {
  if (status === 'DRAFT') {
    return refuse(
      'STRUCTURAL',
      'A draft was never issued — delete it instead of revoking it.',
    );
  }
  if (status === 'REVOKED') {
    return refuse('STRUCTURAL', 'This certificate is already revoked.');
  }
  return OK;
}

export interface ReissueCandidate {
  kind: Exclude<CertificateIssueKindCode, 'ORIGINAL'>;
  originalStatus: CertificateStatusCode;
}

/**
 * May this certificate be re-issued, and as which kind?
 *
 * The two kinds have **opposite preconditions**, which is exactly why they
 * are different values rather than one "reissue" flag:
 *
 *   - A **DUPLICATE** reprints a certificate that is still valid — the
 *     family lost their copy. Duplicating a revoked certificate would put
 *     a document the school has disowned back into circulation with a
 *     fresh number.
 *   - A **CORRECTION** replaces one that is *not* valid any more. Issuing
 *     a correction against a live certificate would leave two contradictory
 *     documents both verifying VALID, which is the failure the verification
 *     page exists to prevent.
 */
export function canReissue(candidate: ReissueCandidate): LifecycleVerdict {
  if (candidate.kind === 'DUPLICATE') {
    if (candidate.originalStatus !== 'ISSUED') {
      return refuse(
        'STRUCTURAL',
        `A duplicate reprints a certificate that is still valid; this one is ${candidate.originalStatus}.`,
      );
    }
    return {
      ...OK,
      warnings: [
        'The duplicate is watermarked and carries its own number, and both documents stay in the register — the original remains valid, because the family may yet find it.',
      ],
    };
  }

  if (candidate.originalStatus !== 'REVOKED') {
    return refuse(
      'POLICY',
      'Revoke the certificate being corrected first — otherwise both would verify VALID and say different things.',
    );
  }
  return OK;
}

// ── public verification ────────────────────────────────────────────────

export type VerificationOutcome = 'VALID' | 'REVOKED' | 'NOT_FOUND';

export interface VerificationSubject {
  status: CertificateStatusCode;
  issueKind: CertificateIssueKindCode;
  revokedReason?: string | null;
}

/**
 * What the public page says (roadmap §4, §6 "Only ISSUED certs verify
 * VALID; DRAFTs invisible publicly").
 *
 * A DRAFT resolves to **NOT_FOUND, not to "not yet issued"** — the M15
 * public-result-search and M19 draft-preview rule: a public endpoint must
 * never confirm that something exists. In practice a draft has no verify
 * code at all, so this branch is unreachable through the API; it is here
 * because the verdict is what the page reads, and a verdict that quietly
 * assumed its input was well-formed would be one schema change away from
 * leaking.
 *
 * REVOKED is deliberately **not** NOT_FOUND. Saying "no such certificate"
 * about a revoked one would let a forger's document and a genuinely
 * cancelled one look identical, and the school's own reason for cancelling
 * is the useful half of the answer.
 */
export function verificationOutcome(
  subject: VerificationSubject | null,
): VerificationOutcome {
  if (!subject) return 'NOT_FOUND';
  if (subject.status === 'DRAFT') return 'NOT_FOUND';
  if (subject.status === 'REVOKED') return 'REVOKED';
  return 'VALID';
}

/** The sentence the public page prints under the verdict. */
export function verificationMessage(
  outcome: VerificationOutcome,
  subject: VerificationSubject | null,
): string {
  switch (outcome) {
    case 'VALID':
      return subject?.issueKind === 'DUPLICATE'
        ? 'This is a genuine certificate issued by the school. It is a duplicate copy of an earlier certificate, and both are valid.'
        : 'This is a genuine certificate issued by the school.';
    case 'REVOKED':
      return subject?.revokedReason
        ? `This certificate was issued by the school and has since been revoked: ${subject.revokedReason}`
        : 'This certificate was issued by the school and has since been revoked.';
    default:
      return 'No certificate matches this code. Check the code against the printed document, or contact the school office.';
  }
}
