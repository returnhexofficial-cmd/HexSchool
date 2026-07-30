import { StaffStatus } from '../../../common/constants';

/**
 * Teacher domain events (roadmap M08). CREATED/STATUS_CHANGED mirror the
 * staff module.
 *
 * `teacher.leave.approved` was retired in M21 along with the interim
 * `teacher_leaves` table: leave is no longer a teacher-only concern, and
 * `hr.leave.approved` (`modules/hr/events/hr.events.ts`) carries a
 * `personType` so an office assistant's approved leave marks their
 * attendance the same way a teacher's always did.
 */
export const TEACHER_EVENTS = {
  CREATED: 'teacher.created',
  STATUS_CHANGED: 'teacher.status_changed',
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
