import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NotificationChannel,
  NotificationRecipientType,
  PaymentMode,
  PayrollRun,
  Payslip,
  PfEntryType,
  VoucherSource,
  VoucherType,
} from '@prisma/client';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { SYSTEM_SLOTS } from '../../accounting/calc/posting.engine';
import { DraftEntry } from '../../accounting/calc/voucher.engine';
import { PostingMapService } from '../../accounting/services/posting-map.service';
import { VoucherService } from '../../accounting/services/voucher.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { NotificationService } from '../../communication/services/notification.service';
import { formatMoney, money, sumMoney } from '../../fee/calc/money.util';
import { salaryExpenseFor } from '../calc/payroll.engine';
import { DisbursePayrollDto } from '../dto';
import { HR_EVENTS, PayrollDisbursedEvent } from '../events/hr.events';
import { EmployeesRepository } from '../repositories/employees.repository';
import {
  PayrollRunsRepository,
  PfLedgerRepository,
} from '../repositories/payroll.repository';
import { HrSettingsService } from './hr-settings.service';
import { PayrollService } from './payroll.service';

export interface DisbursementResult {
  run: PayrollRun;
  paid: number;
  held: number;
  netTotal: number;
  voucherNo: string | null;
  pfEntries: number;
  notified: number;
}

/**
 * Everything that happens the moment salaries are paid.
 *
 * `PayrollService.markDisbursed` owns the status change; this service
 * owns the consequences — the provident-fund passbook, the M20 salary
 * voucher, the payslip SMS. They are separated for the reason M20 gives
 * for swallowing an auto-post failure: **the money has already moved**.
 * A misconfigured chart of accounts must not roll back a disbursement
 * that really happened, so each consequence is attempted, logged, and
 * reported back rather than allowed to throw.
 *
 * The voucher itself is built from four stored payslip columns:
 *
 * ```
 *   Dr Salary & Allowances   net + pfEmployee + tax − bonus   (per payslip)
 *   Dr Festival Bonus        bonus
 *   Dr PF Contribution       pfEmployer
 *      Cr Provident Fund Payable   pfEmployee + pfEmployer
 *      Cr Tax Payable              tax
 *      Cr Bank / Cash              net
 * ```
 *
 * Solve those for the debit side and you get `salaryExpenseFor` exactly —
 * which is why this voucher balances to the paisa with no splitting or
 * largest-remainder arithmetic, and keeps balancing after a payslip is
 * edited by hand.
 */
@Injectable()
export class PayrollPostingService {
  private readonly logger = new Logger(PayrollPostingService.name);

  constructor(
    private readonly payroll: PayrollService,
    private readonly runs: PayrollRunsRepository,
    private readonly pf: PfLedgerRepository,
    private readonly employees: EmployeesRepository,
    private readonly vouchers: VoucherService,
    private readonly postingMap: PostingMapService,
    private readonly notifications: NotificationService,
    private readonly config: HrSettingsService,
    private readonly events: EventEmitter2,
  ) {}

  async disburse(
    id: string,
    dto: DisbursePayrollDto,
    actor: AccessTokenPayload,
  ): Promise<DisbursementResult> {
    const schoolId = actor.schoolId;
    const config = await this.config.load(schoolId);
    const paidAt = dto.paidOn ? parseDate(dto.paidOn) : today();

    const { run, paid } = await this.payroll.markDisbursed(
      id,
      dto.payslipIds,
      paidAt,
      actor,
    );

    const pfEntries = config.pfEnabled
      ? await this.recordProvidentFund(schoolId, run, paid, actor.sub)
      : 0;

    const voucherNo = config.autoPostAccounting
      ? await this.postSalaryVoucher(schoolId, run, paid, paidAt, actor.sub)
      : null;

    const notified = config.payslipSms
      ? await this.notifyEmployees(schoolId, run, paid)
      : 0;

    this.events.emit(HR_EVENTS.PAYROLL_DISBURSED, {
      runId: run.id,
      schoolId,
      month: isoDate(run.month),
      payslipCount: paid.length,
      netTotal: sumMoney(paid.map((slip) => Number(slip.netPayable))),
    } satisfies PayrollDisbursedEvent);

    return {
      run,
      paid: paid.length,
      held: run.payslips.filter((slip) => slip.status === 'HELD').length,
      netTotal: sumMoney(paid.map((slip) => Number(slip.netPayable))),
      voucherNo,
      pfEntries,
      notified,
    };
  }

  // ── provident fund ──────────────────────────────────────────────────

  /**
   * Write one CONTRIBUTION row per paid payslip that has a fund movement.
   *
   * `uq_pf_ledger_payslip` is the guarantee, not the existence check
   * below: a retried disbursement, a double-clicked button and a replayed
   * job all have to leave ONE row, and a duplicated contribution would be
   * invisible — the passbook would simply look like a generous month.
   * Same reasoning as M20's `source_ref` idempotency key.
   */
  private async recordProvidentFund(
    schoolId: string,
    run: PayrollRun,
    payslips: Payslip[],
    actorId: string,
  ): Promise<number> {
    let written = 0;
    for (const slip of payslips) {
      const employee = Number(slip.pfEmployee);
      const employer = Number(slip.pfEmployer);
      if (employee + employer <= 0) continue;

      try {
        const existing = await this.pf.findByPayslip(slip.id);
        if (existing) continue;

        const balance = await this.pf.currentBalance(
          schoolId,
          slip.personType,
          slip.personId,
        );
        await this.pf.create({
          schoolId,
          personType: slip.personType,
          personId: slip.personId,
          month: run.month,
          type: PfEntryType.CONTRIBUTION,
          employeeAmt: employee,
          employerAmt: employer,
          balanceAfter: money(balance + employee + employer),
          payslipId: slip.id,
          note: `Payroll ${isoDate(run.month).slice(0, 7)}`,
          createdBy: actorId,
        });
        written += 1;
      } catch (error) {
        // Lost a race against the unique index, or a bad row. The salary
        // is already paid; the fund entry is retryable and reported.
        this.logger.error(
          `Provident-fund entry for payslip ${slip.id} failed: ${(error as Error).message}`,
        );
      }
    }
    return written;
  }

  // ── accounting ──────────────────────────────────────────────────────

  private async postSalaryVoucher(
    schoolId: string,
    run: PayrollRun,
    payslips: Payslip[],
    date: Date,
    actorId: string,
  ): Promise<string | null> {
    try {
      const map = await this.postingMap.resolve(schoolId);
      const slot = (name: string): string | null =>
        this.postingMap.slot(map, name as never);

      const totals = {
        salary: sumMoney(
          payslips.map((slip) => salaryExpenseFor(numbers(slip))),
        ),
        bonus: sumMoney(payslips.map((slip) => Number(slip.bonus))),
        pfEmployee: sumMoney(payslips.map((slip) => Number(slip.pfEmployee))),
        pfEmployer: sumMoney(payslips.map((slip) => Number(slip.pfEmployer))),
        tax: sumMoney(payslips.map((slip) => Number(slip.tax))),
        net: sumMoney(payslips.map((slip) => Number(slip.netPayable))),
      };

      const salaryAccount = slot(SYSTEM_SLOTS.SALARY_EXPENSE);
      const fundsAccount = this.fundsAccountFor(map, payslips, slot);
      if (!salaryAccount || !fundsAccount) {
        this.logger.error(
          `Payroll ${run.id} not posted: no ${salaryAccount ? 'funds' : 'salary expense'} account is mapped`,
        );
        return null;
      }

      const entries: DraftEntry[] = [];
      const push = (
        accountId: string | null,
        amount: number,
        side: 'DEBIT' | 'CREDIT',
        narration: string,
      ) => {
        if (!accountId || amount <= 0) return;
        entries.push({
          accountId,
          debit: side === 'DEBIT' ? amount : 0,
          credit: side === 'CREDIT' ? amount : 0,
          narration,
        });
      };

      push(salaryAccount, totals.salary, 'DEBIT', 'Salaries & allowances');
      push(
        slot(SYSTEM_SLOTS.BONUS_EXPENSE) ?? salaryAccount,
        totals.bonus,
        'DEBIT',
        'Bonus',
      );
      push(
        slot(SYSTEM_SLOTS.PF_EXPENSE) ?? salaryAccount,
        totals.pfEmployer,
        'DEBIT',
        "Employer's provident-fund contribution",
      );
      push(
        slot(SYSTEM_SLOTS.PF_PAYABLE),
        money(totals.pfEmployee + totals.pfEmployer),
        'CREDIT',
        'Provident fund payable',
      );
      push(
        slot(SYSTEM_SLOTS.TAX_PAYABLE),
        totals.tax,
        'CREDIT',
        'Tax deducted at source',
      );
      push(fundsAccount, totals.net, 'CREDIT', 'Net salary disbursed');

      if (entries.length === 0) return null;

      const monthLabel = isoDate(run.month).slice(0, 7);
      const voucher = await this.vouchers.postAuto({
        schoolId,
        // Money leaving the school is a payment (debit) voucher — what a
        // BD cash book calls a DV.
        type: VoucherType.DEBIT,
        source: VoucherSource.PAYROLL,
        sourceRef: `payroll:${run.id}`,
        date,
        narration: `Salary disbursement for ${monthLabel} (${payslips.length} employee(s))`,
        reference: monthLabel,
        actorId,
        entries,
      });

      if (voucher) {
        await this.runs.update(run.id, { voucherId: voucher.id });
        return voucher.voucherNo;
      }
      return null;
    } catch (error) {
      // The M20 rule: an auto-post failure is logged and swallowed. The
      // salaries have been paid; refusing to record that because the
      // chart of accounts is misconfigured is strictly worse than a
      // ledger gap an operator can fix and re-post.
      this.logger.error(
        `Salary voucher for payroll ${run.id} failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Where the money actually left from.
   *
   * A school paying by bank transfer credits its bank; one paying cash
   * credits the cash box. The run's dominant payment mode decides, and
   * CASH falls back to the seeded cash account — the same
   * resolve-by-account-code fallback M20 uses so a fresh school posts
   * correctly with nothing configured.
   */
  private fundsAccountFor(
    map: Awaited<ReturnType<PostingMapService['resolve']>>,
    payslips: Payslip[],
    slot: (name: string) => string | null,
  ): string | null {
    const cashCount = payslips.filter(
      (slip) => slip.paymentMode === PaymentMode.CASH,
    ).length;
    const mode =
      cashCount > payslips.length / 2 ? PaymentMode.CASH : PaymentMode.BANK;
    return (
      map.methods.get(mode) ??
      map.methods.get(mode === PaymentMode.CASH ? 'CASH' : 'BANK') ??
      slot(SYSTEM_SLOTS.CASH_DEFAULT)
    );
  }

  // ── notification ────────────────────────────────────────────────────

  private async notifyEmployees(
    schoolId: string,
    run: PayrollRun,
    payslips: Payslip[],
  ): Promise<number> {
    const people = await this.employees.findManyByKeys(
      schoolId,
      payslips.map((slip) => ({
        personType: slip.personType,
        personId: slip.personId,
      })),
    );
    const byKey = new Map(
      people.map((person) => [
        `${person.personType}:${person.personId}`,
        person,
      ]),
    );
    const monthLabel = isoDate(run.month).slice(0, 7);

    let sent = 0;
    for (const slip of payslips) {
      const employee = byKey.get(`${slip.personType}:${slip.personId}`);
      if (!employee?.phone) continue;
      try {
        await this.notifications.send({
          schoolId,
          code: 'PAYSLIP_READY',
          channel: NotificationChannel.SMS,
          recipient: {
            type: NotificationRecipientType.STAFF,
            id: employee.userId,
            destination: employee.phone,
          },
          vars: {
            name: slip.personName,
            month: monthLabel,
            net: formatMoney(Number(slip.netPayable)),
          },
        });
        sent += 1;
      } catch (error) {
        this.logger.warn(
          `Payslip notification for ${slip.personName} failed: ${(error as Error).message}`,
        );
      }
    }
    return sent;
  }
}

function numbers(slip: Payslip) {
  return {
    netPayable: Number(slip.netPayable),
    pfEmployee: Number(slip.pfEmployee),
    tax: Number(slip.tax),
    bonus: Number(slip.bonus),
  };
}

function today(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/** Re-exported so the controller can surface a clear 409 on bad config. */
export { ConflictException };
