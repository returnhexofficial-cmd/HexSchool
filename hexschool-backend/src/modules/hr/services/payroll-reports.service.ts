import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendancePersonType, PayrollRun, Payslip } from '@prisma/client';
import { isoDate } from '../../academic/calendar/date.util';
import { money, sumMoney } from '../../fee/calc/money.util';
import { computeStructure } from '../calc/salary.engine';
import { PayrollReportQueryDto } from '../dto';
import { EmployeesRepository } from '../repositories/employees.repository';
import {
  PayrollRunsRepository,
  PayslipsRepository,
  PfLedgerRepository,
} from '../repositories/payroll.repository';
import {
  EmployeeSalariesRepository,
  SalaryStructuresRepository,
} from '../repositories/salary.repository';
import { HrSettingsService } from './hr-settings.service';
import { endOfMonth, monthStart } from './payroll.service';

export interface ReportWindow {
  from: string;
  to: string;
}

export interface RegisterRow {
  personType: AttendancePersonType;
  personId: string;
  employeeId: string;
  name: string;
  designation: string | null;
  basic: number;
  allowances: number;
  gross: number;
  attendanceDeduction: number;
  otherDeductions: number;
  pfEmployee: number;
  tax: number;
  bonus: number;
  netPayable: number;
  daysPresent: number;
  daysAbsent: number;
  workingDays: number;
  status: string;
}

export interface RegisterReport extends ReportWindow {
  runs: Array<{ id: string; month: string; status: string }>;
  rows: RegisterRow[];
  totals: Omit<
    RegisterRow,
    | 'personType'
    | 'personId'
    | 'employeeId'
    | 'name'
    | 'designation'
    | 'daysPresent'
    | 'daysAbsent'
    | 'workingDays'
    | 'status'
  >;
}

export interface PfReportRow {
  personType: AttendancePersonType;
  personId: string;
  employeeId: string;
  name: string;
  employeeTotal: number;
  employerTotal: number;
  withdrawn: number;
  balance: number;
}

export interface TaxReportRow {
  personType: AttendancePersonType;
  personId: string;
  employeeId: string;
  name: string;
  taxableGross: number;
  taxDeducted: number;
  months: number;
}

export interface GradeDistributionRow {
  structureId: string;
  structureName: string;
  grade: string | null;
  basic: number;
  gross: number;
  headcount: number;
}

export interface YtdRow {
  month: string;
  runId: string;
  gross: number;
  deductions: number;
  pfEmployee: number;
  tax: number;
  bonus: number;
  netPayable: number;
  status: string;
}

export interface YtdReport extends ReportWindow {
  employee: {
    personType: AttendancePersonType;
    personId: string;
    name: string;
    employeeId: string;
  };
  rows: YtdRow[];
  totals: Omit<YtdRow, 'month' | 'runId' | 'status'>;
}

/**
 * The five payroll reports (roadmap M21 §4).
 *
 * Every one of them reads **disbursed** runs by default: a generated or
 * approved run is a proposal, and a tax summary that counted proposals
 * would report deductions the revenue board never received. The register
 * is the exception — it is the working document for one specific run, so
 * it reports whatever that run currently says.
 *
 * The shape/renderer split follows M12: this service owns the JSON the
 * UI reads, `PayrollExportService` is pure presentation over these
 * shapes, so an XLSX column can change without touching an API contract.
 */
@Injectable()
export class PayrollReportsService {
  constructor(
    private readonly runs: PayrollRunsRepository,
    private readonly payslips: PayslipsRepository,
    private readonly pf: PfLedgerRepository,
    private readonly employees: EmployeesRepository,
    private readonly salaries: EmployeeSalariesRepository,
    private readonly structures: SalaryStructuresRepository,
    private readonly config: HrSettingsService,
  ) {}

  /** Monthly payroll register — one row per employee, per run. */
  async register(
    query: PayrollReportQueryDto,
    schoolId: string,
  ): Promise<RegisterReport> {
    const {
      rows: slips,
      runs,
      window,
    } = await this.load(query, schoolId, {
      disbursedOnly: false,
    });

    const rows: RegisterRow[] = slips
      .filter(
        (slip) => !query.personType || slip.personType === query.personType,
      )
      .map((slip) => ({
        personType: slip.personType,
        personId: slip.personId,
        employeeId: slip.employeeId,
        name: slip.personName,
        designation: slip.designation,
        basic: Number(slip.basic),
        allowances: Number(slip.totalAllowances),
        gross: Number(slip.gross),
        attendanceDeduction: Number(slip.attendanceDeduction),
        otherDeductions: money(
          Number(slip.totalDeductions) -
            Number(slip.attendanceDeduction) -
            Number(slip.pfEmployee) -
            Number(slip.tax),
        ),
        pfEmployee: Number(slip.pfEmployee),
        tax: Number(slip.tax),
        bonus: Number(slip.bonus),
        netPayable: Number(slip.netPayable),
        daysPresent: Number(slip.daysPresent),
        daysAbsent: Number(slip.daysAbsent),
        workingDays: slip.workingDays,
        status: slip.status,
      }));

    return {
      ...window,
      runs: runs.map((run) => ({
        id: run.id,
        month: isoDate(run.month).slice(0, 7),
        status: run.status,
      })),
      rows,
      totals: {
        basic: sumMoney(rows.map((row) => row.basic)),
        allowances: sumMoney(rows.map((row) => row.allowances)),
        gross: sumMoney(rows.map((row) => row.gross)),
        attendanceDeduction: sumMoney(
          rows.map((row) => row.attendanceDeduction),
        ),
        otherDeductions: sumMoney(rows.map((row) => row.otherDeductions)),
        pfEmployee: sumMoney(rows.map((row) => row.pfEmployee)),
        tax: sumMoney(rows.map((row) => row.tax)),
        bonus: sumMoney(rows.map((row) => row.bonus)),
        netPayable: sumMoney(rows.map((row) => row.netPayable)),
      },
    };
  }

  /** Provident-fund position per employee. */
  async pfReport(schoolId: string): Promise<{
    rows: PfReportRow[];
    totals: Omit<
      PfReportRow,
      'personType' | 'personId' | 'employeeId' | 'name'
    >;
  }> {
    const [totalsByPerson, workforce] = await Promise.all([
      this.pf.balancesForSchool(schoolId),
      this.employees.findMany(schoolId, {
        // Somebody who has left may still hold a fund balance until it is
        // withdrawn, so this report deliberately spans every status.
        statuses: [
          'ACTIVE',
          'ON_LEAVE',
          'RESIGNED',
          'TERMINATED',
          'RETIRED',
        ] as never,
      }),
    ]);

    const byKey = new Map(
      workforce.map((person) => [
        `${person.personType}:${person.personId}`,
        person,
      ]),
    );

    const rows: PfReportRow[] = [];
    for (const [key, totals] of totalsByPerson) {
      const employee = byKey.get(key);
      const [personType, personId] = key.split(':');
      const employeeTotal = money(Math.max(0, totals.employee));
      const employerTotal = money(Math.max(0, totals.employer));
      rows.push({
        personType: personType as AttendancePersonType,
        personId,
        employeeId: employee?.employeeId ?? '—',
        name: employee?.name ?? '(removed)',
        employeeTotal,
        employerTotal,
        withdrawn: money(
          Math.max(0, employeeTotal + employerTotal - totals.balance),
        ),
        balance: money(totals.balance),
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return {
      rows,
      totals: {
        employeeTotal: sumMoney(rows.map((row) => row.employeeTotal)),
        employerTotal: sumMoney(rows.map((row) => row.employerTotal)),
        withdrawn: sumMoney(rows.map((row) => row.withdrawn)),
        balance: sumMoney(rows.map((row) => row.balance)),
      },
    };
  }

  /** Tax deducted at source, per employee, over a window. */
  async taxReport(
    query: PayrollReportQueryDto,
    schoolId: string,
  ): Promise<{ window: ReportWindow; rows: TaxReportRow[]; total: number }> {
    const { rows: slips, window } = await this.load(query, schoolId, {
      disbursedOnly: true,
    });

    const byPerson = new Map<string, TaxReportRow>();
    for (const slip of slips) {
      if (Number(slip.tax) <= 0) continue;
      const key = `${slip.personType}:${slip.personId}`;
      const current = byPerson.get(key) ?? {
        personType: slip.personType,
        personId: slip.personId,
        employeeId: slip.employeeId,
        name: slip.personName,
        taxableGross: 0,
        taxDeducted: 0,
        months: 0,
      };
      current.taxableGross = money(current.taxableGross + Number(slip.gross));
      current.taxDeducted = money(current.taxDeducted + Number(slip.tax));
      current.months += 1;
      byPerson.set(key, current);
    }

    const rows = [...byPerson.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return {
      window,
      rows,
      total: sumMoney(rows.map((row) => row.taxDeducted)),
    };
  }

  /**
   * Salary-grade distribution: how many people sit on each scale, and
   * what that scale costs. Read from the CURRENT assignments rather than
   * from payslips, because the question is what the school is committed
   * to paying, not what it paid last month.
   */
  async gradeDistribution(schoolId: string): Promise<{
    rows: GradeDistributionRow[];
    headcount: number;
    monthlyCost: number;
  }> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [assignments, structures, config] = await Promise.all([
      this.salaries.findEffectiveForAll(schoolId, today),
      this.structures.findAllForSchool(schoolId),
      this.config.load(schoolId),
    ]);

    const counts = new Map<string, number>();
    for (const assignment of assignments.values()) {
      counts.set(
        assignment.structureId,
        (counts.get(assignment.structureId) ?? 0) + 1,
      );
    }

    const rows: GradeDistributionRow[] = structures
      .map((structure) => {
        const computed = computeStructure(
          Number(structure.basic),
          structure.components.map((component) => ({
            name: component.name,
            type: component.type === 'DEDUCTION' ? 'DEDUCTION' : 'ALLOWANCE',
            calc:
              component.calc === 'PERCENT_OF_BASIC'
                ? 'PERCENT_OF_BASIC'
                : 'FLAT',
            value: Number(component.value),
            isTaxable: component.isTaxable,
            isPfBase: component.isPfBase,
          })),
          { pfBase: config.pfBase },
        );
        return {
          structureId: structure.id,
          structureName: structure.name,
          grade: structure.grade,
          basic: computed.basic,
          gross: computed.gross,
          headcount: counts.get(structure.id) ?? 0,
        };
      })
      .filter((row) => row.headcount > 0 || row.basic > 0)
      .sort((a, b) => b.gross - a.gross);

    return {
      rows,
      headcount: rows.reduce((sum, row) => sum + row.headcount, 0),
      monthlyCost: sumMoney(
        rows.map((row) => money(row.gross * row.headcount)),
      ),
    };
  }

  /** Year-to-date for one employee. */
  async ytd(
    query: PayrollReportQueryDto,
    schoolId: string,
  ): Promise<YtdReport> {
    if (!query.personType || !query.personId) {
      throw new BadRequestException(
        'personType and personId are required for the year-to-date report',
      );
    }
    const employee = await this.employees.findOne(
      schoolId,
      query.personType,
      query.personId,
    );
    const window = this.window(query);
    const slips = await this.payslips.findForPerson(
      schoolId,
      query.personType,
      query.personId,
      { from: monthStart(window.from), to: monthStart(window.to) },
    );

    const rows: YtdRow[] = slips
      .slice()
      .sort(
        (a, b) => a.payrollRun.month.getTime() - b.payrollRun.month.getTime(),
      )
      .map((slip) => ({
        month: isoDate(slip.payrollRun.month).slice(0, 7),
        runId: slip.payrollRunId,
        gross: Number(slip.gross),
        deductions: Number(slip.totalDeductions),
        pfEmployee: Number(slip.pfEmployee),
        tax: Number(slip.tax),
        bonus: Number(slip.bonus),
        netPayable: Number(slip.netPayable),
        status: slip.payrollRun.status,
      }));

    return {
      ...window,
      employee: {
        personType: query.personType,
        personId: query.personId,
        name: employee?.name ?? slips[0]?.personName ?? '(removed)',
        employeeId: employee?.employeeId ?? slips[0]?.employeeId ?? '—',
      },
      rows,
      totals: {
        gross: sumMoney(rows.map((row) => row.gross)),
        deductions: sumMoney(rows.map((row) => row.deductions)),
        pfEmployee: sumMoney(rows.map((row) => row.pfEmployee)),
        tax: sumMoney(rows.map((row) => row.tax)),
        bonus: sumMoney(rows.map((row) => row.bonus)),
        netPayable: sumMoney(rows.map((row) => row.netPayable)),
      },
    };
  }

  /**
   * The bank advice sheet's rows: who to pay, how much, and into which
   * account. HELD payslips are absent by construction (`findPayable`),
   * because the whole point of a hold is that the bank must not be told
   * to pay that person this month.
   */
  async bankAdvice(
    runId: string,
    schoolId: string,
  ): Promise<{
    run: PayrollRun;
    rows: Array<{
      employeeId: string;
      name: string;
      bankName: string | null;
      branchName: string | null;
      accountNo: string | null;
      accountName: string | null;
      routingNo: string | null;
      paymentMode: string;
      amount: number;
    }>;
    total: number;
  }> {
    const run = await this.runs.findByIdOrFail(runId, schoolId);
    const payslips = await this.payslips.findPayable(runId);
    const salaries = await this.salaries.findEffectiveForAll(
      schoolId,
      endOfMonth(run.month),
    );

    const rows = payslips.map((slip) => {
      const assignment = salaries.get(`${slip.personType}:${slip.personId}`);
      const account = (assignment?.bankAccount ?? {}) as Record<
        string,
        unknown
      >;
      return {
        employeeId: slip.employeeId,
        name: slip.personName,
        bankName: str(account.bankName),
        branchName: str(account.branchName),
        accountNo: str(account.accountNo),
        accountName: str(account.accountName) ?? slip.personName,
        routingNo: str(account.routingNo),
        paymentMode: slip.paymentMode,
        amount: Number(slip.netPayable),
      };
    });

    return { run, rows, total: sumMoney(rows.map((row) => row.amount)) };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async load(
    query: PayrollReportQueryDto,
    schoolId: string,
    options: { disbursedOnly: boolean },
  ): Promise<{
    rows: Array<Payslip & { payrollRun: PayrollRun }>;
    runs: PayrollRun[];
    window: ReportWindow;
  }> {
    if (query.runId) {
      const run = await this.runs.findByIdOrFail(query.runId, schoolId);
      const slips = await this.payslips.findInRange(
        schoolId,
        run.month,
        run.month,
        { disbursedOnly: false },
      );
      const rows = slips.filter((slip) => slip.payrollRunId === run.id);
      const label = isoDate(run.month).slice(0, 7);
      return { rows, runs: [run], window: { from: label, to: label } };
    }

    const window = this.window(query);
    const rows = await this.payslips.findInRange(
      schoolId,
      monthStart(window.from),
      monthStart(window.to),
      options,
    );
    const runs = [
      ...new Map(
        rows.map((row) => [row.payrollRunId, row.payrollRun]),
      ).values(),
    ];
    return { rows, runs, window };
  }

  /** Defaults to the current calendar year, which is what YTD means. */
  private window(query: PayrollReportQueryDto): ReportWindow {
    const now = new Date();
    const year = now.getUTCFullYear();
    return {
      from: query.from ?? `${year}-01`,
      to:
        query.to ?? `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
    };
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
