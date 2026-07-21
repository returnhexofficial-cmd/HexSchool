import { Injectable } from '@nestjs/common';
import { EnrollmentTransfer, Prisma } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Append-only section-transfer log (like student_status_history) — one
 * row per transfer; the enrollment's section_id is mutated in place.
 */
@Injectable()
export class EnrollmentTransfersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.EnrollmentTransferUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<EnrollmentTransfer> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.enrollmentTransfer.create({ data });
  }

  async findForEnrollment(enrollmentId: string): Promise<EnrollmentTransfer[]> {
    return this.prisma.enrollmentTransfer.findMany({
      where: { enrollmentId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
