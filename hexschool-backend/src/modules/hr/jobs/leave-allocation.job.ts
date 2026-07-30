import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SessionsService } from '../../academic/services/sessions.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { HrSettingsService } from '../services/hr-settings.service';
import { LeaveBalancesService } from '../services/leave-balances.service';

/**
 * The yearly leave-balance allocation (roadmap M21 §4).
 *
 * It runs nightly rather than once a year on a date somebody has to
 * remember, because the thing it reacts to is the CURRENT session
 * changing — and a school activates its next session whenever it is
 * ready, not on 1 January. Since the allocation is idempotent and never
 * lowers an existing entitlement (`LeaveBalancesService.allocate`), a
 * nightly run is a no-op on all but the first night of a new session and
 * on the nights after somebody new is hired.
 *
 * That is the same reasoning as M12's auto-absent job: a cheap idempotent
 * sweep beats a calendar event nobody owns.
 */
@Injectable()
export class LeaveAllocationJob {
  private readonly logger = new Logger(LeaveAllocationJob.name);

  constructor(
    private readonly balances: LeaveBalancesService,
    private readonly sessions: SessionsService,
    private readonly schools: SchoolsRepository,
    private readonly config: HrSettingsService,
  ) {}

  @Cron('25 1 * * *')
  async run(): Promise<number> {
    const schools = await this.schools.findAll();
    let total = 0;
    for (const school of schools) {
      total += await this.runForSchool(school.id);
    }
    return total;
  }

  /** Exposed for tests and for the manual "allocate now" button. */
  async runForSchool(schoolId: string): Promise<number> {
    const config = await this.config.load(schoolId);
    if (!config.enabled) return 0;

    const session = await this.sessions.getCurrent(schoolId);
    if (!session) return 0;

    try {
      const result = await this.balances.allocate(
        {
          sessionId: session.id,
          prorate: true,
          carryForward: config.leaveCarryForward,
        },
        systemActor(schoolId),
      );
      if (result.rowsCreated > 0) {
        this.logger.log(
          `Allocated leave for ${session.name}: ${result.rowsCreated} new balance row(s) across ${result.employees} employee(s)`,
        );
      }
      return result.rowsCreated;
    } catch (error) {
      // A missing session, a school mid-setup — logged, never fatal: a
      // background sweep must not take the process down (the M12 rule).
      this.logger.error(
        `Leave allocation failed for school ${schoolId}: ${(error as Error).message}`,
      );
      return 0;
    }
  }
}

/**
 * The job has no logged-in user, but `allocate` writes `created_by` and
 * an audit context. A NULL-subject system actor keeps those rows honest —
 * they were written by the scheduler, not by a person.
 */
function systemActor(schoolId: string): AccessTokenPayload {
  return {
    // `created_by` is a nullable UUID column; an empty string would not
    // be one. NULL is the honest value — nobody clicked anything.
    sub: null as unknown as string,
    schoolId,
    userType: UserType.SUPER_ADMIN,
  };
}
