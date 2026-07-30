import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollRunStatus } from '@prisma/client';
import { isoDate } from '../../academic/calendar/date.util';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PortalLeaveDto } from '../dto';
import {
  Employee,
  EmployeesRepository,
} from '../../hr/repositories/employees.repository';
import { HrSettingsService } from '../../hr/services/hr-settings.service';
import { LeaveService } from '../../hr/services/leave.service';
import { PayrollExportService } from '../../hr/services/payroll-export.service';
import { PayrollService } from '../../hr/services/payroll.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';

/**
 * Employee self-service (roadmap M21 §5: "my-leave (portal) apply form
 * with balance display" and "employee self-service payslip history in
 * portal").
 *
 * Authorized by **ownership**, like every other portal surface (M18):
 * the employee is resolved from the logged-in user's `user_id`, never
 * from a request parameter, so there is no id to tamper with and no
 * permission code to grant. That matters more here than anywhere else in
 * the portal — a payslip is the most sensitive per-person document the
 * system holds, and `assertOwns` below is the single chokepoint that
 * keeps one employee out of another's.
 *
 * It serves teachers and non-teaching staff alike, which the M18 teacher
 * portal could not: `EmployeesRepository.findByUserId` resolves either.
 */
@Injectable()
export class EmployeePortalService {
  constructor(
    private readonly employees: EmployeesRepository,
    private readonly leaves: LeaveService,
    private readonly payroll: PayrollService,
    private readonly exports: PayrollExportService,
    private readonly schools: SchoolsRepository,
    private readonly config: HrSettingsService,
  ) {}

  async me(user: AccessTokenPayload): Promise<Employee> {
    return this.requireEmployee(user);
  }

  async myBalances(user: AccessTokenPayload) {
    const employee = await this.requireEmployee(user);
    return this.leaves.balancesFor(
      user.schoolId,
      employee.personType,
      employee.personId,
    );
  }

  async myLeaves(user: AccessTokenPayload) {
    const employee = await this.requireEmployee(user);
    const { rows } = await this.leaves.list(
      {
        personType: employee.personType,
        personId: employee.personId,
        page: 1,
        limit: 50,
      },
      user.schoolId,
    );
    return rows.map((row) => row.application);
  }

  /**
   * File leave for oneself. `personType`/`personId` come from the
   * resolved employee and are never read off the body — the DTO
   * deliberately has no such fields.
   */
  async applyForLeave(dto: PortalLeaveDto, user: AccessTokenPayload) {
    const employee = await this.requireEmployee(user);
    return this.leaves.create(
      {
        ...dto,
        personType: employee.personType,
        personId: employee.personId,
      },
      user,
    );
  }

  /**
   * Payslip history — **disbursed runs only**.
   *
   * A draft or merely approved payslip is a proposal the office is still
   * working on; showing it would have employees querying figures that are
   * about to change, and would leak a hold decision before it is
   * communicated.
   */
  async myPayslips(user: AccessTokenPayload) {
    const employee = await this.requireEmployee(user);
    const rows = await this.payroll.payslipsForPerson(
      user.schoolId,
      employee.personType,
      employee.personId,
    );
    return rows
      .filter((row) => row.payrollRun.status === PayrollRunStatus.DISBURSED)
      .map((row) => ({
        id: row.id,
        month: isoDate(row.payrollRun.month).slice(0, 7),
        gross: Number(row.gross),
        totalDeductions: Number(row.totalDeductions),
        netPayable: Number(row.netPayable),
        status: row.status,
        paidAt: row.paidAt,
      }));
  }

  async myPayslipPdf(payslipId: string, user: AccessTokenPayload) {
    const employee = await this.requireEmployee(user);
    const payslip = await this.payroll.getPayslip(payslipId, user.schoolId);
    this.assertOwns(payslip, employee);

    const run = await this.payroll.getDetail(
      payslip.payrollRunId,
      user.schoolId,
    );
    if (run.status !== PayrollRunStatus.DISBURSED) {
      // Same reasoning as the list: an undisbursed payslip is not yet a
      // document, and a 404 does not confirm that a draft figure exists.
      throw new NotFoundException('No payslip is available for that month');
    }

    const [school, config] = await Promise.all([
      this.schools.findByIdOrFail(user.schoolId),
      this.config.load(user.schoolId),
    ]);
    return this.exports.payslipPdf(payslip, {
      schoolName: school.name,
      schoolAddress: school.address ?? null,
      month: isoDate(run.month).slice(0, 7),
      footer: config.reportFooter,
    });
  }

  // ── the chokepoint ──────────────────────────────────────────────────

  private async requireEmployee(user: AccessTokenPayload): Promise<Employee> {
    const employee = await this.employees.findByUserId(user.schoolId, user.sub);
    if (!employee) {
      throw new NotFoundException('No employee profile for this account');
    }
    return employee;
  }

  private assertOwns(
    payslip: { personType: string; personId: string },
    employee: Employee,
  ): void {
    if (
      payslip.personType !== employee.personType ||
      payslip.personId !== employee.personId
    ) {
      throw new ForbiddenException('That payslip is not yours');
    }
  }
}
