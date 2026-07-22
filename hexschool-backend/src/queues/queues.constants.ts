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

/**
 * Result processing (Module 15). The job carries only the run id — the
 * run's progress, issue list and outcome live in `result_runs`, so the
 * status endpoint keeps answering across a Redis restart and a run that
 * fell out of the queue's retention window still has a record.
 */
export const RESULTS_QUEUE = 'results';

export interface ResultProcessingJob {
  runId: string;
  schoolId: string;
}
