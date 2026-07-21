import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AttendancePersonType } from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { TEACHER_EVENTS } from '../../teacher/events/teacher.events';
import type { TeacherLeaveApprovedEvent } from '../../teacher/events/teacher.events';
import { StaffAttendanceService } from '../services/staff-attendance.service';

/**
 * Closes the M08 hook: an approved teacher leave marks those days LEAVE
 * in `staff_attendances` so the monthly register and (later) payroll see
 * them without anyone re-entering the range. Holidays inside the range
 * are skipped. Failures are logged, never rethrown — the leave approval
 * itself has already committed.
 */
@Injectable()
export class AttendanceListener {
  private readonly logger = new Logger(AttendanceListener.name);

  constructor(private readonly staffAttendance: StaffAttendanceService) {}

  @OnEvent(TEACHER_EVENTS.LEAVE_APPROVED)
  async handleTeacherLeaveApproved(
    event: TeacherLeaveApprovedEvent,
  ): Promise<void> {
    try {
      const marked = await this.staffAttendance.markLeaveRange(
        event.schoolId,
        AttendancePersonType.TEACHER,
        event.teacherId,
        parseDate(event.fromDate),
        parseDate(event.toDate),
        `Approved ${event.type} leave`,
      );
      this.logger.log(
        `Teacher leave ${event.leaveId}: ${marked} day(s) marked LEAVE`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to mark leave days for teacher ${event.teacherId}: ${(err as Error).message}`,
      );
    }
  }
}
