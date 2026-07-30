import { AttendancePersonType } from '../../../common/constants';

/**
 * HR domain events.
 *
 * This file is deliberately a bare constants + interface module with no
 * Nest decorators and no service imports: a consumer (M12's
 * `AttendanceListener`) imports the SHAPE without importing HrModule, so
 * the integration stays a one-way event edge and the module graph stays
 * acyclic — the M08 `teacher.leave.approved` → M12 pattern, and the same
 * reason M20 listens to `payment.success` without FeeModule ever learning
 * the ledger exists.
 *
 * `hr.leave.approved` REPLACES `teacher.leave.approved` (M08). The event
 * now carries a `personType`, so approving a *staff* member's leave marks
 * their attendance too — which the teacher-only event could not express.
 */
export const HR_EVENTS = {
  LEAVE_APPROVED: 'hr.leave.approved',
  PAYROLL_DISBURSED: 'hr.payroll.disbursed',
} as const;

export interface LeaveApprovedEvent {
  leaveId: string;
  schoolId: string;
  personType: AttendancePersonType;
  personId: string;
  /** YYYY-MM-DD. */
  fromDate: string;
  toDate: string;
  leaveTypeName: string;
  isPaid: boolean;
}

export interface PayrollDisbursedEvent {
  runId: string;
  schoolId: string;
  /** YYYY-MM-DD, the first of the payroll month. */
  month: string;
  payslipCount: number;
  netTotal: number;
}
