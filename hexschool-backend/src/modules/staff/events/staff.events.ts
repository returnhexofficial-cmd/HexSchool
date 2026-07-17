import { StaffStatus } from '../../../common/constants';

/**
 * Staff domain events (roadmap M07). Emitted by StaffService; the
 * listener sends the welcome message and cascades RESIGNED/TERMINATED
 * into user deactivation.
 */
export const STAFF_EVENTS = {
  CREATED: 'staff.created',
  STATUS_CHANGED: 'staff.status_changed',
} as const;

export interface StaffCreatedEvent {
  staffId: string;
  userId: string;
  schoolId: string;
  employeeId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Plain temp password, delivered once via SMS/email and never stored. */
  tempPassword: string;
}

export interface StaffStatusChangedEvent {
  staffId: string;
  userId: string;
  schoolId: string;
  from: StaffStatus;
  to: StaffStatus;
  reason: string;
}
