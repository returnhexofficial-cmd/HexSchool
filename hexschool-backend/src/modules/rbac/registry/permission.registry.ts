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
    // `teacher.leave.manage` / `teacher.leave.approve` were retired in
    // M21: leave is no longer a teacher-only concern, and the codes are
    // now `leave.apply` / `leave.approve` over the unified HR table.
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
    ['result.withhold', 'Withhold or release an individual candidate’s result'],
    ['result.combine', 'Generate weighted combined/final results'],
    [
      'result.export',
      'Download report cards, tabulation sheets and transcripts',
    ],
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
    [
      'notification.template.manage',
      'Create/edit/delete notification templates',
    ],
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

  // ── Module 18: Portals & Dashboards + Reports v1 ────────────────────
  // Portal reads are authorized by OWNERSHIP, not a code — these gate the
  // admin-side aggregates and the reports hub only.
  ...define('dashboards', [
    ['dashboard.admin', 'View the admin/principal dashboard'],
    ['dashboard.accountant', 'View the accountant workspace dashboard'],
    ['report.view', 'Browse the consolidated reports hub'],
  ]),

  // ── Module 19: Website CMS (Public Site) ────────────────────────────
  // The public site is content, not operations: one read code for the CMS
  // workspace, then a manage code per content type because a school hands
  // the notice board, the gallery and the careers page to different people.
  // The contact inbox is split view/manage — reading a parent's message is
  // not the same right as replying to it or deleting it.
  ...define('website', [
    ['website.view', 'Open the Website CMS workspace and preview drafts'],
    ['website.page.manage', 'Create/edit/publish/delete CMS pages'],
    [
      'website.news.manage',
      'Create/edit/publish/delete news, blog and achievement posts',
    ],
    [
      'website.gallery.manage',
      'Create/edit/publish/delete galleries and their items',
    ],
    [
      'website.download.manage',
      'Create/edit/publish/delete downloadable files',
    ],
    [
      'website.career.manage',
      'Manage job openings and read their applications',
    ],
    ['website.faq.manage', 'Create/edit/delete FAQs'],
    ['website.committee.manage', 'Manage managing-committee members'],
    ['website.message.view', 'Read contact-form messages'],
    [
      'website.message.manage',
      'Change a contact message’s status or delete it',
    ],
  ]),

  // ── Module 20: Accounting & Finance ─────────────────────────────────
  // Raising a voucher, approving it and cancelling it are three codes on
  // purpose — the same separation of duties the M16 collection desk uses.
  // A school where one person does all three grants all three; a school
  // with an accountant and a head does not, and the system encodes that
  // rather than assuming it.
  ...define('accounting', [
    ['accounting.view', 'View the chart of accounts, vouchers and reports'],
    ['account.manage', 'Create/edit/delete accounts in the chart of accounts'],
    ['voucher.create', 'Raise and edit draft vouchers'],
    ['voucher.post', 'Post a voucher to the ledger (and record settlements)'],
    [
      'voucher.cancel',
      'Cancel a posted voucher (writes a reversal, never a delete)',
    ],
    [
      'accounting.posting-map.manage',
      'Change the fee-head → income and method → funds account mappings',
    ],
    [
      'accounting.report',
      'Run the cash book, ledgers and the three statements',
    ],
    ['accounting.export', 'Download accounting reports and printable vouchers'],
    ['budget.manage', 'Create/edit/delete budget lines'],
    ['accounting.period.manage', 'Create fiscal periods and close them'],
    [
      'accounting.period.reopen',
      'Reopen a closed accounting period (reason mandatory, audited)',
    ],
  ]),

  // ── Module 21: HR & Payroll ─────────────────────────────────────────
  // Leave and payroll are two different desks. The office runs leave; the
  // accountant generates payroll; a senior approves it; and disbursing —
  // the moment money actually leaves — is a third right again, because
  // that is the M16/M20 separation of duties applied to salaries.
  ...define('hr', [
    ['hr.view', 'Open the HR workspace: employees, leave and payroll reads'],
    ['leave.type.manage', 'Create/edit/delete leave types and their quotas'],
    ['leave.apply', 'File a leave application (own or on someone’s behalf)'],
    ['leave.approve', 'Approve, reject or cancel a leave application'],
    [
      'leave.approve.override',
      'Approve a leave that exceeds the employee’s remaining balance',
    ],
    ['leave.balance.manage', 'Allocate and adjust yearly leave balances'],
  ]),
  ...define('payroll', [
    ['salary.structure.manage', 'Create/edit/delete salary structures'],
    ['salary.assign', 'Assign a salary structure to an employee'],
    ['salary.view', 'View salary structures and employee salary history'],
    ['payroll.view', 'View payroll runs and payslips'],
    ['payroll.generate', 'Create a payroll run and generate its payslips'],
    [
      'payroll.generate.force',
      'Generate payroll for a month whose attendance is not finalized',
    ],
    ['payroll.approve', 'Approve a generated payroll run (freezes payslips)'],
    ['payroll.disburse', 'Mark salaries disbursed (posts the salary voucher)'],
    [
      'payroll.payslip.edit',
      'Override a figure on a draft payslip (with a reason)',
    ],
    ['payroll.payslip.hold', 'Hold or release an individual payslip'],
    ['bonus.manage', 'Create/edit/delete bonus runs (festival, performance)'],
    ['pf.manage', 'Record provident-fund withdrawals and adjustments'],
    ['payroll.report', 'Run the payroll register, PF, tax and YTD reports'],
    [
      'payroll.export',
      'Download payslips, the bank advice and payroll reports',
    ],
  ]),

  // ── Module 22: Assignments & Homework ───────────────────────────────
  // The first module whose primary author is the **Teacher** role rather
  // than the office. `assignment.manage` is therefore scoped to a
  // teacher's own section-subjects by the service; `assignment.all` is
  // the separate code that widens it to the whole school, which is what
  // roadmap §6's "teacher sees only own; head/admin see all" means in
  // permission terms.
  ...define('assignments', [
    ['assignment.view', 'Open the assignments workspace and read submissions'],
    [
      'assignment.manage',
      'Create, edit and delete assignments for your own section-subjects',
    ],
    [
      'assignment.all',
      'See and act on every teacher’s assignments, not only your own',
    ],
    ['assignment.publish', 'Publish, close and reopen an assignment'],
    ['assignment.evaluate', 'Mark submissions, give feedback and return work'],
    [
      'assignment.evaluate.override',
      'Change an evaluation after the assignment has been closed',
    ],
    ['assignment.export', 'Download submissions as a zip and the marks sheet'],
  ]),
  ...define('learning-materials', [
    ['material.view', 'Browse the learning-material library'],
    ['material.manage', 'Upload, edit and delete learning materials'],
  ]),

  // ── Module 23: Library Management ───────────────────────────────────
  // The separation of duties this module encodes is the one every
  // library actually has: the person who **takes** the money at the desk
  // is not the person who may decide it is not owed. `library.issue`
  // covers the whole circulation desk, `library.fine.collect` receipts a
  // payment, and `library.fine.waive` writes one off — the M16
  // `fee.override.approve` / M20 `voucher.cancel` / M21 `payroll.approve`
  // rule, continued into the reading room.
  ...define('library', [
    ['library.view', 'Open the library workspace, catalogue and reports'],
    [
      'library.catalog.manage',
      'Create/edit/delete categories, authors, publishers and books',
    ],
    [
      'library.copy.manage',
      'Add copies, print barcode labels and write a copy off as lost, damaged or withdrawn',
    ],
    ['library.member.manage', 'Enrol, suspend and close library members'],
    ['library.issue', 'Issue, return and renew books at the circulation desk'],
    [
      'library.issue.override',
      'Issue past a borrowing limit, an unpaid fine, a suspended card or another member’s hold',
    ],
    ['library.fine.collect', 'Take payment for a library fine'],
    ['library.fine.waive', 'Write off a library fine (with a reason)'],
    [
      'library.reservation.manage',
      'Place and cancel holds on behalf of a member',
    ],
    ['library.stock.verify', 'Run a physical stock verification'],
    [
      'library.report',
      'Run the overdue, popular-title, stock and member reports',
    ],
    ['library.export', 'Download library reports and barcode label sheets'],
  ]),

  // ── Module 25: Transport Management ─────────────────────────────────
  // The fleet, the routes and the riders are three different desks: the
  // office puts children on buses, the transport clerk keeps the papers
  // and the receipts, and only a senior may overfill a bus. That last
  // one is the separation this module encodes — `transport.assign`
  // covers the everyday work and `transport.assign.override` is what it
  // takes to seat a 41st child on a 40-seat bus, which is a decision
  // with a name on it (the M16/M20/M21/M23 rule).
  ...define('transport', [
    ['transport.view', 'Open the transport workspace, routes and reports'],
    [
      'transport.vehicle.manage',
      'Add and edit vehicles and their fitness, tax and insurance dates',
    ],
    ['transport.driver.manage', 'Add and edit drivers and their licences'],
    [
      'transport.route.manage',
      'Create routes, order their stops and set stop fares',
    ],
    ['transport.assign', 'Put students on a route, move, suspend or end them'],
    [
      'transport.assign.override',
      'Assign past a full bus when the capacity block is on',
    ],
    [
      'transport.expense.manage',
      'Record fuel, maintenance and repair spending',
    ],
    [
      'transport.report',
      'Run the roster, expense, utilization and fee reports',
    ],
    ['transport.export', 'Download transport reports and the driver’s sheet'],
  ]),

  // ── Module 24: Inventory & Assets ───────────────────────────────────
  // Three separations, each with a name behind it. Receiving a delivery
  // is the store keeper's job and **cancelling a received one is not** —
  // a cancellation reverses stock that may already have been handed out,
  // which is the M20 `voucher.cancel` rule in a second ledger. Correcting
  // a count (`inventory.adjust`) and writing an asset off
  // (`inventory.asset.dispose`) are likewise the two places where things
  // leave the books without anybody receiving them, so roadmap §4 and §6
  // ask for a permission on each — the M16/M20/M21/M23/M25 rule,
  // continued into the store room.
  ...define('inventory', [
    ['inventory.view', 'Open the store, the asset register and the reports'],
    [
      'inventory.catalog.manage',
      'Create and edit suppliers, item categories and items',
    ],
    ['inventory.purchase.manage', 'Enter and edit draft purchases'],
    ['inventory.purchase.receive', 'Receive a delivery into stock'],
    [
      'inventory.purchase.cancel',
      'Cancel a received purchase, reversing its stock movements',
    ],
    [
      'inventory.issue',
      'Issue consumables out of the store and take them back',
    ],
    [
      'inventory.adjust',
      'Correct a stock balance after a physical count (reason required)',
    ],
    ['inventory.asset.manage', 'Register, assign, transfer and repair assets'],
    [
      'inventory.asset.dispose',
      'Write an asset off as disposed or lost (reason required)',
    ],
    ['inventory.report', 'Run the stock, ledger, purchase and asset reports'],
    ['inventory.export', 'Download inventory reports and asset label sheets'],
  ]),

  // ── Module 26: Hostel Management ────────────────────────────────────
  // Three separations, each with a name behind it — the M16/M20/M21/M23/
  // M24/M25 rule, continued into the boarding house.
  //
  //   * `hostel.allocate.override` is what it takes to put a child in a
  //     room that is under repair, in a hostel that has been switched
  //     off, or where the gender on the record matches neither building.
  //     None of those is a decision a duty clerk should make alone.
  //   * `hostel.vacate.override` releases a bed over unpaid fees. The
  //     person who runs the hostel must not also be the person who
  //     decides a family's debt no longer matters.
  //   * `hostel.deposit.refund` hands money back, and is deliberately NOT
  //     part of running the hostel: the warden records that a boarder has
  //     gone, the accountant records that the deposit went with them.
  ...define('hostel', [
    ['hostel.view', 'Open the hostel workspace, occupancy and reports'],
    [
      'hostel.manage',
      'Create hostels, rooms and beds, and take a room out of service',
    ],
    [
      'hostel.allocate',
      'Give a student a bed, transfer them, suspend or resume a residency',
    ],
    [
      'hostel.allocate.override',
      'Allocate into a room under maintenance, an inactive hostel, or against an unmatched gender',
    ],
    ['hostel.vacate', 'Release a bed when a boarder leaves'],
    [
      'hostel.vacate.override',
      'Release a bed while fees are still outstanding',
    ],
    [
      'hostel.deposit.refund',
      'Record the return of a security deposit, in whole or in part',
    ],
    ['hostel.mess.manage', 'Create mess plans and put boarders on them'],
    ['hostel.mealoff.approve', 'Approve or refuse a meal-off request'],
    ['hostel.report', 'Run the occupancy, resident, dues and meal-off reports'],
    ['hostel.export', 'Download hostel reports and the resident register'],
  ]),

  // ── Module 27: Document Management & Certificates ───────────────────
  // The separation of duties here follows the M16/M20/M21/M23/M24/M25/M26
  // line, and the split is sharper than usual because a certificate is
  // the only artifact in the system that leaves the building on
  // letterhead:
  //   * the office ISSUES certificates — that is the counter's work,
  //   * `certificate.revoke` disowns a document that is already in
  //     somebody's file, which is the head's call and not the clerk's,
  //   * `certificate.clearance.override` lets a transfer certificate out
  //     over unpaid fees, unreturned books or a bed still held — the last
  //     moment the school has any leverage, so releasing it needs a name,
  //   * `certificate.legacy` writes a certificate number the system did
  //     not generate. Backdating the register is exactly the act that
  //     needs its own code.
  ...define('certificates', [
    ['certificate.view', 'Open the certificate register and read an entry'],
    [
      'certificate.template.manage',
      'Create and edit certificate templates, backgrounds and signatories',
    ],
    [
      'certificate.issue',
      'Issue a certificate, a duplicate or a correction, and print it',
    ],
    [
      'certificate.clearance.override',
      'Issue a certificate over unmet fee, library or hostel clearance',
    ],
    ['certificate.revoke', 'Revoke an issued certificate, with a reason'],
    [
      'certificate.legacy',
      'Enter a pre-system certificate into the register with its own number',
    ],
    ['certificate.export', 'Download the issuance register'],
  ]),
  ...define('archive', [
    ['archive.view', 'Browse the document archive and open a filed document'],
    ['archive.upload', 'File a document into the archive'],
    ['archive.manage', 'Create, rename and move archive folders'],
    ['archive.delete', 'Remove a filed document from the archive'],
  ]),

  // ── Module 28: Complaint, Visitor & Alumni Management ───────────────
  // The separation here is different in kind from every module before it,
  // and `ticket.sensitive.view` is why. Elsewhere the split protects the
  // school's money — who may waive, who may write off, who may hand a
  // deposit back. Here it protects a **person**: roadmap §8 says a
  // complaint about a named teacher must not be readable by general
  // staff, and the code that opens it is deliberately not part of running
  // the inbox. The office clerk triages the broken tap; the allegation
  // about a colleague goes to whoever the school has decided handles
  // those, and to nobody else.
  //
  // The rest follow the established line:
  //   * `ticket.status` is held WITH a relationship — roadmap §6 gives
  //     the move to the assignee or an inbox manager, and the engine
  //     checks which of the two you are (a permission cannot express
  //     "your own ticket").
  //   * `ticket.delete` exists for the one thing the public form
  //     guarantees: spam. It is not how a real complaint goes away.
  ...define('tickets', [
    ['ticket.view', 'Open the complaints inbox and read a ticket'],
    [
      'ticket.sensitive.view',
      'Read complaints marked sensitive — those naming a member of staff',
    ],
    ['ticket.create', 'Raise a ticket on somebody else’s behalf'],
    [
      'ticket.assign',
      'Assign a ticket, set its priority, and manage the inbox',
    ],
    ['ticket.respond', 'Comment on a ticket and move its status'],
    ['ticket.delete', 'Remove a ticket — spam from the public form'],
    ['ticket.report', 'Run the complaint volume, category and SLA reports'],
    ['ticket.export', 'Download the ticket register'],
  ]),
  // The gate desk is a job, not an administrative privilege: checking a
  // visitor in and out is one code, because a receptionist who can sign
  // people in but not out leaves the building's occupancy list wrong all
  // day. Approving an appointment is separate — it commits somebody
  // else's diary.
  ...define('visitors', [
    [
      'visitor.view',
      'Open the visitor desk, the in-building list and the register',
    ],
    ['visitor.manage', 'Check a visitor in and out, and print a gate pass'],
    ['visitor.delete', 'Remove a visitor entry recorded in error'],
    ['appointment.view', 'See requested and scheduled appointments'],
    ['appointment.manage', 'Record and edit appointment requests'],
    ['appointment.decide', 'Approve or refuse an appointment request'],
    ['visitor.report', 'Run the daily visitor register and the summary'],
    ['visitor.export', 'Download the visitor register'],
  ]),
  // `alumni.donation.cancel` is the money code, and it is deliberately
  // NOT part of running the alumni desk — the M16/M20/M21/M23/M24/M25/
  // M26/M27 rule, continued. The person who takes a donation at the
  // reunion desk must not also be the person who can make one disappear.
  ...define('alumni', [
    ['alumni.view', 'Open the alumni directory and the approval queue'],
    ['alumni.manage', 'Add and edit alumni profiles'],
    ['alumni.approve', 'Approve or reject an alumni registration'],
    ['alumni.event.manage', 'Create alumni events and manage registrations'],
    ['alumni.donation.view', 'See the donation register'],
    ['alumni.donation.create', 'Record a donation and issue its receipt'],
    [
      'alumni.donation.cancel',
      'Cancel a donation receipt, with a reason — the receipt stays in the register',
    ],
    ['alumni.report', 'Run the alumni and donation reports'],
    ['alumni.export', 'Download the alumni directory and donation register'],
  ]),

  // ── Module 29: Reports & Analytics v2 ───────────────────────────────
  //
  // These codes govern the **framework**, never the data. A report's own
  // permission is what decides whether it may be run at all
  // (`fee.report`, `payroll.report`, …) and the engine checks it on every
  // path including the scheduled one; `analytics.*` is only the right to
  // open the dashboards and drive the machinery. Without that split,
  // `analytics.view` would silently become a master key to every report
  // in the system.
  //
  // `analytics.finance` is separate from `analytics.view` for the same
  // reason `alumni.donation.cancel` is separate from `alumni.manage`: the
  // money panel names outstanding dues by aging bucket, which is not
  // something everybody who may see enrollment trends should have.
  ...define('analytics', [
    ['analytics.view', 'Open the executive dashboard and its panels'],
    [
      'analytics.finance',
      'See the finance panel — realization, dues aging and the collection trend',
    ],
    ['analytics.website', 'See public-site traffic'],
    [
      'analytics.refresh',
      'Rebuild the materialized views on demand — a real load on the database',
    ],
  ]),
  ...define('reports', [
    [
      'report.schedule.view',
      'See the scheduled reports and when they last ran',
    ],
    [
      'report.schedule.manage',
      'Create, edit, pause and test-run scheduled reports',
    ],
  ]),
];

/** Fast membership checks for validators and the seeder. */
export const PERMISSION_CODES: ReadonlySet<string> = new Set(
  PERMISSION_REGISTRY.map((p) => p.code),
);

/** Loose union type — tightens nothing at runtime but documents intent. */
export type PermissionCode = (typeof PERMISSION_REGISTRY)[number]['code'];
