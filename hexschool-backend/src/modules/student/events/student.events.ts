import { StudentStatus } from '../../../common/constants';

/**
 * Student domain events (roadmap M09). Portal accounts are provisioned
 * LAZILY, so credentials go out on ACCOUNT_CREATED (not registration).
 * STATUS_CHANGED drives the portal-deactivation cascade (M09 §6).
 */
export const STUDENT_EVENTS = {
  CREATED: 'student.created',
  STATUS_CHANGED: 'student.status_changed',
  ACCOUNT_CREATED: 'student.account_created',
  GUARDIAN_ACCOUNT_CREATED: 'guardian.account_created',
} as const;

export interface StudentCreatedEvent {
  studentId: string;
  schoolId: string;
  studentUid: string;
  name: string;
}

export interface StudentStatusChangedEvent {
  studentId: string;
  /** NULL until a portal account exists. */
  userId: string | null;
  schoolId: string;
  from: StudentStatus;
  to: StudentStatus;
  reason: string;
}

/** Fired for both student and guardian provisioning — the listener sends
 *  the temp credentials over SMS/email (fire-and-forget, M07 rule). */
export interface PortalAccountCreatedEvent {
  userId: string;
  schoolId: string;
  /** 'student' | 'guardian' — wording of the welcome message. */
  holder: 'student' | 'guardian';
  name: string;
  /** Login identifier the message points at. */
  phone?: string | null;
  email?: string | null;
  tempPassword: string;
}
