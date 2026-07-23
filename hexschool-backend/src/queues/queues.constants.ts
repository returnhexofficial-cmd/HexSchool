export const SYSTEM_QUEUE = 'system';

/**
 * SMS/email dispatch queue (introduced by Module 02 for OTP + security
 * alerts). Module 17's worker (in CommunicationModule) processes it for
 * real: a `notification` job carries a `notifications` row id the
 * dispatcher renders, sends and records; the legacy raw `sms`/`email`
 * jobs (OTP, welcome/reset credentials) still work — the worker sends them
 * through the same gateway and logs a RAW delivery row.
 */
export const NOTIFICATIONS_QUEUE = 'notifications';

export type NotificationJob =
  | { type: 'email'; to: string; subject: string; text: string }
  | { type: 'sms'; to: string; text: string }
  | { type: 'notification'; notificationId: string; schoolId: string };

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
