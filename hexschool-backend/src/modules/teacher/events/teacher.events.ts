import { LeaveType, StaffStatus } from '../../../common/constants';

/**
 * Teacher domain events (roadmap M08). CREATED/STATUS_CHANGED mirror the
 * staff module; LEAVE_APPROVED is the hook Attendance (M12) consumes to
 * mark Leave days.
 */
export const TEACHER_EVENTS = {
  CREATED: 'teacher.created',
  STATUS_CHANGED: 'teacher.status_changed',
  LEAVE_APPROVED: 'teacher.leave.approved',
} as const;

export interface TeacherCreatedEvent {
  teacherId: string;
  userId: string;
  schoolId: string;
  employeeId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Plain temp password, delivered once via SMS/email and never stored. */
  tempPassword: string;
}

export interface TeacherStatusChangedEvent {
  teacherId: string;
  userId: string;
  schoolId: string;
  from: StaffStatus;
  to: StaffStatus;
  reason: string;
}

export interface TeacherLeaveApprovedEvent {
  leaveId: string;
  teacherId: string;
  schoolId: string;
  fromDate: string;
  toDate: string;
  type: LeaveType;
}
