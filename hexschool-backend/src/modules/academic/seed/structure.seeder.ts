import type { PrismaClient } from '@prisma/client';

/**
 * Module 06: the five standard BD academic groups (roadmap M06 §3),
 * applicable from class 9. Idempotent — skipped when the school already
 * has any group (schools can rename/remove after seeding).
 */
export const STANDARD_GROUPS = [
  'Science',
  'Commerce',
  'Arts',
  'General',
  'Vocational',
] as const;

export async function seedStandardGroups(
  prisma: PrismaClient,
  schoolId: string,
): Promise<boolean> {
  const existing = await prisma.group.findFirst({
    where: { schoolId, deletedAt: null },
  });
  if (existing) return false;

  await prisma.group.createMany({
    data: STANDARD_GROUPS.map((name) => ({
      schoolId,
      name,
      applicableFromLevel: 9,
    })),
  });
  return true;
}
