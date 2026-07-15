export const SYSTEM_QUEUE = 'system';

/**
 * SMS/email dispatch queue (introduced by Module 02 for OTP + security
 * alerts). Module 17 replaces the processor internals with the real
 * NotificationService + BD SMS gateway; the job contract stays.
 */
export const NOTIFICATIONS_QUEUE = 'notifications';

export type NotificationJob =
  | { type: 'email'; to: string; subject: string; text: string }
  | { type: 'sms'; to: string; text: string };
