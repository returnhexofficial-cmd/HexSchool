import { Injectable } from '@nestjs/common';
import { AdmissionTest, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class AdmissionTestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForCycle(cycleId: string): Promise<AdmissionTest[]> {
    return this.prisma.admissionTest.findMany({ where: { cycleId } });
  }

  async findForCycleClass(
    cycleId: string,
    classId: string,
  ): Promise<AdmissionTest | null> {
    return this.prisma.admissionTest.findFirst({
      where: { cycleId, classId },
    });
  }

  /** Upserts one test slot per class; slots for removed classes stay
   *  (harmless — scheduling is per submitted list, deletion is explicit). */
  async upsertMany(
    cycleId: string,
    entries: Array<{
      classId: string;
      testDate: Date;
      venue?: string;
      totalMarks: number;
      passMarks: number;
      actorId?: string;
    }>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    for (const entry of entries) {
      await client.admissionTest.upsert({
        where: { cycleId_classId: { cycleId, classId: entry.classId } },
        create: {
          cycleId,
          classId: entry.classId,
          testDate: entry.testDate,
          venue: entry.venue,
          totalMarks: entry.totalMarks,
          passMarks: entry.passMarks,
          createdBy: entry.actorId,
          updatedBy: entry.actorId,
        },
        update: {
          testDate: entry.testDate,
          venue: entry.venue,
          totalMarks: entry.totalMarks,
          passMarks: entry.passMarks,
          updatedBy: entry.actorId,
        },
      });
    }
  }
}
