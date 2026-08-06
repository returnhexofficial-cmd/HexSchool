import { Injectable } from '@nestjs/common';
import {
  Certificate,
  CertificateStatus,
  CertificateType,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  student: {
    select: {
      id: true,
      studentUid: true,
      firstName: true,
      lastName: true,
      status: true,
      deletedAt: true,
    },
  },
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      class: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
      session: { select: { id: true, name: true } },
    },
  },
  session: { select: { id: true, name: true } },
  // `backgroundUrl` and `signatories` are read LIVE from the template
  // rather than frozen onto the certificate, unlike `body_html`. A school
  // that rescans its letterhead at a higher resolution, or whose head
  // changes, wants the new stationery and the new signature on the next
  // re-print — the *wording* is the promise, the paper it is printed on
  // is not.
  template: {
    select: {
      id: true,
      name: true,
      type: true,
      isActive: true,
      backgroundUrl: true,
      signatories: true,
    },
  },
  original: { select: { id: true, certificateNo: true, status: true } },
} satisfies Prisma.CertificateInclude;

export type CertificateWithRelations = Prisma.CertificateGetPayload<{
  include: typeof RELATIONS;
}>;

export interface CertificateFilter {
  type?: CertificateType;
  status?: CertificateStatus;
  studentId?: string;
  sessionId?: string;
  from?: Date;
  to?: Date;
  search?: string;
}

@Injectable()
export class CertificatesRepository extends BaseRepository<
  Certificate,
  Prisma.CertificateWhereInput,
  Prisma.CertificateUncheckedCreateInput,
  Prisma.CertificateUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.certificate, 'Certificate');
  }

  private where(
    schoolId: string,
    filter: CertificateFilter,
  ): Prisma.CertificateWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.from || filter.to
        ? {
            issuedAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.search
        ? {
            OR: [
              {
                certificateNo: { contains: filter.search, mode: 'insensitive' },
              },
              { verifyCode: { contains: filter.search, mode: 'insensitive' } },
              {
                student: {
                  OR: [
                    {
                      firstName: {
                        contains: filter.search,
                        mode: 'insensitive',
                      },
                    },
                    {
                      lastName: {
                        contains: filter.search,
                        mode: 'insensitive',
                      },
                    },
                    {
                      studentUid: {
                        contains: filter.search,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
  }

  /** The issuance register (roadmap §4 `GET /certificates`). */
  async findMany(
    schoolId: string,
    filter: CertificateFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: CertificateWithRelations[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.certificate.findMany({
        where,
        include: RELATIONS,
        // Newest first, and a DRAFT (no `issued_at`) sorts to the top —
        // it is the row somebody is still working on.
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.certificate.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllForRegister(
    schoolId: string,
    filter: CertificateFilter,
  ): Promise<CertificateWithRelations[]> {
    return this.prisma.certificate.findMany({
      where: this.where(schoolId, filter),
      include: RELATIONS,
      orderBy: [{ issuedAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<CertificateWithRelations | null> {
    return this.prisma.certificate.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: RELATIONS,
    });
  }

  /** Every certificate a student holds — the portal's list. */
  async findForStudent(
    studentId: string,
    schoolId: string,
    onlyIssued = true,
  ): Promise<CertificateWithRelations[]> {
    return this.prisma.certificate.findMany({
      where: {
        studentId,
        schoolId,
        deletedAt: null,
        ...(onlyIssued
          ? {
              status: {
                in: [CertificateStatus.ISSUED, CertificateStatus.REVOKED],
              },
            }
          : {}),
      },
      include: RELATIONS,
      orderBy: [{ issuedAt: 'desc' }],
    });
  }

  /** Live certificates of one type this student already holds. */
  async countIssuedOfType(
    schoolId: string,
    studentId: string,
    type: CertificateType,
  ): Promise<number> {
    return this.prisma.certificate.count({
      where: {
        schoolId,
        studentId,
        type,
        status: CertificateStatus.ISSUED,
        deletedAt: null,
      },
    });
  }

  /**
   * Does this verify code already exist? Deliberately **not**
   * `deleted_at`-scoped and **not** school-scoped, matching
   * `uq_certificates_verify_code`: a code printed inside a QR must never
   * come back pointing at a different document.
   */
  async verifyCodeTaken(code: string): Promise<boolean> {
    const found = await this.prisma.certificate.findFirst({
      where: { verifyCode: code },
      select: { id: true },
    });
    return found !== null;
  }

  /** Same rule for the certificate number (`uq_certificates_no`). */
  async numberTaken(schoolId: string, certificateNo: string): Promise<boolean> {
    const found = await this.prisma.certificate.findFirst({
      where: { schoolId, certificateNo },
      select: { id: true },
    });
    return found !== null;
  }

  /** Counts by type and status over a window — the summary report. */
  async summaryByType(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{ type: CertificateType; status: CertificateStatus; count: number }>
  > {
    const rows = await this.prisma.certificate.groupBy({
      by: ['type', 'status'],
      where: {
        schoolId,
        deletedAt: null,
        issuedAt: { gte: from, lte: to },
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      type: row.type,
      status: row.status,
      count: row._count._all,
    }));
  }

  async withTransaction<R>(
    fn: (tx: PrismaClientLike) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction((tx) => fn(tx));
  }
}
