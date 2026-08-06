import { Injectable } from '@nestjs/common';
import { CertificateStatus } from '../../../common/constants';
import { CertificatesRepository } from '../repositories/certificates.repository';

export interface PortalCertificate {
  id: string;
  certificateNo: string;
  type: string;
  issueDate: string;
  isDuplicate: boolean;
  /** REVOKED certificates stay in the list — see the service note. */
  status: CertificateStatus;
  revokedReason: string | null;
  verifyCode: string;
  /** False for a legacy backfill: there is no stored layout to print. */
  downloadable: boolean;
}

/**
 * Roadmap §5's "Student portal: my certificates download list", composed
 * by M18's leaf `PortalModule` at `/portal/certificates`.
 *
 * **A revoked certificate stays on the list, marked.** Hiding it would be
 * the obvious choice and is wrong twice: the family is holding the paper,
 * so pretending it does not exist tells them nothing when somebody checks
 * the code and gets REVOKED — and the reason the school recorded is
 * precisely what they need in order to come and sort it out.
 *
 * **A draft never appears.** It has no number, no code and no public
 * existence (roadmap §6), and showing a family a certificate the office has
 * not decided to issue would turn an internal working state into a promise.
 */
@Injectable()
export class DocumentPortalService {
  constructor(private readonly certificates: CertificatesRepository) {}

  async forStudent(
    studentId: string,
    schoolId: string,
  ): Promise<PortalCertificate[]> {
    const rows = await this.certificates.findForStudent(
      studentId,
      schoolId,
      true,
    );
    return rows.map((row) => ({
      id: row.id,
      certificateNo: row.certificateNo ?? '',
      type: row.type,
      issueDate: row.issuedAt ? row.issuedAt.toISOString().slice(0, 10) : '',
      isDuplicate: row.issueKind === 'DUPLICATE',
      status: row.status,
      revokedReason: row.revokedReason,
      verifyCode: row.verifyCode ?? '',
      downloadable: row.bodyHtml !== null,
    }));
  }
}
