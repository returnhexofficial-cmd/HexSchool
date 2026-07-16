import type { PrismaClient } from '@prisma/client';

/**
 * Module 04 seeders. The bootstrap school row itself is inserted by the
 * migration (it must exist before the users/roles FKs) — here we only
 * seed the NCTB default grading system. Idempotent: skipped when the
 * school already has any grading system.
 */

export const NCTB_GRADES = [
  { grade: 'A+', point: 5.0, minMark: 80, maxMark: 100 },
  { grade: 'A', point: 4.0, minMark: 70, maxMark: 79 },
  { grade: 'A-', point: 3.5, minMark: 60, maxMark: 69 },
  { grade: 'B', point: 3.0, minMark: 50, maxMark: 59 },
  { grade: 'C', point: 2.0, minMark: 40, maxMark: 49 },
  { grade: 'D', point: 1.0, minMark: 33, maxMark: 39 },
  { grade: 'F', point: 0.0, minMark: 0, maxMark: 32 },
] as const;

export async function seedNctbGradingSystem(
  prisma: PrismaClient,
  schoolId: string,
): Promise<boolean> {
  const existing = await prisma.gradingSystem.findFirst({
    where: { schoolId, deletedAt: null },
  });
  if (existing) return false;

  await prisma.$transaction(async (tx) => {
    const system = await tx.gradingSystem.create({
      data: { schoolId, name: 'NCTB Standard', isDefault: true },
    });
    await tx.gradePoint.createMany({
      data: NCTB_GRADES.map((g) => ({ ...g, gradingSystemId: system.id })),
    });
  });
  return true;
}
