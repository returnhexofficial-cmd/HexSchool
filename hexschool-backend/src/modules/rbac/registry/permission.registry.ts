/**
 * Permission code registry — the single source of truth for every
 * permission in the system (roadmap M03 §4). Each module appends its
 * codes here; the idempotent seeder (rbac.seeder.ts) syncs this list to
 * the `permissions` table: new codes are inserted, codes removed from
 * this file are flagged `is_orphaned` (never hard-deleted — roles may
 * still reference them) and ignored by the guard.
 *
 * Code format: `<entity>.<action>` (dots may nest, e.g. `exam.mark.entry`).
 */

export interface PermissionDefinition {
  /** Stable code checked by @RequirePermissions / <Can>. */
  code: string;
  /** Roadmap module the permission belongs to (UI groups by this). */
  module: string;
  description: string;
}

const define = (
  module: string,
  entries: ReadonlyArray<readonly [code: string, description: string]>,
): PermissionDefinition[] =>
  entries.map(([code, description]) => ({ code, module, description }));

export const PERMISSION_REGISTRY: ReadonlyArray<PermissionDefinition> = [
  // ── Module 03: Authorization, Roles & Audit Logging ────────────────
  ...define('roles', [
    ['role.view', 'View roles and their permissions'],
    ['role.create', 'Create custom roles'],
    ['role.update', 'Rename/edit roles'],
    ['role.delete', 'Delete custom roles'],
    ['role.permission.assign', 'Change the permissions granted to a role'],
  ]),
  ...define('permissions', [
    ['permission.view', 'Browse the permission catalog'],
  ]),
  ...define('users', [
    ['user.role.view', "View a user's role assignments"],
    ['user.role.assign', 'Assign or remove roles from a user'],
  ]),
  ...define('audit', [['audit.view', 'Read the audit log']]),

  // ── Module 04: School Setup & Settings ──────────────────────────────
  // (GET /school is identity data — auth-only, no code needed.)
  ...define('school', [['school.update', 'Edit the school profile and logo']]),
  ...define('settings', [
    ['settings.view', 'Read system settings (secrets stay masked)'],
    ['settings.update', 'Change system settings'],
    ['settings.test', 'Send test SMS/email with the saved gateway config'],
  ]),
  ...define('grading', [
    ['grading.view', 'View grading systems and grade scales'],
    ['grading.create', 'Create grading systems'],
    ['grading.update', 'Edit grading systems and set the default'],
    ['grading.delete', 'Delete grading systems'],
  ]),
  // ── Module 05: Academic Session & Calendar ──────────────────────────
  ...define('sessions', [
    ['session.view', 'View academic sessions'],
    ['session.create', 'Create academic sessions'],
    ['session.update', 'Edit academic sessions (dates, status)'],
    ['session.delete', 'Delete academic sessions'],
    ['session.activate', 'Switch the current academic session'],
  ]),
  ...define('calendar', [
    ['calendar.view', 'View the academic calendar, holidays, and events'],
    ['holiday.create', 'Add holidays'],
    ['holiday.update', 'Edit holidays'],
    ['holiday.delete', 'Remove holidays'],
    ['holiday.import', 'Bulk-import holidays from CSV'],
    ['event.create', 'Add calendar events'],
    ['event.update', 'Edit calendar events'],
    ['event.delete', 'Remove calendar events'],
  ]),
  // ── Module 06: Academic Structure ───────────────────────────────────
  // One `<entity>.manage` code covers create/update/delete per master —
  // no real-world role splits who may create vs delete a shift.
  ...define('structure', [
    [
      'structure.view',
      'View classes, sections, subjects, departments, shifts, groups',
    ],
    ['department.manage', 'Create/edit/delete departments'],
    ['shift.manage', 'Create/edit/delete shifts'],
    ['class.manage', 'Create/edit/delete classes'],
    ['group.manage', 'Create/edit/delete groups'],
    ['section.manage', 'Create/edit/delete sections'],
    ['subject.manage', 'Create/edit/delete subjects'],
    ['class.subject.assign', "Change a class's subject mapping for a session"],
    ['structure.clone', 'Clone sections + subject mappings to a new session'],
  ]),
  // ── Module 07: Staff & User Management ──────────────────────────────
  ...define('staff', [
    ['staff.view', 'View staff profiles and documents'],
    ['staff.create', 'Register staff (creates their user account)'],
    ['staff.update', 'Edit staff profiles, contacts, and photos'],
    ['staff.delete', 'Delete staff records'],
    ['staff.status', 'Change staff employment status (with reason)'],
    ['staff.document.manage', 'Upload/delete staff documents'],
  ]),
  ...define('users', [
    ['user.view', 'Browse all user accounts'],
    ['user.status', 'Activate/deactivate/suspend user accounts'],
    ['user.password.reset', "Reset a user's password (temp password issued)"],
  ]),

  // ── Module 08: Teacher Management ───────────────────────────────────
  ...define('teachers', [
    [
      'teacher.view',
      'View teachers, qualifications, assignments, leaves, evaluations',
    ],
    ['teacher.create', 'Register teachers (creates their user account)'],
    ['teacher.update', 'Edit teacher profiles, contacts, and photos'],
    ['teacher.delete', 'Delete teacher records'],
    ['teacher.status', 'Change teacher employment status (with reason)'],
    ['teacher.qualification.manage', 'Add/edit/delete qualifications'],
    ['teacher.document.manage', 'Upload/delete teacher documents'],
    ['teacher.subject.assign', "Change a teacher's subject expertise set"],
    ['teacher.assign', 'Assign teachers to section subjects (+ transfers)'],
    [
      'teacher.assign.override',
      'Assign a subject outside the teacher’s expertise set',
    ],
    ['teacher.leave.manage', 'Record/edit/delete leave requests'],
    ['teacher.leave.approve', 'Approve or reject leave requests'],
    ['teacher.evaluation.manage', 'Create/edit/delete evaluations'],
  ]),

  // ── Module 09: Student & Guardian Management ────────────────────────
  ...define('students', [
    ['student.view', 'View students, their guardians, documents, and history'],
    ['student.create', 'Register students (direct registration/migration)'],
    ['student.update', 'Edit student profiles, photos, and QR tokens'],
    ['student.delete', 'Delete student records'],
    ['student.status', 'Change student status (with reason)'],
    [
      'student.medical.view',
      'View student medical information (restricted — roadmap M09 §6)',
    ],
    ['student.medical.update', 'Edit student medical information'],
    ['student.document.manage', 'Upload/delete student documents'],
    ['student.guardian.manage', 'Link/unlink guardians and set the primary'],
    [
      'student.account.create',
      'Provision student/guardian portal accounts (temp password issued)',
    ],
    ['student.idcard.generate', 'Generate student ID card PDFs (single/batch)'],
    ['student.import', 'Bulk-import students from XLSX'],
  ]),
  ...define('guardians', [
    ['guardian.view', 'View guardians and their children'],
    ['guardian.manage', 'Create/edit/delete guardian records'],
  ]),

  // ── Module 10: Admission Management ─────────────────────────────────
  ...define('admission', [
    [
      'admission.view',
      'View admission cycles, applications, merit lists, and reports',
    ],
    ['admission.cycle.manage', 'Create/edit/open/close admission cycles'],
    [
      'admission.application.review',
      'Move applications through the review pipeline (status changes)',
    ],
    ['admission.payment.record', 'Record offline application-fee payments'],
    ['admission.payment.waive', 'Waive or refund application fees'],
    ['admission.test.manage', 'Schedule admission tests and enter test marks'],
    [
      'admission.merit.generate',
      'Generate/regenerate merit and waiting lists (+ promote waitlist)',
    ],
    ['admission.admit', 'Convert selected applications into student records'],
  ]),

  // ── Module 11: Enrollment & Promotion ───────────────────────────────
  ...define('enrollment', [
    ['enrollment.view', 'View enrollments and section rosters'],
    ['enrollment.create', 'Enroll students into a section (single/bulk)'],
    ['enrollment.update', 'Edit an enrollment (roll, optional subject)'],
    ['enrollment.delete', 'Cancel/remove an enrollment'],
    ['enrollment.transfer', 'Transfer a student between sections'],
    [
      'enrollment.capacity.override',
      'Enroll beyond a section’s configured capacity',
    ],
    ['enrollment.roll.assign', 'Batch-assign roll numbers for a section'],
  ]),
  ...define('promotions', [
    ['promotion.view', 'View promotion batches and their decisions'],
    ['promotion.manage', 'Build/edit/delete promotion batches'],
    ['promotion.execute', 'Execute or roll back a promotion batch'],
  ]),

  // ── Module 12: Attendance Management ────────────────────────────────
  ...define('attendance', [
    ['attendance.view', 'View attendance sheets and marked days'],
    ['attendance.mark', 'Mark student attendance for a section and date'],
    ['attendance.edit', 'Re-mark a day that was already marked'],
    [
      'attendance.edit.past',
      'Edit attendance older than the configured edit window',
    ],
    [
      'attendance.holiday.override',
      'Mark attendance on a holiday / convert a marked date to HOLIDAY',
    ],
    ['attendance.qr.checkin', 'Run the QR check-in scanner'],
    ['attendance.staff.view', 'View staff and teacher attendance'],
    ['attendance.staff.mark', 'Mark staff and teacher attendance'],
    ['attendance.report', 'Run and export attendance reports'],
  ]),
  ...define('student-leaves', [
    ['student.leave.view', 'View student leave applications'],
    ['student.leave.manage', 'Create/edit/delete student leave applications'],
    [
      'student.leave.approve',
      'Approve or reject student leave (retro-marks LEAVE days)',
    ],
  ]),

  // ── Module 13: Timetable / Class Routine ────────────────────────────
  ...define('timetable', [
    ['timetable.view', 'View routines, period slots and the master grid'],
    ['period.slot.manage', 'Create/edit/delete the bell schedule of a shift'],
    [
      'timetable.manage',
      'Create a draft routine and edit its cells (copy/clear day)',
    ],
    [
      'timetable.publish',
      'Publish a draft routine (archives the version it replaces)',
    ],
    [
      'timetable.assign.override',
      'Place a teacher who is not assigned to that section-subject',
    ],
    ['timetable.export', 'Download section / teacher routine PDFs'],
  ]),

  // ── Module 14: Examination Management ───────────────────────────────
  ...define('exams', [
    ['exam.view', 'View exams, papers, routines and seat plans'],
    ['exam.type.manage', 'Create/edit/delete exam types'],
    ['exam.manage', 'Create/edit/delete exams and their papers'],
    ['exam.schedule', 'Set exam sitting dates, times and rooms'],
    [
      'exam.schedule.override',
      'Schedule a sitting despite a clash warning (same-day paper, class-time overlap)',
    ],
    ['exam.status', 'Advance an exam through its lifecycle'],
    [
      'exam.publish',
      'Publish exam results (final status transition; gated by Module 15)',
    ],
    ['exam.seat-plan.manage', 'Generate, regenerate and edit seat plans'],
    ['exam.admit-card', 'Generate admit cards for candidates'],
    [
      'exam.admit-card.dues-override',
      'Issue an admit card to a candidate with outstanding dues',
    ],
    ['exam.export', 'Download exam routine / seat plan / admit card PDFs'],
  ]),

  // ── Module 15: Marks & Result Processing ────────────────────────────
  // The four-eyes mark lifecycle is deliberately four codes, not one:
  // the teacher who enters marks is not the person who verifies them,
  // and locking is a third decision again.
  ...define('marks', [
    ['mark.view', 'View mark-entry grids and their status'],
    ['mark.entry', 'Enter and save draft marks for a paper'],
    ['mark.submit', 'Submit a paper’s marks for verification'],
    ['mark.verify', 'Verify a submitted paper (controller/head of exams)'],
    ['mark.lock', 'Lock a verified paper against further entry'],
    [
      'mark.correction',
      'Change a LOCKED mark (needs a reason; logged and re-processed)',
    ],
  ]),
  ...define('results', [
    ['result.view', 'View processed results, tabulation and analytics'],
    ['result.process', 'Run result processing for an exam'],
    [
      'result.process.override',
      'Process results before every paper is locked (produces INCOMPLETE rows)',
    ],
    ['result.publish', 'Publish or unpublish an exam’s results'],
    [
      'result.withhold',
      'Withhold or release an individual candidate’s result',
    ],
    ['result.combine', 'Generate weighted combined/final results'],
    ['result.export', 'Download report cards, tabulation sheets and transcripts'],
  ]),

  // ── Module 16: Fees & Payments ──────────────────────────────────────
  // Setup, billing and collection are separate roles in a real school:
  // the accountant sets structures, the office generates invoices, the
  // desk takes money, and only a senior signs off a waiver or a refund.
  ...define('fees', [
    ['fee.view', 'View fee heads, structures, invoices and payments'],
    ['fee.setup', 'Create/edit fee heads and fee structures'],
    ['fee.override.manage', 'Record discounts, scholarships and waivers'],
    [
      'fee.override.approve',
      'Approve a waiver or a full concession (senior sign-off)',
    ],
    ['fee.invoice.generate', 'Generate monthly and ad-hoc invoices'],
    ['fee.invoice.cancel', 'Cancel an invoice with a reason'],
    ['fee.collect', 'Record an offline payment at the collection desk'],
    ['fee.overpay', 'Accept more money than an invoice asks for'],
    ['fee.refund', 'Refund a payment'],
    ['fee.report', 'View collection, dues and defaulter reports'],
    ['fee.export', 'Download receipts, invoices and fee report files'],
  ]),

  // ── Module 17: Communication & Notifications ────────────────────────
  // Composing/sending, template authoring, notices and credit management
  // are separate roles: the office writes notices, an operator runs bulk
  // sends, and only a senior tops up (spends) the SMS balance.
  ...define('communication', [
    ['notification.view', 'View templates and the delivery log'],
    ['notification.template.manage', 'Create/edit/delete notification templates'],
    ['notification.send', 'Send an ad-hoc message and retry failed ones'],
    ['notification.bulk', 'Run the bulk composer (audience blasts)'],
    [
      'notification.bulk.large',
      'Send a bulk blast above the large-audience threshold',
    ],
    ['notice.view', 'View notices and the notice board feed'],
    ['notice.manage', 'Create/edit/delete notices'],
    ['notice.publish', 'Publish or unpublish a notice'],
    ['sms.credit.view', 'View the SMS-credit balance and ledger'],
    ['sms.credit.manage', 'Record SMS-credit purchases and adjustments'],
  ]),
];

/** Fast membership checks for validators and the seeder. */
export const PERMISSION_CODES: ReadonlySet<string> = new Set(
  PERMISSION_REGISTRY.map((p) => p.code),
);

/** Loose union type — tightens nothing at runtime but documents intent. */
export type PermissionCode = (typeof PERMISSION_REGISTRY)[number]['code'];
