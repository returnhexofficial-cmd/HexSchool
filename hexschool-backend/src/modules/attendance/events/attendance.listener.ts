import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { parseDate } from '../../academic/calendar/date.util';
import { HR_EVENTS } from '../../hr/events/hr.events';
import type { LeaveApprovedEvent } from '../../hr/events/hr.events';
import { StaffAttendanceService } from '../services/staff-attendance.service';

/**
 * An approved leave marks those days LEAVE in `staff_attendances`, so the
 * monthly register and payroll see them without anyone re-entering the
 * range. Holidays inside the range are skipped. Failures are logged,
 * never rethrown — the leave approval itself has already committed.
 *
 * This was the M08 hook (`teacher.leave.approved`); **M21 widened it**.
 * The event now carries a `personType`, so an office assistant's leave is
 * marked the same way a teacher's is — which the teacher-only event could
 * not express, and which is why staff leave used to leave the register
 * showing them absent.
 *
 * The import is of a bare constants file, not of HrModule: that one-way
 * event edge is what keeps the module graph acyclic while HrModule
 * imports AttendanceModule for the register payroll reads.
 */
@Injectable()
export class AttendanceListener {
  private readonly logger = new Logger(AttendanceListener.name);

  constructor(private readonly staffAttendance: StaffAttendanceService) {}

  @OnEvent(HR_EVENTS.LEAVE_APPROVED)
  async handleLeaveApproved(event: LeaveApprovedEvent): Promise<void> {
    try {
      const marked = await this.staffAttendance.markLeaveRange(
        event.schoolId,
        event.personType,
        event.personId,
        parseDate(event.fromDate),
        parseDate(event.toDate),
        `Approved ${event.leaveTypeName}`,
      );
      this.logger.log(
        `Leave ${event.leaveId}: ${marked} day(s) marked LEAVE for ${event.personType} ${event.personId}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to mark leave days for ${event.personType} ${event.personId}: ${(err as Error).message}`,
      );
    }
  }
}
