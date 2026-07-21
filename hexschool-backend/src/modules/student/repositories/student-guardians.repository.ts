import { Injectable } from '@nestjs/common';
import { GuardianRelation, Prisma, StudentGuardian } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Student ↔ guardian links. Composite-PK join table, so this does NOT
 * extend BaseRepository (no `id`, no soft delete, no school_id — scoping
 * comes from the student). The one-primary-per-student invariant is a
 * partial unique index (uq_student_guardians_primary); promote/demote
 * runs inside one transaction to satisfy it.
 */
@Injectable()
export class StudentGuardiansRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaClientLike) {
    return tx ?? this.prisma;
  }

  async listForStudent(studentId: string): Promise<StudentGuardian[]> {
    return this.prisma.studentGuardian.findMany({
      where: { studentId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async find(
    studentId: string,
    guardianId: string,
    tx?: PrismaClientLike,
  ): Promise<StudentGuardian | null> {
    return this.client(tx).studentGuardian.findUnique({
      where: { studentId_guardianId: { studentId, guardianId } },
    });
  }

  async findPrimary(
    studentId: string,
    tx?: PrismaClientLike,
  ): Promise<StudentGuardian | null> {
    return this.client(tx).studentGuardian.findFirst({
      where: { studentId, isPrimary: true },
    });
  }

  /**
   * Primary guardian (with phone) for many students in one query — the
   * SMS target for bulk notifications (absent alerts, M12). Students
   * without a primary simply have no row in the result.
   */
  async findPrimaryForStudents(studentIds: string[]): Promise<
    Array<
      StudentGuardian & {
        guardian: { id: string; name: string; phone: string };
      }
    >
  > {
    if (studentIds.length === 0) return [];
    return this.prisma.studentGuardian.findMany({
      where: { studentId: { in: studentIds }, isPrimary: true },
      include: { guardian: { select: { id: true, name: true, phone: true } } },
    });
  }

  async link(
    data: {
      studentId: string;
      guardianId: string;
      relation: GuardianRelation;
      isPrimary: boolean;
      isEmergencyContact: boolean;
    },
    tx?: PrismaClientLike,
  ): Promise<StudentGuardian> {
    return this.client(tx).studentGuardian.create({ data });
  }

  async update(
    studentId: string,
    guardianId: string,
    data: Prisma.StudentGuardianUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<StudentGuardian> {
    return this.client(tx).studentGuardian.update({
      where: { studentId_guardianId: { studentId, guardianId } },
      data,
    });
  }

  async unlink(
    studentId: string,
    guardianId: string,
    tx?: PrismaClientLike,
  ): Promise<void> {
    await this.client(tx).studentGuardian.delete({
      where: { studentId_guardianId: { studentId, guardianId } },
    });
  }

  async countForStudent(
    studentId: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    return this.client(tx).studentGuardian.count({ where: { studentId } });
  }

  async countForGuardian(guardianId: string): Promise<number> {
    return this.prisma.studentGuardian.count({
      where: { guardianId, student: { is: { deletedAt: null } } },
    });
  }

  /** Demote the current primary (before promoting another in the same tx). */
  async demotePrimary(studentId: string, tx?: PrismaClientLike): Promise<void> {
    await this.client(tx).studentGuardian.updateMany({
      where: { studentId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
