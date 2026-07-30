import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendancePersonType,
  PfEntryType,
  PfLedgerEntry,
} from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { money } from '../../fee/calc/money.util';
import { PfEntryDto } from '../dto';
import {
  Employee,
  EmployeesRepository,
} from '../repositories/employees.repository';
import { PfLedgerRepository } from '../repositories/payroll.repository';
import { monthStart } from './payroll.service';

export interface PfStatement {
  employee: Employee;
  entries: PfLedgerEntry[];
  employeeTotal: number;
  employerTotal: number;
  withdrawn: number;
  balance: number;
}

/**
 * The provident-fund passbook (roadmap M21 §3 `pf_ledger` "+ withdrawal
 * records").
 *
 * It is **append-only**, like `sms_credits` (M17) and `audit_logs`
 * (M03): a fund statement is a document an employee keeps, and a
 * correction is another row rather than an edit of the one that was
 * wrong. Contributions arrive from a disbursed payroll run; withdrawals
 * and adjustments are recorded here by hand.
 *
 * Every row carries `balance_after`, so extending the passbook is O(1)
 * and reading a balance never has to re-add a career's worth of months.
 */
@Injectable()
export class PfService {
  constructor(
    private readonly ledger: PfLedgerRepository,
    private readonly employees: EmployeesRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async statement(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
  ): Promise<PfStatement> {
    const employee = await this.employees.findOne(
      schoolId,
      personType,
      personId,
    );
    if (!employee) {
      throw new NotFoundException(
        `No ${personType.toLowerCase()} found for ${personId}`,
      );
    }
    const entries = await this.ledger.findForPerson(
      schoolId,
      personType,
      personId,
    );

    let employeeTotal = 0;
    let employerTotal = 0;
    let withdrawn = 0;
    for (const entry of entries) {
      if (entry.type === PfEntryType.WITHDRAWAL) {
        withdrawn = money(
          withdrawn + Number(entry.employeeAmt) + Number(entry.employerAmt),
        );
        continue;
      }
      employeeTotal = money(employeeTotal + Number(entry.employeeAmt));
      employerTotal = money(employerTotal + Number(entry.employerAmt));
    }

    return {
      employee,
      entries,
      employeeTotal,
      employerTotal,
      withdrawn,
      balance: entries.length
        ? Number(entries[entries.length - 1].balanceAfter)
        : 0,
    };
  }

  /**
   * Record a withdrawal or an adjustment by hand.
   *
   * A withdrawal may not exceed the balance — `chk_pf_ledger_amounts`
   * pins `balance_after >= 0` at the database, and this is the readable
   * refusal in front of it. A fund cannot pay out what it does not hold,
   * and discovering that through a CHECK violation tells an operator
   * nothing about how much they *could* withdraw.
   */
  async record(
    dto: PfEntryDto,
    actor: AccessTokenPayload,
  ): Promise<PfLedgerEntry> {
    const schoolId = actor.schoolId;
    const employee = await this.employees.findOne(
      schoolId,
      dto.personType,
      dto.personId,
    );
    if (!employee) {
      throw new NotFoundException(
        `No ${dto.personType.toLowerCase()} found for ${dto.personId}`,
      );
    }

    const employeeAmt = dto.employeeAmt ?? 0;
    const employerAmt = dto.employerAmt ?? 0;
    const total = money(employeeAmt + employerAmt);
    if (total <= 0) {
      throw new ConflictException(
        'A provident-fund entry has to move some money',
      );
    }
    // A CONTRIBUTION belongs to a payroll run, which writes it with the
    // payslip id that makes it idempotent. Letting one be typed in by
    // hand would create a contribution no run can ever reconcile against.
    if (dto.type === PfEntryType.CONTRIBUTION) {
      throw new ConflictException(
        'Contributions are written by a disbursed payroll run — record a WITHDRAWAL or an ADJUSTMENT here',
      );
    }

    const balance = await this.ledger.currentBalance(
      schoolId,
      dto.personType,
      dto.personId,
    );
    const signed = dto.type === PfEntryType.WITHDRAWAL ? -total : total;
    const balanceAfter = money(balance + signed);
    if (balanceAfter < 0) {
      throw new ConflictException(
        `${employee.name}'s fund holds ${balance.toFixed(2)} — a withdrawal of ${total.toFixed(2)} would overdraw it`,
      );
    }

    const created = await this.ledger.create({
      schoolId,
      personType: dto.personType,
      personId: dto.personId,
      month: monthStart(dto.month),
      type: dto.type,
      employeeAmt,
      employerAmt,
      balanceAfter,
      note: dto.note.trim(),
      createdBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'PfLedgerEntry',
      entityId: created.id,
      newValues: {
        employee: employee.name,
        type: dto.type,
        amount: total,
        balanceAfter,
        note: dto.note,
      },
    });
    return created;
  }
}
