import { Injectable } from '@nestjs/common';
import { CertificateStatus, CertificateType } from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import type { RegisterReportQueryDto } from '../dto';
import { CertificatesRepository } from '../repositories/certificates.repository';

export interface RegisterRow {
  certificateNo: string;
  type: CertificateType;
  studentName: string;
  studentUid: string;
  className: string;
  session: string;
  issueDate: string;
  issueKind: string;
  status: CertificateStatus;
  clearanceWaived: boolean;
  isLegacy: boolean;
  revokedReason: string | null;
  originalNo: string | null;
}

export interface RegisterReport {
  from: string;
  to: string;
  rows: RegisterRow[];
  totals: {
    issued: number;
    revoked: number;
    duplicates: number;
    legacy: number;
  };
}

export interface SummaryReport {
  from: string;
  to: string;
  byType: Array<{
    type: CertificateType;
    issued: number;
    revoked: number;
    total: number;
  }>;
  totals: { issued: number; revoked: number; total: number };
}

/**
 * The issuance register (roadmap §5's "Certificate register table") and the
 * per-type summary, as JSON shapes the screen and the export both read —
 * the M12 reports/export split.
 *
 * **The register reads the frozen snapshot for the class and session**, not
 * a join to the live enrollment. A student promoted since the certificate
 * was issued must not make last year's register print this year's class:
 * a register is a record of what was issued, and re-deriving it would make
 * it a record of what the school currently believes.
 */
@Injectable()
export class CertificateReportsService {
  constructor(private readonly certificates: CertificatesRepository) {}

  async register(
    query: RegisterReportQueryDto,
    schoolId: string,
  ): Promise<RegisterReport> {
    const { from, to } = this.window(query);
    const rows = await this.certificates.findAllForRegister(schoolId, {
      from,
      to,
      type: query.type,
    });

    const mapped: RegisterRow[] = rows
      // A DRAFT has no number and never left the office — it is work in
      // progress, not an entry in a register.
      .filter((row) => row.status !== CertificateStatus.DRAFT)
      .map((row) => {
        const snapshot = (row.dataSnapshot ?? {}) as Record<string, string>;
        return {
          certificateNo: row.certificateNo ?? '',
          type: row.type,
          studentName:
            `${row.student.firstName} ${row.student.lastName}`.trim(),
          studentUid: row.student.studentUid,
          className: snapshot.class || '',
          session: snapshot.session || row.session?.name || '',
          issueDate: row.issuedAt ? isoDate(row.issuedAt) : '',
          issueKind: row.issueKind,
          status: row.status,
          clearanceWaived: row.clearanceOverrideBy !== null,
          isLegacy: row.isLegacy,
          revokedReason: row.revokedReason,
          originalNo: row.original?.certificateNo ?? null,
        };
      });

    return {
      from: isoDate(from),
      to: isoDate(to),
      rows: mapped,
      totals: {
        issued: mapped.filter((r) => r.status === CertificateStatus.ISSUED)
          .length,
        revoked: mapped.filter((r) => r.status === CertificateStatus.REVOKED)
          .length,
        duplicates: mapped.filter((r) => r.issueKind === 'DUPLICATE').length,
        legacy: mapped.filter((r) => r.isLegacy).length,
      },
    };
  }

  async summary(
    query: RegisterReportQueryDto,
    schoolId: string,
  ): Promise<SummaryReport> {
    const { from, to } = this.window(query);
    const rows = await this.certificates.summaryByType(schoolId, from, to);

    const byType = new Map<
      CertificateType,
      { issued: number; revoked: number }
    >();
    for (const row of rows) {
      if (row.status === CertificateStatus.DRAFT) continue;
      const entry = byType.get(row.type) ?? { issued: 0, revoked: 0 };
      if (row.status === CertificateStatus.ISSUED) entry.issued += row.count;
      if (row.status === CertificateStatus.REVOKED) entry.revoked += row.count;
      byType.set(row.type, entry);
    }

    const list = [...byType.entries()]
      .map(([type, entry]) => ({
        type,
        issued: entry.issued,
        revoked: entry.revoked,
        total: entry.issued + entry.revoked,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      from: isoDate(from),
      to: isoDate(to),
      byType: list,
      totals: {
        issued: list.reduce((sum, row) => sum + row.issued, 0),
        revoked: list.reduce((sum, row) => sum + row.revoked, 0),
        total: list.reduce((sum, row) => sum + row.total, 0),
      },
    };
  }

  /** Defaults to the last twelve months — a register's natural window. */
  private window(query: RegisterReportQueryDto): { from: Date; to: Date } {
    const to = query.to ? parseDate(query.to) : new Date();
    to.setUTCHours(23, 59, 59, 999);

    const from = query.from
      ? parseDate(query.from)
      : (() => {
          const start = new Date(to);
          start.setUTCFullYear(start.getUTCFullYear() - 1);
          start.setUTCHours(0, 0, 0, 0);
          return start;
        })();
    return { from, to };
  }
}
