import { PrismaClient } from '@prisma/client';

/**
 * The default BD-school chart of accounts (roadmap M20 §4: "COA CRUD with
 * seeded BD-school default tree — Tuition Income, Exam Fee Income, Salary
 * Expense, Utilities, Bank accounts, Cash in Hand…").
 *
 * Codes follow the standard bands (1000 assets, 2000 liabilities, 3000
 * equity, 4000 income, 5000 expense) and are the STABLE handles the
 * posting map falls back to — see `SYSTEM_SLOT_CODES`. A school may
 * rename any of these; the code is what auto-posting resolves through,
 * so renaming "Cash in Hand" to "Office Cash" changes nothing.
 *
 * `isSystem` marks the five accounts auto-posting needs. They can be
 * renamed but never deleted or deactivated, because losing one would
 * silently stop every fee receipt from reaching the ledger.
 *
 * Idempotent, like every seeder here: a school that already has accounts
 * is left completely alone, so a school that reshaped its chart never has
 * the default tree pushed back on top of it.
 */

interface SeedAccount {
  code: string;
  name: string;
  nameBn?: string;
  group: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  type:
    | 'CASH'
    | 'BANK'
    | 'RECEIVABLE'
    | 'PAYABLE'
    | 'INCOME'
    | 'EXPENSE'
    | 'EQUITY'
    | 'OTHER';
  isGroup?: boolean;
  isSystem?: boolean;
  parent?: string;
}

export const DEFAULT_CHART: SeedAccount[] = [
  // ── Assets ────────────────────────────────────────────────────────
  {
    code: '1000',
    name: 'Assets',
    nameBn: 'সম্পদ',
    group: 'ASSET',
    type: 'OTHER',
    isGroup: true,
  },
  {
    code: '1100',
    name: 'Cash & Cash Equivalents',
    group: 'ASSET',
    type: 'OTHER',
    isGroup: true,
    parent: '1000',
  },
  {
    code: '1110',
    name: 'Cash in Hand',
    nameBn: 'হাতে নগদ',
    group: 'ASSET',
    type: 'CASH',
    isSystem: true,
    parent: '1100',
  },
  {
    code: '1120',
    name: 'Petty Cash',
    group: 'ASSET',
    type: 'CASH',
    parent: '1100',
  },
  {
    code: '1200',
    name: 'Bank Accounts',
    group: 'ASSET',
    type: 'OTHER',
    isGroup: true,
    parent: '1000',
  },
  {
    code: '1210',
    name: 'Bank — Current Account',
    group: 'ASSET',
    type: 'BANK',
    parent: '1200',
  },
  {
    code: '1220',
    name: 'Bank — Savings Account',
    group: 'ASSET',
    type: 'BANK',
    parent: '1200',
  },
  {
    code: '1300',
    name: 'Gateway Clearing',
    group: 'ASSET',
    type: 'OTHER',
    isGroup: true,
    parent: '1000',
  },
  // One clearing account per gateway: money is ours from the moment the
  // gateway confirms, but it is not in the bank until settlement (§8).
  {
    code: '1310',
    name: 'bKash Clearing',
    group: 'ASSET',
    type: 'BANK',
    parent: '1300',
  },
  {
    code: '1320',
    name: 'Nagad Clearing',
    group: 'ASSET',
    type: 'BANK',
    parent: '1300',
  },
  {
    code: '1330',
    name: 'SSLCommerz Clearing',
    group: 'ASSET',
    type: 'BANK',
    parent: '1300',
  },
  {
    code: '1400',
    name: 'Receivables',
    group: 'ASSET',
    type: 'OTHER',
    isGroup: true,
    parent: '1000',
  },
  {
    code: '1410',
    name: 'Fees Receivable',
    group: 'ASSET',
    type: 'RECEIVABLE',
    parent: '1400',
  },
  {
    code: '1500',
    name: 'Fixed Assets',
    group: 'ASSET',
    type: 'OTHER',
    isGroup: true,
    parent: '1000',
  },
  {
    code: '1510',
    name: 'Land & Building',
    group: 'ASSET',
    type: 'OTHER',
    parent: '1500',
  },
  {
    code: '1520',
    name: 'Furniture & Fixtures',
    group: 'ASSET',
    type: 'OTHER',
    parent: '1500',
  },
  {
    code: '1530',
    name: 'Books & Library Assets',
    group: 'ASSET',
    type: 'OTHER',
    parent: '1500',
  },
  {
    code: '1540',
    name: 'Computers & Equipment',
    group: 'ASSET',
    type: 'OTHER',
    parent: '1500',
  },
  {
    code: '1550',
    name: 'Vehicles',
    group: 'ASSET',
    type: 'OTHER',
    parent: '1500',
  },

  // ── Liabilities ───────────────────────────────────────────────────
  {
    code: '2000',
    name: 'Liabilities',
    nameBn: 'দায়',
    group: 'LIABILITY',
    type: 'OTHER',
    isGroup: true,
  },
  {
    code: '2100',
    name: 'Current Liabilities',
    group: 'LIABILITY',
    type: 'OTHER',
    isGroup: true,
    parent: '2000',
  },
  {
    code: '2110',
    name: 'Salary Payable',
    group: 'LIABILITY',
    type: 'PAYABLE',
    parent: '2100',
  },
  {
    code: '2120',
    name: 'Provident Fund Payable',
    group: 'LIABILITY',
    type: 'PAYABLE',
    parent: '2100',
  },
  {
    code: '2130',
    name: 'Tax Deducted at Source',
    group: 'LIABILITY',
    type: 'PAYABLE',
    parent: '2100',
  },
  {
    code: '2140',
    name: 'Security Deposits',
    group: 'LIABILITY',
    type: 'PAYABLE',
    parent: '2100',
  },
  {
    code: '2150',
    name: 'Fees Received in Advance',
    group: 'LIABILITY',
    type: 'PAYABLE',
    parent: '2100',
  },
  {
    code: '2200',
    name: 'Long-term Liabilities',
    group: 'LIABILITY',
    type: 'OTHER',
    isGroup: true,
    parent: '2000',
  },
  {
    code: '2210',
    name: 'Bank Loan',
    group: 'LIABILITY',
    type: 'PAYABLE',
    parent: '2200',
  },

  // ── Equity ────────────────────────────────────────────────────────
  {
    code: '3000',
    name: 'Equity & Fund',
    group: 'EQUITY',
    type: 'OTHER',
    isGroup: true,
  },
  {
    code: '3100',
    name: 'Capital Fund',
    nameBn: 'মূলধন তহবিল',
    group: 'EQUITY',
    type: 'EQUITY',
    isSystem: true,
    parent: '3000',
  },
  {
    code: '3200',
    name: 'Accumulated Surplus',
    group: 'EQUITY',
    type: 'EQUITY',
    parent: '3000',
  },
  {
    code: '3300',
    name: 'Donations & Grants Fund',
    group: 'EQUITY',
    type: 'EQUITY',
    parent: '3000',
  },

  // ── Income ────────────────────────────────────────────────────────
  {
    code: '4000',
    name: 'Income',
    nameBn: 'আয়',
    group: 'INCOME',
    type: 'OTHER',
    isGroup: true,
  },
  {
    code: '4100',
    name: 'Tuition Fee Income',
    nameBn: 'টিউশন ফি',
    group: 'INCOME',
    type: 'INCOME',
    isSystem: true,
    parent: '4000',
  },
  {
    code: '4110',
    name: 'Admission Fee Income',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },
  {
    code: '4120',
    name: 'Exam Fee Income',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },
  {
    code: '4130',
    name: 'Transport Fee Income',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },
  {
    code: '4140',
    name: 'Hostel Fee Income',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },
  {
    code: '4150',
    name: 'Library Fee Income',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },
  {
    code: '4160',
    name: 'Development Fee Income',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },
  {
    code: '4200',
    name: 'Government Grant',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },
  {
    code: '4300',
    name: 'Donation Income',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },
  {
    code: '4400',
    name: 'Late Fine Income',
    group: 'INCOME',
    type: 'INCOME',
    isSystem: true,
    parent: '4000',
  },
  {
    code: '4900',
    name: 'Other Income',
    group: 'INCOME',
    type: 'INCOME',
    parent: '4000',
  },

  // ── Expenses ──────────────────────────────────────────────────────
  {
    code: '5000',
    name: 'Expenditure',
    nameBn: 'ব্যয়',
    group: 'EXPENSE',
    type: 'OTHER',
    isGroup: true,
  },
  {
    code: '5100',
    name: 'Salary & Allowances',
    nameBn: 'বেতন ও ভাতা',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5110',
    name: 'Festival Bonus',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5120',
    name: 'Provident Fund Contribution',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5200',
    name: 'Utilities',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5210',
    name: 'Electricity',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5200',
  },
  {
    code: '5220',
    name: 'Water & Gas',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5200',
  },
  {
    code: '5230',
    name: 'Internet & Telephone',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5200',
  },
  {
    code: '5300',
    name: 'Rent',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5400',
    name: 'Repairs & Maintenance',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5500',
    name: 'Printing & Stationery',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5600',
    name: 'Bank & Gateway Charges',
    group: 'EXPENSE',
    type: 'EXPENSE',
    isSystem: true,
    parent: '5000',
  },
  {
    code: '5700',
    name: 'Examination Expense',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5800',
    name: 'Transport Expense',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5810',
    name: 'Sports & Cultural Expense',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5820',
    name: 'Advertisement & Publicity',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
  {
    code: '5900',
    name: 'Miscellaneous Expense',
    group: 'EXPENSE',
    type: 'EXPENSE',
    parent: '5000',
  },
];

/**
 * Insert the default chart if the school has none. Returns how many rows
 * were created (0 when the school already keeps accounts).
 */
export async function seedChartOfAccounts(
  prisma: PrismaClient,
  schoolId: string,
): Promise<number> {
  const existing = await prisma.account.count({
    where: { schoolId, deletedAt: null },
  });
  if (existing > 0) return 0;

  const idByCode = new Map<string, string>();
  let order = 0;

  // Inserted parents-first (the array is already in that order) so each
  // child can resolve its parent id — a plain `createMany` could not.
  for (const account of DEFAULT_CHART) {
    const created = await prisma.account.create({
      data: {
        schoolId,
        code: account.code,
        name: account.name,
        nameBn: account.nameBn ?? null,
        group: account.group,
        type: account.type,
        isGroup: account.isGroup ?? false,
        isSystem: account.isSystem ?? false,
        parentId: account.parent
          ? (idByCode.get(account.parent) ?? null)
          : null,
        displayOrder: order,
      },
      select: { id: true },
    });
    idByCode.set(account.code, created.id);
    order += 1;
  }

  return DEFAULT_CHART.length;
}
