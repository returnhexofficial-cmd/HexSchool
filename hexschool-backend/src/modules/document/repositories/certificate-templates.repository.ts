import { Injectable } from '@nestjs/common';
import { CertificateTemplate, CertificateType, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class CertificateTemplatesRepository extends BaseRepository<
  CertificateTemplate,
  Prisma.CertificateTemplateWhereInput,
  Prisma.CertificateTemplateUncheckedCreateInput,
  Prisma.CertificateTemplateUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(
      prisma,
      (client) => client.certificateTemplate,
      'CertificateTemplate',
    );
  }

  async findMany(
    schoolId: string,
    filter: { type?: CertificateType; isActive?: boolean; search?: string },
  ): Promise<CertificateTemplate[]> {
    return this.prisma.certificateTemplate.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
        ...(filter.search
          ? { name: { contains: filter.search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Name collision within a type. `uq_certificate_templates_name` is the
   * guarantee; this exists so the 409 can say which template it clashed
   * with rather than surfacing a constraint name to a clerk (the M25
   * composite-FK convention).
   */
  async findByName(
    schoolId: string,
    type: CertificateType,
    name: string,
    excludeId?: string,
  ): Promise<CertificateTemplate | null> {
    return this.prisma.certificateTemplate.findFirst({
      where: {
        schoolId,
        type,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Certificates already issued through this template — the delete guard. */
  async countIssued(templateId: string): Promise<number> {
    return this.prisma.certificate.count({
      where: { templateId, deletedAt: null },
    });
  }
}
