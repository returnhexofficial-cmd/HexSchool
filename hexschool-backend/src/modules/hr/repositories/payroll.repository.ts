import { Injectable } from '@nestjs/common';
import {
  AttendancePersonType,
  BonusRun,
  PayrollRun,
  PayrollRunStatus,
  Payslip,
  PayslipStatus,
  PfEntryType,
  PfLedgerEntry,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type RunWithPayslips = PayrollRun & { payslips: Payslip[] };

@Injectable()
export class PayrollRunsRepository extends BaseRepository<
  PayrollRun,
  Prisma.PayrollRunWhereInput,
  Prisma.PayrollRunUncheckedCreateInput,
  Prisma.PayrollRunUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.payrollRun, 'PayrollRun');
  }

  async findMany(
    schoolId: string,
    filter: { status?: PayrollRunStatus; year?: number },
    page: number,
    limit: number,
  ): Promise<{ rows: PayrollRun[]; total: number }> {
    const where: Prisma.PayrollRunWhereInput = {
      schoolId,
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.year
        ? {
            month: {
              gte: new Date(Date.UTC(filter.year, 0, 1)),
              lte: new Date(Date.UTC(filter.year, 11, 1)),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where,
        orderBy: { month: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return { rows, total };
  }

  /** The live (non-cancelled) run for a month, if any. */
  async findForMonth(
    schoolId: string,
    month: Date,
  ): Promise<PayrollRun | null> {
    return this.prisma.payrollRun.findFirst({
      where: {
        schoolId,
        month,
        deletedAt: null,
        status: { not: PayrollRunStatus.CANCELLED },
      },
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<RunWithPayslips | null> {
    return this.prisma.payrollRun.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        payslips: {
          where: { deletedAt: null },
          orderBy: [{ personType: 'asc' }, { personName: 'asc' }],
        },
      },
    });
  }
}

@Injectable()
export class PayslipsRepository extends BaseRepository<
  Payslip,
  Prisma.PayslipWhereInput,
  Prisma.PayslipUncheckedCreateInput,
  Prisma.PayslipUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.payslip, 'Payslip');
  }

  async findForRun(runId: string): Promise<Payslip[]> {
    return this.prisma.payslip.findMany({
      where: { payrollRunId: runId, deletedAt: null },
      orderBy: [{ personType: 'asc' }, { personName: 'asc' }],
    });
  }

  /**
   * Wipe and rewrite a run's payslips.
   *
   * Regeneration is only ever allowed on a DRAFT/GENERATED run (roadmap
   * §6), and a hard delete is right here: a superseded draft payslip is
   * not history, it is a number nobody has seen. `uq_payslips_person` is
   * what makes the rewrite safe under a double-clicked Generate.
   */
  async replaceForRun(
    runId: string,
    rows: Array<Omit<Prisma.PayslipUncheckedCreateInput, 'payrollRunId'>>,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.payslip.deleteMany({ where: { payrollRunId: runId } });
    for (const row of rows) {
      await client.payslip.create({ data: { ...row, payrollRunId: runId } });
    }
  }

  /** Every payslip a person has ever had, newest run first (YTD reads it). */
  async findForPerson(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
    range?: { from: Date; to: Date },
  ): Promise<Array<Payslip & { payrollRun: PayrollRun }>> {
    return this.prisma.payslip.findMany({
      where: {
        schoolId,
        personType,
        personId,
        deletedAt: null,
        ...(range
          ? { payrollRun: { month: { gte: range.from, lte: range.to } } }
          : {}),
      },
      include: { payrollRun: true },
      orderBy: { payrollRun: { month: 'desc' } },
    });
  }

  /**
   * Payslips across a window, for the register / tax / PF reports. Only
   * runs that actually reached DISBURSED count as money paid — a
   * generated-but-unapproved run is a proposal.
   */
  async findInRange(
    schoolId: string,
    from: Date,
    to: Date,
    options: { disbursedOnly?: boolean } = {},
  ): Promise<Array<Payslip & { payrollRun: PayrollRun }>> {
    return this.prisma.payslip.findMany({
      where: {
        schoolId,
        deletedAt: null,
        payrollRun: {
          month: { gte: from, lte: to },
          deletedAt: null,
          ...(options.disbursedOnly
            ? { status: PayrollRunStatus.DISBURSED }
            : { status: { not: PayrollRunStatus.CANCELLED } }),
        },
      },
      include: { payrollRun: true },
      orderBy: [{ payrollRun: { month: 'asc' } }, { personName: 'asc' }],
    });
  }

  /** The run's payslips that money should actually move for. */
  async findPayable(runId: string): Promise<Payslip[]> {
    return this.prisma.payslip.findMany({
      where: {
        payrollRunId: runId,
        deletedAt: null,
        // A HELD payslip stays in the run and out of both the
        // disbursement and the voucher until it is released (roadmap §6).
        status: { not: PayslipStatus.HELD },
      },
      orderBy: [{ personType: 'asc' }, { personName: 'asc' }],
    });
  }
}

@Injectable()
export class BonusRunsRepository extends BaseRepository<
  BonusRun,
  Prisma.BonusRunWhereInput,
  Prisma.BonusRunUncheckedCreateInput,
  Prisma.BonusRunUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.bonusRun, 'BonusRun');
  }

  async findAllForSchool(schoolId: string): Promise<BonusRun[]> {
    return this.prisma.bonusRun.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: [{ monthPaidWith: 'desc' }, { name: 'asc' }],
    });
  }

  /** The active rounds attached to a payroll month. */
  async findForMonth(schoolId: string, month: Date): Promise<BonusRun[]> {
    return this.prisma.bonusRun.findMany({
      where: {
        schoolId,
        deletedAt: null,
        isActive: true,
        monthPaidWith: month,
      },
      orderBy: { name: 'asc' },
    });
  }
}

@Injectable()
export class PfLedgerRepository extends BaseRepository<
  PfLedgerEntry,
  Prisma.PfLedgerEntryWhereInput,
  Prisma.PfLedgerEntryUncheckedCreateInput,
  Prisma.PfLedgerEntryUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    // Append-only, like `sms_credits` (M17) and `audit_logs` (M03): no
    // `deleted_at` column exists, so soft-delete scoping must be off or
    // every query would filter on a column that is not there.
    super(prisma, (client) => client.pfLedgerEntry, 'PfLedgerEntry', {
      softDeletable: false,
    });
  }

  async findForPerson(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
  ): Promise<PfLedgerEntry[]> {
    return this.prisma.pfLedgerEntry.findMany({
      where: { schoolId, personType, personId },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * The running balance a new row continues from.
   *
   * Read off the last row rather than re-summing the passbook: that is
   * the whole reason `balance_after` is stored (the M17 `sms_credits`
   * pattern), and it keeps a fund statement O(1) to extend.
   */
  async currentBalance(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const last = await client.pfLedgerEntry.findFirst({
      where: { schoolId, personType, personId },
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
      select: { balanceAfter: true },
    });
    return last ? Number(last.balanceAfter) : 0;
  }

  /** Closing balances for the whole workforce, for the PF report. */
  async balancesForSchool(
    schoolId: string,
  ): Promise<
    Map<string, { employee: number; employer: number; balance: number }>
  > {
    const rows = await this.prisma.pfLedgerEntry.findMany({
      where: { schoolId },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
    });

    const totals = new Map<
      string,
      { employee: number; employer: number; balance: number }
    >();
    for (const row of rows) {
      const key = `${row.personType}:${row.personId}`;
      const current = totals.get(key) ?? {
        employee: 0,
        employer: 0,
        balance: 0,
      };
      const sign = row.type === PfEntryType.WITHDRAWAL ? -1 : 1;
      totals.set(key, {
        employee: current.employee + sign * Number(row.employeeAmt),
        employer: current.employer + sign * Number(row.employerAmt),
        balance: Number(row.balanceAfter),
      });
    }
    return totals;
  }

  async findByPayslip(payslipId: string): Promise<PfLedgerEntry | null> {
    return this.prisma.pfLedgerEntry.findFirst({
      where: { payslipId, type: PfEntryType.CONTRIBUTION },
    });
  }

  async deleteForPayslips(payslipIds: string[]): Promise<number> {
    if (payslipIds.length === 0) return 0;
    const result = await this.prisma.pfLedgerEntry.deleteMany({
      where: { payslipId: { in: payslipIds }, type: PfEntryType.CONTRIBUTION },
    });
    return result.count;
  }
}
