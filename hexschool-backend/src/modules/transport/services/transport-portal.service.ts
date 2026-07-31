import { Injectable } from '@nestjs/common';
import { TransportAssignmentStatus } from '../../../common/constants';
import { timeColumnMinutes } from '../../../common/utils/clock.util';
import { isoDate } from '../../academic/calendar/date.util';
import { formatClock } from '../calc/route-plan.util';
import { TransportAssignmentsRepository } from '../repositories/transport-assignments.repository';
import { TransportSettingsService } from './transport-settings.service';

export interface PortalTransportView {
  /** False when the school does not run transport, or the child does not ride. */
  assigned: boolean;
  reason?: string;
  route?: {
    name: string;
    vehicleRegNo: string | null;
    driverName: string | null;
    driverPhone: string | null;
    substituteDriverName: string | null;
    helperName: string | null;
    helperPhone: string | null;
  };
  stop?: {
    name: string;
    pickupTime: string | null;
    dropTime: string | null;
    monthlyFee: number;
  };
  status?: TransportAssignmentStatus;
  startDate?: string;
  remarks?: string | null;
}

/**
 * Roadmap §5's "parent portal shows child's route/stop/times".
 *
 * **What this deliberately does NOT return** is as considered as what it
 * does: no other rider's name, no capacity figure, and no licence or
 * fitness dates. A parent needs the stop, the two times and a number to
 * ring; the rest is the office's business — the M19 rule that a read's
 * SELECT list *is* the privacy policy.
 *
 * The driver's phone IS included, because a parent standing at a stop
 * with a bus that has not come needs it, and it is already printed on
 * every roster the school hands out.
 *
 * A child who does not ride gets `{ assigned: false, reason }` — the M09
 * / M19 self-describing-stub shape, so the panel can say something true
 * rather than rendering an empty card.
 */
@Injectable()
export class TransportPortalService {
  constructor(
    private readonly assignments: TransportAssignmentsRepository,
    private readonly config: TransportSettingsService,
  ) {}

  async forStudent(
    schoolId: string,
    studentId: string,
    sessionId?: string,
  ): Promise<PortalTransportView> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled) {
      return {
        assigned: false,
        reason: 'This school does not run school transport.',
      };
    }

    const assignment = await this.assignments.findForStudent(
      schoolId,
      studentId,
      sessionId,
    );
    if (!assignment) {
      return {
        assigned: false,
        reason: 'This student is not on a school bus route.',
      };
    }

    return {
      assigned: true,
      route: {
        name: assignment.route.name,
        vehicleRegNo: assignment.route.vehicle?.regNo ?? null,
        driverName: assignment.route.driver?.name ?? null,
        driverPhone: assignment.route.driver?.phone ?? null,
        substituteDriverName: assignment.route.substituteDriver?.name ?? null,
        helperName: assignment.route.helperName,
        helperPhone: assignment.route.helperPhone,
      },
      stop: {
        name: assignment.stop.name,
        pickupTime: clock(assignment.stop.pickupTime),
        dropTime: clock(assignment.stop.dropTime),
        monthlyFee: Number(assignment.stop.monthlyFee),
      },
      status: assignment.status,
      startDate: isoDate(assignment.startDate),
      remarks: assignment.remarks,
    };
  }
}

function clock(value: Date | null): string | null {
  return value === null ? null : formatClock(timeColumnMinutes(value));
}
