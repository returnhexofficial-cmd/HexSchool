import { NotificationChannel } from '../../common/constants';

/**
 * The notification-code catalog (roadmap M17 §3 template codes, §7
 * "template variables validated against per-code allowed set"). The single
 * source of truth for:
 *   - which system events send a message (`NotificationService.send(code)`),
 *   - the variables a template of that code may reference, and
 *   - the default EN body seeded per school so the system talks on day one.
 *
 * Append-only like the permission/settings registries. A module wiring a
 * new event adds its code here; the template seeder is idempotent.
 */

export interface NotificationCodeDefinition {
  code: string;
  /** Roadmap module the event belongs to (UI groups templates by this). */
  module: string;
  description: string;
  /** Channels this event is normally delivered on (drives seeding + UI). */
  channels: NotificationChannel[];
  /** Variables a template body of this code may reference. */
  variables: string[];
  /** Default EN body seeded per school (handlebars vars). */
  defaultBody: string;
  /** Default email subject when EMAIL is a channel. */
  defaultSubject?: string;
}

const C = NotificationChannel;

export const NOTIFICATION_CODES: ReadonlyArray<NotificationCodeDefinition> = [
  // ── Module 02 / 07 / 09 — accounts & security ────────────────────────
  {
    code: 'ACCOUNT_CREATED',
    module: 'Accounts',
    description: 'Welcome message with login credentials',
    channels: [C.SMS, C.EMAIL],
    variables: ['name', 'username', 'temp_password', 'school', 'login_url'],
    defaultBody:
      '{{school}}: your account is ready. Username {{username}}, temporary password {{temp_password}}. Please sign in and change it.',
    defaultSubject: '{{school}} — your account is ready',
  },
  {
    code: 'PASSWORD_RESET',
    module: 'Accounts',
    description: 'Admin-issued temporary password',
    channels: [C.SMS, C.EMAIL],
    variables: ['name', 'temp_password', 'school'],
    defaultBody:
      '{{school}}: your password was reset. Temporary password {{temp_password}}. Please sign in and change it.',
    defaultSubject: '{{school}} — password reset',
  },
  {
    code: 'OTP',
    module: 'Accounts',
    description: 'One-time verification code',
    channels: [C.SMS],
    variables: ['otp', 'purpose', 'minutes'],
    defaultBody:
      'Your verification code is {{otp}}. It expires in {{minutes}} minutes.',
  },
  // ── Module 10 — admission ────────────────────────────────────────────
  {
    code: 'ADMISSION_SELECTED',
    module: 'Admission',
    description: 'Applicant selected in the merit list',
    channels: [C.SMS],
    variables: [
      'applicant_name',
      'application_no',
      'class',
      'deadline',
      'school',
    ],
    defaultBody:
      '{{school}}: congratulations {{applicant_name}}, application {{application_no}} is SELECTED for {{class}}. Confirm admission by {{deadline}}.',
  },
  {
    code: 'ADMISSION_STATUS',
    module: 'Admission',
    description: 'Application status change (waitlisted, rejected, expired)',
    channels: [C.SMS],
    variables: ['applicant_name', 'application_no', 'status', 'school'],
    defaultBody:
      '{{school}}: application {{application_no}} for {{applicant_name}} is now {{status}}.',
  },
  // ── Module 12 — attendance ───────────────────────────────────────────
  {
    code: 'ABSENT_ALERT',
    module: 'Attendance',
    description: 'Guardian alert that a student was absent',
    channels: [C.SMS],
    variables: ['student_name', 'roll', 'date', 'school'],
    defaultBody:
      '{{school}}: your child {{student_name}} (roll {{roll}}) was absent on {{date}}.',
  },
  // ── Module 15 — results ──────────────────────────────────────────────
  {
    code: 'RESULT_PUBLISHED',
    module: 'Results',
    description: 'Result published for a candidate',
    channels: [C.SMS],
    variables: ['student_name', 'exam', 'gpa', 'grade', 'merit', 'school'],
    defaultBody:
      '{{school}}: {{exam}} result published. {{student_name}} — GPA {{gpa}} ({{grade}}), merit {{merit}}.',
  },
  // ── Module 16 — fees ─────────────────────────────────────────────────
  {
    code: 'FEE_RECEIPT',
    module: 'Fees',
    description: 'Payment received against an invoice',
    channels: [C.SMS],
    variables: ['student_name', 'amount', 'invoice', 'balance', 'school'],
    defaultBody:
      '{{school}}: received {{amount}} BDT against {{invoice}} for {{student_name}}. Outstanding {{balance}} BDT.',
  },
  {
    code: 'FEE_DUES',
    module: 'Fees',
    description: 'Outstanding dues reminder',
    channels: [C.SMS],
    variables: ['student_name', 'amount', 'due', 'school'],
    defaultBody:
      '{{school}}: {{student_name}} has {{amount}} BDT outstanding. Please pay by {{due}}.',
  },
  // ── Module 17 — general ──────────────────────────────────────────────
  {
    code: 'BIRTHDAY',
    module: 'Communication',
    description: 'Daily birthday wish',
    channels: [C.SMS],
    variables: ['student_name', 'school'],
    defaultBody: '{{school}} wishes {{student_name}} a very happy birthday! 🎉',
  },
  {
    code: 'NOTICE',
    module: 'Communication',
    description: 'Bulk notice / circular broadcast',
    channels: [C.SMS, C.EMAIL, C.IN_APP],
    variables: ['title', 'body', 'school'],
    defaultBody: '{{school}}: {{title}} — {{body}}',
    defaultSubject: '{{school}}: {{title}}',
  },
  // ── Module 19 — website ──────────────────────────────────────────────
  {
    code: 'CONTACT_MESSAGE',
    module: 'Website',
    description: 'A visitor submitted the public contact form',
    channels: [C.IN_APP, C.EMAIL],
    variables: ['name', 'phone', 'email', 'subject', 'body', 'school'],
    defaultBody:
      'New website message from {{name}} ({{phone}}): {{subject}} — {{body}}',
    defaultSubject: '{{school}} — website contact from {{name}}',
  },
  {
    code: 'CAREER_APPLICATION',
    module: 'Website',
    description: 'A candidate applied to a job opening on the career page',
    channels: [C.IN_APP],
    variables: ['name', 'phone', 'position', 'school'],
    defaultBody:
      'New career application: {{name}} ({{phone}}) applied for {{position}}.',
  },
  // ── Module 21 — HR & payroll ─────────────────────────────────────────
  {
    code: 'PAYSLIP_READY',
    module: 'HR & Payroll',
    description: 'Salary disbursed for the month',
    channels: [C.SMS],
    // Deliberately NOT the full breakdown: an SMS is read on a shared
    // handset and in front of colleagues, so it carries the net figure
    // and points at the portal for the rest.
    variables: ['name', 'month', 'net', 'school'],
    defaultBody:
      '{{school}}: salary for {{month}} has been disbursed. Net {{net}} BDT. Your payslip is available in the portal.',
  },
  {
    code: 'LEAVE_DECISION',
    module: 'HR & Payroll',
    description: 'A leave application was approved or rejected',
    channels: [C.SMS, C.IN_APP],
    variables: ['name', 'leave_type', 'from', 'to', 'status', 'school'],
    defaultBody:
      '{{school}}: your {{leave_type}} from {{from}} to {{to}} is {{status}}.',
  },
  {
    code: 'LOW_SMS_CREDIT',
    module: 'Communication',
    description: 'Admin alert that the SMS balance is low',
    channels: [C.IN_APP],
    variables: ['balance', 'threshold', 'school'],
    defaultBody:
      'SMS credit is low: {{balance}} parts left (threshold {{threshold}}). Top up to keep alerts flowing.',
  },
];

const byCode = new Map(NOTIFICATION_CODES.map((d) => [d.code, d]));

export function notificationCode(
  code: string,
): NotificationCodeDefinition | undefined {
  return byCode.get(code);
}

/** Allowed variables for a code (empty set if the code is unknown). */
export function allowedVariables(code: string): string[] {
  return byCode.get(code)?.variables ?? [];
}

export const NOTIFICATION_CODE_SET: ReadonlySet<string> = new Set(
  NOTIFICATION_CODES.map((d) => d.code),
);
