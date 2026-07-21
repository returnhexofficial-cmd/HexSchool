import { Injectable } from '@nestjs/common';
import { AttendancePersonType, Prisma, StaffAttendance } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface StaffAttendanceKey {
  personType: AttendancePersonType;
  personId: string;
  date: Date;
}

@Injectable()
export class StaffAttendancesRepository extends BaseRepository<
  StaffAttendance,
  Prisma.StaffAttendanceWhereInput,
  Prisma.StaffAttendanceUncheckedCreateInput,
  Prisma.StaffAttendanceUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.staffAttendance, 'StaffAttendance');
  }

  async findForDate(
    schoolId: string,
    date: Date,
    personType?: AttendancePersonType,
  ): Promise<StaffAttendance[]> {
    return this.prisma.staffAttendance.findMany({
      where: {
        schoolId,
        date,
        deletedAt: null,
        ...(personType ? { personType } : {}),
      },
    });
  }

  async findInRange(
    schoolId: string,
    from: Date,
    to: Date,
    personType?: AttendancePersonType,
  ): Promise<StaffAttendance[]> {
    return this.prisma.staffAttendance.findMany({
      where: {
        schoolId,
        date: { gte: from, lte: to },
        deletedAt: null,
        ...(personType ? { personType } : {}),
      },
      orderBy: [{ date: 'asc' }],
    });
  }

  /** Upsert on (person_type, person_id, date) — see the partial unique. */
  async upsertEntry(
    key: StaffAttendanceKey,
    data: Omit<
      Prisma.StaffAttendanceUncheckedCreateInput,
      'personType' | 'personId' | 'date'
    >,
    tx?: PrismaClientLike,
  ): Promise<StaffAttendance> {
    const client = (tx ?? this.prisma) as PrismaService;
    const existing = await client.staffAttendance.findFirst({
      where: { ...key, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      // createdBy belongs to the original mark; a re-mark only moves
      // updatedBy (and the audit log keeps the full history).
      const updatable = { ...data };
      delete updatable.createdBy;
      return client.staffAttendance.update({
        where: { id: existing.id },
        data: updatable,
      });
    }
    return client.staffAttendance.create({ data: { ...data, ...key } });
  }
}
