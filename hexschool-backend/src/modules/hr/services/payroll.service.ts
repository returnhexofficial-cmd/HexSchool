import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AttendanceStatus,
  AttendancePersonType,
  PayrollRun,
  PayrollRunStatus,
  Payslip,
  PayslipStatus,
  Prisma,
  StaffStatus,
} from '@prisma/client';
import { HolidayAppliesTo, UserType } from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { CalendarService } from '../../academic/services/calendar.service';
import { StaffAttendancesRepository } from '../../attendance/repositories/staff-attendances.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { money, sumMoney } from '../../fee/calc/money.util';
import { PermissionsService } from '../../rbac/services/permissions.service';
import {
  ApprovedLeaveSpan,
  halfDays,
  monthSpan,
  splitLeaveDays,
} from '../calc/leave.engine';
import {
  AdHocLine,
  BonusLine,
  PayrollConfig,
  PayslipComputation,
  bonusAmount,
  computePayslip,
} from '../calc/payroll.engine';
import { computeStructure } from '../calc/salary.engine';
import {
  CancelPayrollDto,
  CreatePayrollRunDto,
  EditPayslipDto,
  GeneratePayrollDto,
  HoldPayslipDto,
  PayrollQueryDto,
} from '../dto';
import {
  Employee,
  EmployeesRepository,
} from '../repositories/employees.repository';
import { LeaveApplicationsRepository } from '../repositories/leave.repository';
import {
  BonusRunsRepository,
  PayrollRunsRepository,
  PayslipsRepository,
  RunWithPayslips,
} from '../repositories/payroll.repository';
import { EmployeeSalariesRepository } from '../repositories/salary.repository';
import { HrConfig, HrSettingsService } from './hr-settings.service';

export interface GenerationWarning {
  code: 'UNMARKED_ATTENDANCE' | 'NO_SALARY' | 'ZERO_PAY';
  message: string;
  details?: unknown;
}

export interface GenerationResult {
  run: RunWithPayslips;
  generated: number;
  skipped: number;
  warnings: GenerationWarning[];
}

/**
 * The monthly payroll run (roadmap M21 §4).
 *
 * The lifecycle is a straight line — DRAFT → GENERATED → APPROVED →
 * DISBURSED, with CANCELLED reachable from any of them — and each step
 * narrows what may still change:
 *
 *   - **DRAFT/GENERATED** payslips may be regenerated (which wipes and
 *     rewrites them) or edited by hand with a reason.
 *   - **APPROVED** freezes them: corrections after this point are next
 *     month's adjustment line, which is the roadmap §6 rule and the same
 *     "published artifacts are immutable" principle as an M15 result or
 *     an M20 voucher.
 *   - **DISBURSED** is the moment money left. It writes the provident-fund
 *     contributions, posts the salary voucher through M20, and is the
 *     only status the payroll reports count as money actually paid.
 *
 * Everything arithmetic lives in `calc/payroll.engine.ts`. This service
 * gathers the facts — the salary in force, the attendance register, the
 * approved leave, the bonus rounds — and hands them over.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly runs: PayrollRunsRepository,
    private readonly payslips: PayslipsRepository,
    private readonly bonuses: BonusRunsRepository,
    private readonly salaries: EmployeeSalariesRepository,
    private readonly employees: EmployeesRepository,
    private readonly leaves: LeaveApplicationsRepository,
    private readonly attendance: StaffAttendancesRepository,
    private readonly calendar: CalendarService,
    private readonly config: HrSettingsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    query: PayrollQueryDto,
    schoolId: string,
  ): Promise<{
    rows: PayrollRun[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows, total } = await this.runs.findMany(
      schoolId,
      { status: query.status, year: query.year },
      page,
      limit,
    );
    return { rows, total, page, limit };
  }

  async getDetail(id: string, schoolId: string): Promise<RunWithPayslips> {
    const run = await this.runs.findDetail(id, schoolId);
    if (!run) throw new NotFoundException(`Payroll run ${id} not found`);
    return run;
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  async create(
    dto: CreatePayrollRunDto,
    actor: AccessTokenPayload,
  ): Promise<RunWithPayslips> {
    const schoolId = actor.schoolId;
    const month = monthStart(dto.month);

    const existing = await this.runs.findForMonth(schoolId, month);
    if (existing) {
      throw new ConflictException(
        `A ${existing.status} payroll run already exists for ${dto.month} — cancel it before starting another`,
      );
    }
    // A payroll for a month that has not started yet would be computed
    // against an attendance register nobody has written.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (month.getTime() > today.getTime()) {
      throw new BadRequestException(
        `${dto.month} has not started — payroll is run for a month, not ahead of it`,
      );
    }

    const created = await this.runs.create({
      schoolId,
      month,
      note: dto.note?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'PayrollRun',
      entityId: created.id,
      newValues: { month: dto.month, status: PayrollRunStatus.DRAFT },
    });
    return this.getDetail(created.id, schoolId);
  }

  /**
   * Compute (or recompute) every payslip in the run.
   *
   * Regeneration is deliberately a **wipe and rewrite**, allowed only
   * while the run is DRAFT or GENERATED (roadmap §6). A superseded draft
   * payslip is not history — it is a number nobody has seen — and
   * diffing would leave a stale row behind whenever somebody's salary
   * assignment was deleted between runs.
   */
  async generate(
    id: string,
    dto: GeneratePayrollDto,
    actor: AccessTokenPayload,
  ): Promise<GenerationResult> {
    const schoolId = actor.schoolId;
    const run = await this.getDetail(id, schoolId);
    this.assertEditable(run, 'regenerated');

    const config = await this.config.load(schoolId);
    const month = run.month;
    const monthEnd = endOfMonth(month);
    const warnings: GenerationWarning[] = [];

    const calendarDays = await this.calendar.workingDays(
      schoolId,
      month,
      monthEnd,
      HolidayAppliesTo.STAFF,
    );
    const divisor =
      config.workingDaysSource === 'FIXED'
        ? config.fixedWorkingDays
        : calendarDays.length;

    if (divisor <= 0) {
      throw new ConflictException(
        `${isoDate(month)} has no working days — check the holiday calendar before running payroll`,
      );
    }

    const [workforce, salaryByPerson, attendanceRows, leaveRows, bonusRuns] =
      await Promise.all([
        this.employees.findMany(schoolId, {
          personType: dto.personType,
          // A leaver still gets a final payslip; the exit-date filter
          // below decides whether this month is one of theirs.
          statuses: [
            StaffStatus.ACTIVE,
            StaffStatus.ON_LEAVE,
            StaffStatus.RESIGNED,
            StaffStatus.TERMINATED,
            StaffStatus.RETIRED,
          ],
        }),
        this.salaries.findEffectiveForAll(schoolId, monthEnd),
        this.attendance.findInRange(schoolId, month, monthEnd, dto.personType),
        this.leaves.findApprovedInRange(schoolId, month, monthEnd),
        this.bonuses.findForMonth(schoolId, month),
      ]);

    // Roadmap §8: attendance not finalized → warn, listing the days, and
    // let it through only with `payroll.generate.force`. The signal is a
    // working day on which NOBODY was marked — that is a register the
    // school never opened, not one person's absence.
    const markedDays = new Set(attendanceRows.map((row) => isoDate(row.date)));
    const unmarked = calendarDays.filter((day) => !markedDays.has(day));
    if (unmarked.length > 0) {
      const warning: GenerationWarning = {
        code: 'UNMARKED_ATTENDANCE',
        message: `${unmarked.length} working day(s) of staff attendance are unmarked — absences on those days will not be deducted`,
        details: { days: unmarked },
      };
      warnings.push(warning);
      if (!dto.force) {
        throw new ConflictException({
          message: warning.message,
          details: { warnings, days: unmarked },
        });
      }
      await this.assertPermission(
        actor,
        'payroll.generate.force',
        'Generating payroll over unmarked attendance requires payroll.generate.force',
      );
    }

    const attendanceByPerson = groupBy(attendanceRows, (row) =>
      key(row.personType, row.personId),
    );
    const leaveByPerson = groupBy(leaveRows, (row) =>
      key(row.personType, row.personId),
    );

    const rows: Array<
      Omit<Prisma.PayslipUncheckedCreateInput, 'payrollRunId'>
    > = [];
    let skipped = 0;

    for (const employee of workforce) {
      const window = employmentWindow(employee, month, monthEnd);
      if (!window.employed) {
        skipped += 1;
        continue;
      }

      const salary = salaryByPerson.get(
        key(employee.personType, employee.personId),
      );
      if (!salary) {
        skipped += 1;
        warnings.push({
          code: 'NO_SALARY',
          message: `${employee.name} (${employee.employeeId}) has no salary assignment effective ${isoDate(monthEnd)} and was skipped`,
        });
        continue;
      }

      const basic =
        salary.basicOverride !== null && salary.basicOverride !== undefined
          ? Number(salary.basicOverride)
          : Number(salary.structure.basic);
      const structure = computeStructure(
        basic,
        salary.structure.components.map((component) => ({
          name: component.name,
          type: component.type === 'DEDUCTION' ? 'DEDUCTION' : 'ALLOWANCE',
          calc:
            component.calc === 'PERCENT_OF_BASIC' ? 'PERCENT_OF_BASIC' : 'FLAT',
          value: Number(component.value),
          isTaxable: component.isTaxable,
          isPfBase: component.isPfBase,
          displayOrder: component.displayOrder,
        })),
        { pfBase: config.pfBase },
      );

      const eligibleDayList = calendarDays.filter(
        (day) => day >= window.from && day <= window.to,
      );
      const eligibleDays =
        config.workingDaysSource === 'FIXED'
          ? Math.round(
              (divisor * eligibleDayList.length) /
                Math.max(1, calendarDays.length),
            )
          : eligibleDayList.length;

      const spans: ApprovedLeaveSpan[] = (
        leaveByPerson.get(key(employee.personType, employee.personId)) ?? []
      ).map((row) => ({
        from: isoDate(row.fromDate),
        to: isoDate(row.toDate),
        isPaid: row.leaveType.isPaid,
        halfDay: row.halfDay,
      }));
      const leaveSplit = splitLeaveDays(spans, eligibleDayList);
      const leaveDates = new Set(
        eligibleDayList.filter((day) =>
          spans.some((span) => day >= span.from && day <= span.to),
        ),
      );

      const attendance = summarizeAttendance(
        attendanceByPerson.get(key(employee.personType, employee.personId)) ??
          [],
        eligibleDayList,
        leaveDates,
      );

      const serviceMonths = monthSpan(
        isoDate(employee.joiningDate),
        isoDate(monthEnd),
      );
      const bonusLines: BonusLine[] = bonusRuns
        .filter(
          (round) =>
            round.applicableTo === 'ALL' ||
            String(round.applicableTo) === employee.personType,
        )
        .map((round) => ({
          name: round.name,
          amount: bonusAmount(
            {
              name: round.name,
              basis: round.basis === 'FLAT' ? 'FLAT' : 'PERCENT_OF_BASIC',
              value: Number(round.value),
              minServiceMonths: round.minServiceMonths,
              prorate: round.prorate,
            },
            structure.basic,
            serviceMonths,
          ),
        }))
        .filter((line) => line.amount > 0);

      const engineConfig = toEngineConfig(config);
      const computed = computePayslip({
        structure,
        workingDays: divisor,
        eligibleDays,
        attendance: {
          presentDays: attendance.present,
          paidLeaveDays: leaveSplit.paid,
          unpaidLeaveDays: leaveSplit.unpaid,
          absentDays: attendance.absent,
        },
        bonuses: bonusLines,
        adHoc: [],
        pfEligible: serviceMonths >= config.pfMinServiceMonths,
        config: engineConfig,
      });

      if (computed.netPayable === 0) {
        warnings.push({
          code: 'ZERO_PAY',
          message: `${employee.name} (${employee.employeeId}) computes to zero net pay`,
        });
      }

      rows.push(
        payslipRow(schoolId, employee, salary.paymentMode, computed, {
          structure,
          divisor,
          eligibleDays,
          attendance,
          leaveSplit,
          bonusLines,
          engineConfig,
          pfEligible: serviceMonths >= config.pfMinServiceMonths,
          actorId: actor.sub,
        }),
      );
    }

    await this.runs.withTransaction(async (tx) => {
      await this.payslips.replaceForRun(run.id, rows, tx);
      await this.runs.update(
        run.id,
        {
          status: PayrollRunStatus.GENERATED,
          workingDays: divisor,
          grossTotal: sumMoney(rows.map((row) => Number(row.gross))),
          netTotal: sumMoney(rows.map((row) => Number(row.netPayable))),
          generatedBy: actor.sub,
          generatedAt: new Date(),
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'PayrollRun',
      entityId: run.id,
      oldValues: { status: run.status, payslips: run.payslips.length },
      newValues: {
        status: PayrollRunStatus.GENERATED,
        payslips: rows.length,
        workingDays: divisor,
        forced: dto.force ?? false,
      },
    });

    return {
      run: await this.getDetail(run.id, schoolId),
      generated: rows.length,
      skipped,
      warnings,
    };
  }

  /** Freeze the run: the payslips stop being editable (roadmap §6). */
  async approve(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<RunWithPayslips> {
    const schoolId = actor.schoolId;
    const run = await this.getDetail(id, schoolId);

    if (run.status !== PayrollRunStatus.GENERATED) {
      throw new ConflictException(
        `Only a GENERATED run can be approved — this one is ${run.status}`,
      );
    }
    if (run.payslips.length === 0) {
      throw new ConflictException(
        'This run has no payslips — generate it before approving',
      );
    }

    await this.runs.update(id, {
      status: PayrollRunStatus.APPROVED,
      approvedBy: actor.sub,
      approvedAt: new Date(),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'PayrollRun',
      entityId: id,
      oldValues: { status: PayrollRunStatus.GENERATED },
      newValues: {
        status: PayrollRunStatus.APPROVED,
        payslips: run.payslips.length,
        netTotal: Number(run.netTotal),
      },
    });
    return this.getDetail(id, schoolId);
  }

  /**
   * Mark the money paid.
   *
   * HELD payslips are excluded here and from the voucher (roadmap §6) —
   * a disciplinary hold is precisely a decision not to pay somebody this
   * month, and including them in the bank advice would undo it.
   *
   * The provident-fund and accounting side effects are the caller's
   * (`PayrollPostingService`), which is what keeps this method about the
   * status change and lets a posting failure be logged rather than
   * rolling back a disbursement that really happened (the M20 rule).
   */
  async markDisbursed(
    id: string,
    payslipIds: string[] | undefined,
    paidAt: Date,
    actor: AccessTokenPayload,
  ): Promise<{ run: RunWithPayslips; paid: Payslip[] }> {
    const schoolId = actor.schoolId;
    const run = await this.getDetail(id, schoolId);

    if (run.status !== PayrollRunStatus.APPROVED) {
      throw new ConflictException(
        `Only an APPROVED run can be disbursed — this one is ${run.status}`,
      );
    }

    const payable = await this.payslips.findPayable(id);
    const selected =
      payslipIds && payslipIds.length > 0
        ? payable.filter((slip) => payslipIds.includes(slip.id))
        : payable;

    if (selected.length === 0) {
      throw new ConflictException(
        'Nothing to disburse — every payslip in this run is held or already paid',
      );
    }

    await this.runs.withTransaction(async (tx) => {
      for (const slip of selected) {
        await this.payslips.update(
          slip.id,
          { status: PayslipStatus.PAID, paidAt, updatedBy: actor.sub },
          tx,
        );
      }
      await this.runs.update(
        id,
        {
          status: PayrollRunStatus.DISBURSED,
          disbursedBy: actor.sub,
          disbursedAt: paidAt,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'PayrollRun',
      entityId: id,
      oldValues: { status: PayrollRunStatus.APPROVED },
      newValues: {
        status: PayrollRunStatus.DISBURSED,
        paid: selected.length,
        held: payable.length - selected.length,
        netTotal: sumMoney(selected.map((slip) => Number(slip.netPayable))),
      },
    });

    return { run: await this.getDetail(id, schoolId), paid: selected };
  }

  /**
   * Cancel a run.
   *
   * A cancelled run keeps its row (and its payslips) but frees the month:
   * `uq_payroll_runs_month` excludes CANCELLED, which is the M11
   * enrollment rule — a cancelled record must not go on holding a slot.
   * A DISBURSED run cannot be cancelled, because the money has gone; the
   * correction is next month's adjustment, and the voucher's correction
   * is an M20 reversal.
   */
  async cancel(
    id: string,
    dto: CancelPayrollDto,
    actor: AccessTokenPayload,
  ): Promise<RunWithPayslips> {
    const schoolId = actor.schoolId;
    const run = await this.getDetail(id, schoolId);

    if (run.status === PayrollRunStatus.DISBURSED) {
      throw new ConflictException(
        'This run has been disbursed — salaries already paid cannot be cancelled; correct them with next month’s adjustment',
      );
    }
    if (run.status === PayrollRunStatus.CANCELLED) {
      throw new ConflictException('This run is already cancelled');
    }

    await this.runs.update(id, {
      status: PayrollRunStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelReason: dto.reason.trim(),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'PayrollRun',
      entityId: id,
      oldValues: { status: run.status },
      newValues: { status: PayrollRunStatus.CANCELLED, reason: dto.reason },
    });
    return this.getDetail(id, schoolId);
  }

  // ── payslips ────────────────────────────────────────────────────────

  async getPayslip(id: string, schoolId: string): Promise<Payslip> {
    const slip = await this.payslips.findById(id, schoolId);
    if (!slip) throw new NotFoundException(`Payslip ${id} not found`);
    return slip;
  }

  /**
   * Override a draft payslip, with a reason (roadmap §5).
   *
   * The recomputation runs the SAME engine over the SAME inputs, which is
   * why the generator stores its input snapshot in `breakdown.input`: an
   * edit that hand-wrote a net figure would leave the payslip's own lines
   * disagreeing with its total, and the salary voucher — derived from
   * net, PF, tax and bonus — would stop balancing.
   */
  async editPayslip(
    id: string,
    dto: EditPayslipDto,
    actor: AccessTokenPayload,
  ): Promise<Payslip> {
    const schoolId = actor.schoolId;
    const slip = await this.getPayslip(id, schoolId);
    const run = await this.getDetail(slip.payrollRunId, schoolId);
    this.assertEditable(run, 'edited');

    const snapshot = readSnapshot(slip);
    if (!snapshot) {
      throw new ConflictException(
        'This payslip has no computation snapshot — regenerate the run before editing it',
      );
    }

    const adHoc: AdHocLine[] = (dto.adHoc ?? snapshot.adHoc ?? []).map(
      (line) => ({
        label: line.label,
        type: line.type === 'DEDUCTION' ? 'DEDUCTION' : 'ALLOWANCE',
        amount: Number(line.amount),
        reason: dto.reason,
      }),
    );
    const bonuses: BonusLine[] =
      dto.bonus !== undefined
        ? [{ name: 'Adjusted bonus', amount: dto.bonus }]
        : (snapshot.bonuses ?? []);

    const computed = computePayslip({
      structure: snapshot.structure,
      workingDays: snapshot.workingDays,
      eligibleDays: snapshot.eligibleDays,
      attendance: snapshot.attendance,
      bonuses,
      adHoc,
      pfEligible: snapshot.pfEligible,
      config: snapshot.config,
    });

    const updated = await this.payslips.update(id, {
      ...money2Columns(computed),
      paymentMode: dto.paymentMode ?? slip.paymentMode,
      editReason: dto.reason.trim(),
      breakdown: {
        ...snapshot.raw,
        lines: computed.lines,
        adHoc,
        bonuses,
        prorationFactor: computed.prorationFactor,
        perDayRate: computed.perDayRate,
        roundingAdjustment: computed.roundingAdjustment,
      } as unknown as Prisma.InputJsonValue,
      updatedBy: actor.sub,
    });

    await this.refreshRunTotals(run.id);

    this.auditContext.set({
      entityType: 'Payslip',
      entityId: id,
      oldValues: { netPayable: Number(slip.netPayable) },
      newValues: {
        netPayable: computed.netPayable,
        reason: dto.reason,
        adHoc: adHoc.length,
      },
    });
    return updated;
  }

  /** Hold a payslip out of the disbursement (disciplinary — roadmap §6). */
  async holdPayslip(
    id: string,
    dto: HoldPayslipDto,
    actor: AccessTokenPayload,
  ): Promise<Payslip> {
    const schoolId = actor.schoolId;
    const slip = await this.getPayslip(id, schoolId);
    if (slip.status === PayslipStatus.PAID) {
      throw new ConflictException(
        'This payslip has already been paid — a hold cannot recall money',
      );
    }

    const updated = await this.payslips.update(id, {
      status: PayslipStatus.HELD,
      holdReason: dto.reason.trim(),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Payslip',
      entityId: id,
      oldValues: { status: slip.status },
      newValues: { status: PayslipStatus.HELD, reason: dto.reason },
    });
    return updated;
  }

  async releasePayslip(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<Payslip> {
    const schoolId = actor.schoolId;
    const slip = await this.getPayslip(id, schoolId);
    if (slip.status !== PayslipStatus.HELD) {
      throw new ConflictException('This payslip is not held');
    }

    const updated = await this.payslips.update(id, {
      status: PayslipStatus.PENDING,
      holdReason: null,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Payslip',
      entityId: id,
      oldValues: { status: PayslipStatus.HELD },
      newValues: { status: PayslipStatus.PENDING },
    });
    return updated;
  }

  /** An employee's own payslip history — the portal and the YTD report. */
  async payslipsForPerson(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
  ): Promise<Array<Payslip & { payrollRun: PayrollRun }>> {
    return this.payslips.findForPerson(schoolId, personType, personId);
  }

  // ── internals ───────────────────────────────────────────────────────

  private assertEditable(run: PayrollRun, verb: string): void {
    if (
      run.status !== PayrollRunStatus.DRAFT &&
      run.status !== PayrollRunStatus.GENERATED
    ) {
      throw new ConflictException(
        `A ${run.status} payroll run cannot be ${verb} — an approved payroll is frozen and corrections go on next month's run (roadmap §6)`,
      );
    }
  }

  private async refreshRunTotals(runId: string): Promise<void> {
    const rows = await this.payslips.findForRun(runId);
    await this.runs.update(runId, {
      grossTotal: sumMoney(rows.map((row) => Number(row.gross))),
      netTotal: sumMoney(rows.map((row) => Number(row.netPayable))),
    });
  }

  private async assertPermission(
    actor: AccessTokenPayload,
    code: string,
    message: string,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes(code)) throw new ForbiddenException(message);
  }
}

// ── helpers ───────────────────────────────────────────────────────────

/** `YYYY-MM` → the first of that month, UTC midnight. */
export function monthStart(month: string): Date {
  const date = parseDate(`${month}-01`);
  return date;
}

export function endOfMonth(month: Date): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
}

function key(personType: AttendancePersonType, personId: string): string {
  return `${personType}:${personId}`;
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(keyOf(row));
    if (list) list.push(row);
    else map.set(keyOf(row), [row]);
  }
  return map;
}

/**
 * The part of the month an employee was actually employed for.
 *
 * `joining_date` has always been recorded; `exit_date` is the M21
 * addition that makes the second half of roadmap §8's "mid-month
 * joiner/exit proration" possible at all.
 */
export function employmentWindow(
  employee: Pick<Employee, 'joiningDate' | 'exitDate' | 'status'>,
  monthStartDate: Date,
  monthEndDate: Date,
): { employed: boolean; from: string; to: string } {
  const joined = isoDate(employee.joiningDate);
  const left = employee.exitDate ? isoDate(employee.exitDate) : null;
  const from =
    joined > isoDate(monthStartDate) ? joined : isoDate(monthStartDate);
  const to =
    left && left < isoDate(monthEndDate) ? left : isoDate(monthEndDate);

  if (joined > isoDate(monthEndDate)) return { employed: false, from, to };
  if (left && left < isoDate(monthStartDate)) {
    return { employed: false, from, to };
  }
  // Somebody who has left and carries no exit date cannot be placed in a
  // month, so they are left out rather than paid a full one by accident.
  if (!left && !PAYABLE.has(employee.status)) {
    return { employed: false, from, to };
  }
  return { employed: from <= to, from, to };
}

const PAYABLE = new Set<StaffStatus>([
  StaffStatus.ACTIVE,
  StaffStatus.ON_LEAVE,
]);

export interface AttendanceTally {
  present: number;
  absent: number;
  marked: number;
}

/**
 * Turn the month's `staff_attendances` rows into day counts.
 *
 * A HALF_DAY is half present and half absent. A day already covered by
 * approved leave is never counted as absence, however it was marked —
 * the leave split has already accounted for it, and counting it twice
 * would deduct for the same day from both sides. An unmarked working day
 * is treated as present: recording an absence is the register's job
 * (M12's auto-absent), and inferring one here would dock pay for the
 * office's backlog — the M15 "a missing mark is INCOMPLETE, never a
 * zero" rule.
 */
export function summarizeAttendance(
  rows: ReadonlyArray<{ date: Date; status: AttendanceStatus }>,
  eligibleDays: readonly string[],
  leaveDates: ReadonlySet<string>,
): AttendanceTally {
  const eligible = new Set(eligibleDays);
  let present = 0;
  let absent = 0;
  let marked = 0;

  for (const row of rows) {
    const day = isoDate(row.date);
    if (!eligible.has(day) || leaveDates.has(day)) continue;
    marked += 1;
    switch (row.status) {
      case AttendanceStatus.PRESENT:
      case AttendanceStatus.LATE:
        present += 1;
        break;
      case AttendanceStatus.HALF_DAY:
        present += 0.5;
        absent += 0.5;
        break;
      case AttendanceStatus.ABSENT:
        absent += 1;
        break;
      default:
        // LEAVE and HOLIDAY rows are not pay events here.
        marked -= 1;
        break;
    }
  }

  const unmarked = eligible.size - leaveDates.size - marked;
  return {
    present: halfDays(present + Math.max(0, unmarked)),
    absent: halfDays(absent),
    marked,
  };
}

function toEngineConfig(config: HrConfig): PayrollConfig {
  return {
    absentDeductionEnabled: config.absentDeductionEnabled,
    absentDeductionBase: config.absentDeductionBase,
    unpaidLeaveDeductionEnabled: config.unpaidLeaveDeductionEnabled,
    pfEnabled: config.pfEnabled,
    pfEmployeePercent: config.pfEmployeePercent,
    pfEmployerPercent: config.pfEmployerPercent,
    taxEnabled: config.taxEnabled,
    taxSlabs: config.taxSlabs,
    taxRebatePercent: config.taxRebatePercent,
    rounding: config.rounding,
  };
}

function money2Columns(computed: PayslipComputation) {
  return {
    basic: computed.basic,
    totalAllowances: computed.totalAllowances,
    gross: computed.gross,
    totalDeductions: computed.totalDeductions,
    attendanceDeduction: computed.attendanceDeduction,
    tax: computed.tax,
    pfEmployee: computed.pfEmployee,
    pfEmployer: computed.pfEmployer,
    bonus: computed.bonus,
    netPayable: computed.netPayable,
  };
}

function payslipRow(
  schoolId: string,
  employee: Employee,
  paymentMode: Prisma.PayslipUncheckedCreateInput['paymentMode'],
  computed: PayslipComputation,
  context: {
    structure: ReturnType<typeof computeStructure>;
    divisor: number;
    eligibleDays: number;
    attendance: AttendanceTally;
    leaveSplit: { paid: number; unpaid: number };
    bonusLines: BonusLine[];
    engineConfig: PayrollConfig;
    pfEligible: boolean;
    actorId: string;
  },
): Omit<Prisma.PayslipUncheckedCreateInput, 'payrollRunId'> {
  return {
    schoolId,
    personType: employee.personType,
    personId: employee.personId,
    personName: employee.name,
    employeeId: employee.employeeId,
    designation: employee.designation,
    ...money2Columns(computed),
    daysPresent: computed.daysPresent,
    daysLeavePaid: computed.daysLeavePaid,
    daysAbsent: computed.daysAbsent,
    daysUnpaidLeave: computed.daysUnpaidLeave,
    workingDays: computed.workingDays,
    paymentMode,
    // The input snapshot is what makes an edit-with-reason recompute
    // exactly, months later, through the same engine — the M14/M15
    // "freeze what you were computed against" rule applied to pay.
    breakdown: {
      lines: computed.lines,
      prorationFactor: computed.prorationFactor,
      perDayRate: computed.perDayRate,
      roundingAdjustment: computed.roundingAdjustment,
      adHoc: [],
      bonuses: context.bonusLines,
      input: {
        structure: context.structure,
        workingDays: context.divisor,
        eligibleDays: context.eligibleDays,
        attendance: {
          presentDays: context.attendance.present,
          paidLeaveDays: context.leaveSplit.paid,
          unpaidLeaveDays: context.leaveSplit.unpaid,
          absentDays: context.attendance.absent,
        },
        pfEligible: context.pfEligible,
        config: context.engineConfig,
      },
    } as unknown as Prisma.InputJsonValue,
    createdBy: context.actorId,
    updatedBy: context.actorId,
  };
}

interface PayslipSnapshot {
  structure: ReturnType<typeof computeStructure>;
  workingDays: number;
  eligibleDays: number;
  attendance: {
    presentDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    absentDays: number;
  };
  pfEligible: boolean;
  config: PayrollConfig;
  adHoc?: AdHocLine[];
  bonuses?: BonusLine[];
  raw: Record<string, unknown>;
}

function readSnapshot(slip: Payslip): PayslipSnapshot | null {
  const breakdown = slip.breakdown as Record<string, unknown> | null;
  const input = breakdown?.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== 'object') return null;
  return {
    structure: input.structure as PayslipSnapshot['structure'],
    workingDays: Number(input.workingDays),
    eligibleDays: Number(input.eligibleDays),
    attendance: input.attendance as PayslipSnapshot['attendance'],
    pfEligible: input.pfEligible === true,
    config: input.config as PayrollConfig,
    adHoc: (breakdown?.adHoc as AdHocLine[]) ?? [],
    bonuses: (breakdown?.bonuses as BonusLine[]) ?? [],
    raw: breakdown ?? {},
  };
}

/** Exposed so the export service prints the same figure the engine used. */
export { money };
