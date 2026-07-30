import { PrismaClient } from '@prisma/client';

/**
 * Default leave taxonomy for a new school (roadmap M21 §3).
 *
 * These six codes are the same ones the M08 `leave_type_enum` carried,
 * plus EARNED — which the enum did not have and which is the one BD
 * schools actually carry forward. Keeping the codes identical is what let
 * the M21 migration move every existing `teacher_leaves` row across
 * without a mapping table.
 *
 * Idempotent like every other seeder here: it inserts only the codes a
 * school does not already have, so a school that renamed "Casual Leave"
 * or changed its quota keeps its version.
 */

export interface LeaveTypeSeed {
  name: string;
  code: string;
  annualQuota: number;
  carryForward: boolean;
  maxCarry: number;
  isPaid: boolean;
  displayOrder: number;
}

export const DEFAULT_LEAVE_TYPES: readonly LeaveTypeSeed[] = [
  {
    name: 'Casual Leave',
    code: 'CASUAL',
    annualQuota: 10,
    carryForward: false,
    maxCarry: 0,
    isPaid: true,
    displayOrder: 1,
  },
  {
    name: 'Sick Leave',
    code: 'SICK',
    annualQuota: 14,
    carryForward: false,
    maxCarry: 0,
    isPaid: true,
    displayOrder: 2,
  },
  {
    name: 'Earned Leave',
    code: 'EARNED',
    annualQuota: 20,
    carryForward: true,
    maxCarry: 40,
    isPaid: true,
    displayOrder: 3,
  },
  {
    // 112 days is the BD public-sector maternity entitlement (16 weeks).
    name: 'Maternity Leave',
    code: 'MATERNITY',
    annualQuota: 112,
    carryForward: false,
    maxCarry: 0,
    isPaid: true,
    displayOrder: 4,
  },
  {
    // The one payroll keys on: `is_paid = false` is what makes the days
    // a deduction rather than an entitlement.
    name: 'Unpaid Leave',
    code: 'UNPAID',
    annualQuota: 0,
    carryForward: false,
    maxCarry: 0,
    isPaid: false,
    displayOrder: 5,
  },
  {
    name: 'Other Leave',
    code: 'OTHER',
    annualQuota: 0,
    carryForward: false,
    maxCarry: 0,
    isPaid: true,
    displayOrder: 6,
  },
];

/** Returns how many types were created. */
export async function seedLeaveTypes(
  prisma: PrismaClient,
  schoolId: string,
): Promise<number> {
  const existing = await prisma.leaveType.findMany({
    where: { schoolId, deletedAt: null },
    select: { code: true },
  });
  const have = new Set(existing.map((row) => row.code));
  const missing = DEFAULT_LEAVE_TYPES.filter((type) => !have.has(type.code));
  if (missing.length === 0) return 0;

  await prisma.leaveType.createMany({
    data: missing.map((type) => ({ ...type, schoolId })),
  });
  return missing.length;
}
