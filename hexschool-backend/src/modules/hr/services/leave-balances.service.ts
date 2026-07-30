import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AcademicSession } from '@prisma/client';
import { isoDate } from '../../academic/calendar/date.util';
import { AcademicSessionsRepository } from '../../academic/repositories/academic-sessions.repository';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { allocationFor, carryForwardDays } from '../calc/leave.engine';
import { AdjustBalanceDto, AllocateBalancesDto } from '../dto';
import { EmployeesRepository } from '../repositories/employees.repository';
import {
  LeaveBalancesRepository,
  LeaveTypesRepository,
} from '../repositories/leave.repository';
import { HrSettingsService } from './hr-settings.service';
import { appliesTo } from './leave.service';

export interface AllocationResult {
  sessionId: string;
  employees: number;
  rowsCreated: number;
  rowsUpdated: number;
  carriedForward: number;
}

/**
 * Yearly leave allocation (roadmap M21 §4 "yearly balance allocation
 * job").
 *
 * Two properties make this safe to run more than once, which matters
 * because a school will run it, add three teachers, and run it again:
 *
 *   - it **never lowers** an existing allocation, so a hand-adjusted row
 *     survives a re-run; and
 *   - it writes through the `uq_leave_balances_identity` upsert, so a
 *     second run updates the row it already made rather than doubling
 *     somebody's quota.
 *
 * `used` is deliberately never touched here. It belongs to the approval
 * flow, and an allocation that reset it would hand back days already
 * taken.
 */
@Injectable()
export class LeaveBalancesService {
  private readonly logger = new Logger(LeaveBalancesService.name);

  constructor(
    private readonly balances: LeaveBalancesRepository,
    private readonly types: LeaveTypesRepository,
    private readonly employees: EmployeesRepository,
    private readonly sessions: SessionsService,
    private readonly sessionRows: AcademicSessionsRepository,
    private readonly config: HrSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  async allocate(
    dto: AllocateBalancesDto,
    actor: AccessTokenPayload,
  ): Promise<AllocationResult> {
    const schoolId = actor.schoolId;
    const session = await this.sessions.getById(dto.sessionId, schoolId);
    const config = await this.config.load(schoolId);

    const [types, workforce] = await Promise.all([
      this.types.findAllForSchool(schoolId, { activeOnly: true }),
      this.employees.findMany(schoolId, { personType: dto.personType }),
    ]);

    const carryWanted = (dto.carryForward ?? config.leaveCarryForward) === true;
    const previous = carryWanted
      ? await this.previousSession(schoolId, session)
      : null;
    const previousBalances = previous
      ? await this.balances.findForSession(schoolId, previous.id)
      : [];
    const carryByKey = new Map<string, number>();
    for (const row of previousBalances) {
      carryByKey.set(
        `${row.personType}:${row.personId}:${row.leaveTypeId}`,
        carryForwardDays(
          {
            allocated: Number(row.allocated),
            used: Number(row.used),
            carried: Number(row.carried),
          },
          {
            carryForward: row.leaveType.carryForward,
            maxCarry: Number(row.leaveType.maxCarry),
          },
        ),
      );
    }

    let rowsCreated = 0;
    let rowsUpdated = 0;
    let carriedForward = 0;

    for (const employee of workforce) {
      for (const type of types) {
        if (!appliesTo(type, employee.personType)) continue;

        const allocated = allocationFor({
          annualQuota: Number(type.annualQuota),
          sessionStart: isoDate(session.startDate),
          sessionEnd: isoDate(session.endDate),
          joiningDate: isoDate(employee.joiningDate),
          prorate: dto.prorate ?? true,
        });
        const carried =
          carryByKey.get(
            `${employee.personType}:${employee.personId}:${type.id}`,
          ) ?? 0;
        if (allocated === 0 && carried === 0) continue;

        const key = {
          schoolId,
          sessionId: session.id,
          personType: employee.personType,
          personId: employee.personId,
          leaveTypeId: type.id,
        };
        const existing = await this.balances.findOneFor(
          schoolId,
          session.id,
          employee.personType,
          employee.personId,
          type.id,
        );

        // Never lower what somebody already holds: a re-run after a
        // hand adjustment must not quietly claw days back.
        const nextAllocated = Math.max(
          allocated,
          Number(existing?.allocated ?? 0),
        );
        const nextCarried = Math.max(carried, Number(existing?.carried ?? 0));

        await this.balances.upsertBalance(
          key,
          { allocated: nextAllocated, carried: nextCarried },
          actor.sub,
        );

        if (existing) rowsUpdated += 1;
        else rowsCreated += 1;
        carriedForward += nextCarried;
      }
    }

    this.auditContext.set({
      entityType: 'LeaveBalance',
      entityId: session.id,
      newValues: {
        session: session.name,
        employees: workforce.length,
        rowsCreated,
        rowsUpdated,
        carriedFrom: previous?.name ?? null,
      },
    });

    this.logger.log(
      `Leave allocation for ${session.name}: ${rowsCreated} created, ${rowsUpdated} updated across ${workforce.length} employee(s)`,
    );

    return {
      sessionId: session.id,
      employees: workforce.length,
      rowsCreated,
      rowsUpdated,
      carriedForward,
    };
  }

  /** Hand-adjust one person's entitlement (with an audit trail). */
  async adjust(
    dto: AdjustBalanceDto,
    actor: AccessTokenPayload,
  ): Promise<{ allocated: number; carried: number }> {
    const schoolId = actor.schoolId;
    const session = await this.sessions.getById(dto.sessionId, schoolId);
    const type = await this.types.findById(dto.leaveTypeId, schoolId);
    if (!type) {
      throw new BadRequestException(`Leave type ${dto.leaveTypeId} not found`);
    }
    const employee = await this.employees.findOne(
      schoolId,
      dto.personType,
      dto.personId,
    );
    if (!employee) {
      throw new BadRequestException(
        `No ${dto.personType.toLowerCase()} found for ${dto.personId}`,
      );
    }

    const existing = await this.balances.findOneFor(
      schoolId,
      session.id,
      dto.personType,
      dto.personId,
      dto.leaveTypeId,
    );

    await this.balances.upsertBalance(
      {
        schoolId,
        sessionId: session.id,
        personType: dto.personType,
        personId: dto.personId,
        leaveTypeId: dto.leaveTypeId,
      },
      { allocated: dto.allocated, carried: dto.carried ?? 0 },
      actor.sub,
    );

    this.auditContext.set({
      entityType: 'LeaveBalance',
      entityId: existing?.id ?? `${dto.personId}:${dto.leaveTypeId}`,
      oldValues: existing
        ? {
            allocated: Number(existing.allocated),
            carried: Number(existing.carried),
          }
        : undefined,
      newValues: {
        employee: employee.name,
        leaveType: type.name,
        allocated: dto.allocated,
        carried: dto.carried ?? 0,
      },
    });

    return { allocated: dto.allocated, carried: dto.carried ?? 0 };
  }

  /**
   * The session immediately before this one — where a carry-forward comes
   * from. Chosen by end date rather than by name, because "2026-2027"
   * sorts alphabetically in a way no school intends.
   */
  private async previousSession(
    schoolId: string,
    session: AcademicSession,
  ): Promise<AcademicSession | null> {
    const all = await this.sessionRows.findAll({}, schoolId);
    const earlier = all
      .filter((row) => row.endDate.getTime() < session.startDate.getTime())
      .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
    return earlier[0] ?? null;
  }
}
