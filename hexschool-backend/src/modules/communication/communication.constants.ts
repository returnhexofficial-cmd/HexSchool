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
  // ── Module 22 — assignments & homework ───────────────────────────────
  {
    code: 'ASSIGNMENT_NEW',
    module: 'Assignments',
    description: 'An assignment or homework was published to a section',
    // IN_APP first: this is the highest-frequency event in the system (a
    // school sets homework daily, per section, per subject), and putting
    // it on SMS by default would burn a term's credit in a fortnight.
    // `assignment.notification_channel` is how a school opts into SMS.
    channels: [C.IN_APP, C.SMS],
    variables: ['student_name', 'title', 'subject', 'type', 'due', 'school'],
    defaultBody:
      '{{school}}: new {{type}} in {{subject}} — "{{title}}", due {{due}}.',
  },
  {
    code: 'ASSIGNMENT_DUE_SOON',
    module: 'Assignments',
    description: 'Reminder that an assignment falls due shortly',
    channels: [C.IN_APP, C.SMS],
    variables: ['student_name', 'title', 'subject', 'due', 'school'],
    defaultBody:
      '{{school}}: reminder — "{{title}}" ({{subject}}) is due {{due}}. It has not been submitted yet.',
  },
  {
    code: 'ASSIGNMENT_NO_SUBMISSIONS',
    module: 'Assignments',
    description:
      'Nudge to the teacher that an assignment is past due with nothing handed in',
    channels: [C.IN_APP],
    variables: ['title', 'subject', 'section', 'due', 'school'],
    defaultBody:
      '"{{title}}" ({{subject}}, {{section}}) fell due {{due}} and has no submissions. Close it or chase the class.',
  },
  // ── Module 23 — library ──────────────────────────────────────────────
  {
    code: 'LIBRARY_OVERDUE',
    module: 'Library',
    description: 'Weekly chase for a book that is past its due date',
    // IN_APP first for the M22 reason — a library chases the same
    // members week after week, and an SMS default would spend real
    // credit on a message the portal bell carries for free.
    channels: [C.IN_APP, C.SMS],
    variables: ['name', 'title', 'due', 'days', 'fine', 'school'],
    defaultBody:
      '{{school}} library: "{{title}}" was due {{due}} and is {{days}} day(s) overdue. Fine so far {{fine}} BDT.',
  },
  {
    code: 'LIBRARY_RESERVATION_READY',
    module: 'Library',
    description: 'A reserved title is being held at the desk',
    channels: [C.IN_APP, C.SMS],
    variables: ['name', 'title', 'until', 'school'],
    defaultBody:
      '{{school}} library: "{{title}}" is ready for you. It will be held until {{until}}.',
  },
  // ── Module 25 — transport ────────────────────────────────────────────
  {
    code: 'TRANSPORT_DOCUMENT_EXPIRY',
    module: 'Transport',
    description:
      'A vehicle or driver document has lapsed, is about to, or was never recorded',
    // IN_APP only by default: this is an OFFICE problem — a parent
    // cannot renew a tax token — and the people who can act on it are
    // already looking at the bell.
    channels: [C.IN_APP, C.SMS],
    variables: [
      'subject',
      'kind',
      'document',
      'expiry',
      'days',
      'detail',
      'school',
    ],
    defaultBody:
      '{{school}}: {{detail}} Renew it before the vehicle runs again.',
  },
  {
    code: 'TRANSPORT_ASSIGNED',
    module: 'Transport',
    description: 'A student was put on a bus route — the stop and the times',
    channels: [C.IN_APP, C.SMS],
    variables: [
      'student_name',
      'route',
      'stop',
      'pickup',
      'drop',
      'fee',
      'school',
    ],
    defaultBody:
      '{{school}}: {{student_name}} is on route {{route}}, boarding at {{stop}} — pickup {{pickup}}, drop {{drop}}. Monthly fare {{fee}} BDT.',
  },
  // ── Module 24 — inventory ────────────────────────────────────────────
  {
    code: 'INVENTORY_LOW_STOCK',
    module: 'Inventory',
    description:
      'Items at or below their reorder level — the weekly store sweep',
    // IN_APP first for the M22/M23/M25 reason: this is an office problem
    // that the people who can act on it are already looking at, and a
    // store with four hundred items would spend real credit weekly.
    channels: [C.IN_APP, C.SMS],
    variables: ['count', 'items', 'school'],
    defaultBody:
      '{{school}} store: {{count}} item(s) at or below reorder level — {{items}}. Raise a purchase before they run out.',
  },
  {
    code: 'INVENTORY_WARRANTY_EXPIRING',
    module: 'Inventory',
    description:
      'Asset warranties that have lapsed, are about to, or were never recorded',
    channels: [C.IN_APP, C.SMS],
    variables: ['count', 'assets', 'school'],
    defaultBody:
      '{{school}}: {{count}} asset warranty(ies) need attention — {{assets}}. Claim or renew before cover ends.',
  },
  // ── Module 26 — hostel ───────────────────────────────────────────────
  {
    code: 'HOSTEL_ALLOCATED',
    module: 'Hostel',
    description:
      'A student was given a bed — which building, which room, and from when',
    channels: [C.IN_APP, C.SMS],
    variables: [
      'student_name',
      'hostel',
      'room',
      'bed',
      'start_date',
      'warden',
      'school',
    ],
    defaultBody:
      '{{school}}: {{student_name}} has been allocated bed {{bed}}, room {{room}} at {{hostel}} from {{start_date}}. Warden: {{warden}}.',
  },
  {
    code: 'MEAL_OFF_DECISION',
    module: 'Hostel',
    description: 'A meal-off request was approved or refused',
    // IN_APP first for the M22/M23/M24/M25 reason: the boarder and the
    // guardian are already looking at the bell, and a school with two
    // hundred boarders going home for Eid would spend a term's credit in
    // a week.
    channels: [C.IN_APP, C.SMS],
    variables: [
      'student_name',
      'from_date',
      'to_date',
      'days',
      'decision',
      'note',
      'school',
    ],
    defaultBody:
      '{{school}} hostel: the meal-off for {{student_name}} from {{from_date}} to {{to_date}} ({{days}} day(s)) was {{decision}}. {{note}}',
  },
  // ── Module 27 — documents & certificates ─────────────────────────────
  {
    code: 'CERTIFICATE_ISSUED',
    module: 'Certificates',
    description:
      'A certificate was issued — what it is, its number, and how to verify it',
    // SMS carries the verify code deliberately: the guardian is the person
    // who will be asked to prove the document is genuine, and a code they
    // already have on their phone is one they cannot lose with the paper.
    channels: [C.IN_APP, C.SMS],
    variables: [
      'student_name',
      'type',
      'certificate_no',
      'verify_code',
      'verify_url',
      'issue_date',
      'school',
    ],
    defaultBody:
      '{{school}}: a {{type}} certificate ({{certificate_no}}) was issued for {{student_name}} on {{issue_date}}. Verify it with code {{verify_code}} at {{verify_url}}.',
  },
  {
    code: 'CERTIFICATE_REVOKED',
    module: 'Certificates',
    description: 'An issued certificate was revoked, and why',
    channels: [C.IN_APP, C.SMS],
    variables: ['student_name', 'type', 'certificate_no', 'reason', 'school'],
    defaultBody:
      '{{school}}: the {{type}} certificate {{certificate_no}} issued for {{student_name}} has been revoked. Reason: {{reason}}. Please contact the office.',
  },
  // ── Module 28 — complaints, visitors & alumni ────────────────────────
  {
    code: 'TICKET_RAISED',
    module: 'Complaints',
    description: 'A complaint, suggestion or feedback reached the office',
    // IN_APP only. This lands on the desk of people who are already
    // looking at the bell, and a school with an open public form would
    // otherwise spend SMS credit on every piece of feedback it invited.
    channels: [C.IN_APP],
    variables: [
      'ticket_no',
      'type',
      'category',
      'subject',
      'priority',
      'school',
    ],
    defaultBody:
      'New {{type}} {{ticket_no}} ({{category}}, {{priority}}): {{subject}}',
  },
  {
    code: 'TICKET_UPDATE',
    module: 'Complaints',
    description: 'A ticket the requester raised was answered or moved on',
    // **Never sent for an anonymous ticket** — `isNotifiable` in
    // `ticket.engine.ts` is checked before every send, and there is no
    // destination stored on such a row to send to anyway.
    channels: [C.IN_APP, C.SMS],
    variables: ['ticket_no', 'subject', 'status', 'note', 'school'],
    defaultBody:
      '{{school}}: your ticket {{ticket_no}} ("{{subject}}") is now {{status}}. {{note}}',
  },
  {
    code: 'TICKET_ESCALATED',
    module: 'Complaints',
    description:
      'A ticket passed its SLA with nobody resolving it — the hourly sweep',
    channels: [C.IN_APP],
    variables: ['count', 'tickets', 'school'],
    defaultBody:
      '{{count}} ticket(s) are past their response time and still open — {{tickets}}. Assign or resolve them.',
  },
  {
    code: 'APPOINTMENT_DECISION',
    module: 'Visitors',
    description: 'An appointment request was approved or refused',
    // SMS first here, unlike the rest of the module: the recipient is
    // somebody OUTSIDE the school with no portal and no bell, and the
    // whole point is that they know before they travel.
    channels: [C.SMS],
    variables: [
      'visitor_name',
      'host',
      'scheduled_at',
      'status',
      'note',
      'school',
    ],
    defaultBody:
      '{{school}}: your appointment with {{host}} on {{scheduled_at}} is {{status}}. {{note}}',
  },
  {
    code: 'ALUMNI_APPROVED',
    module: 'Alumni',
    description: 'An alumni registration was approved',
    channels: [C.IN_APP, C.SMS],
    variables: ['name', 'batch_year', 'school'],
    defaultBody:
      '{{school}}: welcome back, {{name}} — your alumni profile (batch {{batch_year}}) has been approved.',
  },
  {
    code: 'DONATION_RECEIVED',
    module: 'Alumni',
    description: 'A thank-you for a donation, carrying the receipt number',
    channels: [C.SMS],
    variables: ['donor_name', 'amount', 'receipt_no', 'purpose', 'school'],
    defaultBody:
      '{{school}}: thank you, {{donor_name}}. We have received your donation of {{amount}} BDT. Receipt {{receipt_no}}.',
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
  // ── Module 29 — Reports & Analytics v2 ──────────────────────────────
  {
    code: 'REPORT_READY',
    module: 'Analytics',
    description:
      'A scheduled report has been generated — carries the link or the attachment',
    // EMAIL first, because roadmap §4 asks for "email with attachment /
    // link" and a spreadsheet is not something an SMS can carry. The
    // IN_APP copy is what a recipient who lives in the admin UI sees.
    channels: [C.EMAIL, C.IN_APP],
    variables: [
      'schedule_name',
      'report_name',
      'rows',
      'generated_at',
      'download_url',
      'school',
    ],
    defaultBody:
      '{{school}}: "{{report_name}}" is ready ({{rows}} rows, generated {{generated_at}}). Download: {{download_url}}',
  },
  {
    code: 'REPORT_SCHEDULE_FAILED',
    module: 'Analytics',
    description:
      'A schedule was disabled after repeated failures (roadmap §6) — its owner is told',
    channels: [C.IN_APP, C.EMAIL],
    variables: ['schedule_name', 'report_name', 'reason', 'school'],
    defaultBody:
      '{{school}}: the scheduled report "{{schedule_name}}" has been switched off after repeated failures. Reason: {{reason}}',
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
