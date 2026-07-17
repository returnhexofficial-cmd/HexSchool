import { Injectable } from '@nestjs/common';
import { Prisma, StudentStatusHistory } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Append-only status trail (no update/delete API — log table). */
@Injectable()
export class StudentStatusHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    data: Prisma.StudentStatusHistoryUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<StudentStatusHistory> {
    const client = tx ?? this.prisma;
    return client.studentStatusHistory.create({ data });
  }

  async listForStudent(studentId: string): Promise<StudentStatusHistory[]> {
    return this.prisma.studentStatusHistory.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
