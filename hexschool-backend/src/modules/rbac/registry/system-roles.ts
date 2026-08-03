import { PERMISSION_REGISTRY } from './permission.registry';

/**
 * System role catalog (roadmap M03 §3): seeded per school, non-deletable,
 * non-renamable. `corePermissions` is each role's locked baseline — the
 * seeder grants them and PUT /roles/:id/permissions refuses to remove
 * them (extend-only). Defaults grow as later modules add codes: each
 * module extends these arrays and the idempotent seeder grants the new
 * codes on the next deploy (it never revokes admin-added extras).
 */

export interface SystemRoleDefinition {
  name: string;
  slug: string;
  description: string;
  /** Locked baseline permission codes (must exist in the registry). */
  corePermissions: string[];
}

const ALL_CODES = PERMISSION_REGISTRY.map((p) => p.code);

export const SYSTEM_ROLES: ReadonlyArray<SystemRoleDefinition> = [
  {
    name: 'Super Admin',
    slug: 'super-admin',
    description:
      'Full platform access. Bypasses permission checks entirely (guard-level, by user type and by this role).',
    corePermissions: [...ALL_CODES],
  },
  {
    name: 'Admin',
    slug: 'admin',
    description: 'School administrator — manages the whole school system.',
    corePermissions: [...ALL_CODES],
  },
  {
    name: 'Principal',
    slug: 'principal',
    description: 'Head of institution — oversight across academics and staff.',
    corePermissions: [
      'role.view',
      'permission.view',
      'user.role.view',
      'audit.view',
      'settings.view',
      'grading.view',
      'session.view',
      'session.activate',
      'calendar.view',
      'holiday.create',
      'holiday.update',
      'holiday.delete',
      'holiday.import',
      'event.create',
      'event.update',
      'event.delete',
      'structure.view',
      'department.manage',
      'shift.manage',
      'class.manage',
      'group.manage',
      'section.manage',
      'subject.manage',
      'class.subject.assign',
      'structure.clone',
      'staff.view',
      'staff.create',
      'staff.update',
      'staff.status',
      'staff.document.manage',
      'user.view',
      'teacher.view',
      'teacher.create',
      'teacher.update',
      'teacher.status',
      'teacher.qualification.manage',
      'teacher.document.manage',
      'teacher.subject.assign',
      'teacher.assign',
      'teacher.assign.override',
      'teacher.evaluation.manage',
      'student.view',
      'student.create',
      'student.update',
      'student.status',
      'student.medical.view',
      'student.medical.update',
      'student.document.manage',
      'student.guardian.manage',
      'student.account.create',
      'student.idcard.generate',
      'student.import',
      'guardian.view',
      'guardian.manage',
      'admission.view',
      'admission.cycle.manage',
      'admission.merit.generate',
      'admission.admit',
      'admission.payment.waive',
      'enrollment.view',
      'enrollment.create',
      'enrollment.update',
      'enrollment.delete',
      'enrollment.transfer',
      'enrollment.capacity.override',
      'enrollment.roll.assign',
      'promotion.view',
      'promotion.manage',
      'promotion.execute',
      'attendance.view',
      'attendance.mark',
      'attendance.edit',
      'attendance.edit.past',
      'attendance.holiday.override',
      'attendance.qr.checkin',
      'attendance.staff.view',
      'attendance.staff.mark',
      'attendance.report',
      'student.leave.view',
      'student.leave.manage',
      'student.leave.approve',
      'timetable.view',
      'period.slot.manage',
      'timetable.manage',
      'timetable.publish',
      'timetable.assign.override',
      'timetable.export',
      'exam.view',
      'exam.type.manage',
      'exam.manage',
      'exam.schedule',
      'exam.schedule.override',
      'exam.status',
      'exam.publish',
      'exam.seat-plan.manage',
      'exam.admit-card',
      'exam.admit-card.dues-override',
      'exam.export',
      'mark.view',
      'mark.entry',
      'mark.submit',
      'mark.verify',
      'mark.lock',
      'mark.correction',
      'result.view',
      'result.process',
      'result.process.override',
      'result.publish',
      'result.withhold',
      'result.combine',
      'result.export',
      // M16 — the Principal signs off waivers and refunds.
      'fee.view',
      'fee.setup',
      'fee.override.manage',
      'fee.override.approve',
      'fee.invoice.generate',
      'fee.invoice.cancel',
      'fee.collect',
      'fee.overpay',
      'fee.refund',
      'fee.report',
      'fee.export',
      // M17 — the Principal owns the school's voice: templates, notices,
      // bulk sends (including large blasts) and the SMS balance.
      'notification.view',
      'notification.template.manage',
      'notification.send',
      'notification.bulk',
      'notification.bulk.large',
      'notice.view',
      'notice.manage',
      'notice.publish',
      'sms.credit.view',
      'sms.credit.manage',
      // M18 — the principal's landing dashboard + the reports hub.
      'dashboard.admin',
      'report.view',
      // M19 — the public site is the school's face; the principal owns
      // every part of it, including the careers pipeline and the inbox.
      'website.view',
      'website.page.manage',
      'website.news.manage',
      'website.gallery.manage',
      'website.download.manage',
      'website.career.manage',
      'website.faq.manage',
      'website.committee.manage',
      'website.message.view',
      'website.message.manage',
      // M20 — the head signs the accounts: they may post, cancel and,
      // uniquely, reopen a closed period.
      'accounting.view',
      'account.manage',
      'voucher.create',
      'voucher.post',
      'voucher.cancel',
      'accounting.posting-map.manage',
      'accounting.report',
      'accounting.export',
      'budget.manage',
      'accounting.period.manage',
      'accounting.period.reopen',
      // M21 — the head runs HR: leave policy and approvals, the pay
      // scales, and the two signatures on a payroll run. Generating the
      // month's payslips is the accountant's mechanical step, and the
      // Principal keeps the two that release money: approve and disburse.
      'hr.view',
      'leave.type.manage',
      'leave.apply',
      'leave.approve',
      'leave.approve.override',
      'leave.balance.manage',
      'salary.view',
      'salary.structure.manage',
      'salary.assign',
      'payroll.view',
      'payroll.generate',
      'payroll.generate.force',
      'payroll.approve',
      'payroll.disburse',
      'payroll.payslip.edit',
      'payroll.payslip.hold',
      'bonus.manage',
      'pf.manage',
      'payroll.report',
      'payroll.export',
      // M22 — the head sees every teacher's homework (`assignment.all`)
      // and can unlock a closed one to correct a mark.
      'assignment.view',
      'assignment.manage',
      'assignment.all',
      'assignment.publish',
      'assignment.evaluate',
      'assignment.evaluate.override',
      'assignment.export',
      'material.view',
      'material.manage',
      // M23 — the head is the counterweight to the library desk: they
      // hold the two codes the Librarian deliberately does not, and can
      // read the reports without working the circulation loop.
      'library.view',
      'library.issue.override',
      'library.fine.waive',
      'library.report',
      'library.export',
      // M25 — the head is the one who may seat a 41st child on a 40-seat
      // bus, and reads the fleet reports. The day-to-day fleet paperwork
      // belongs to the office.
      'transport.view',
      'transport.assign',
      'transport.assign.override',
      'transport.report',
      'transport.export',
      // M24 — the head holds the three codes that take school property
      // OFF the books: cancelling a received delivery, correcting a count
      // and writing an asset off. Running the store day to day (buying,
      // receiving, issuing, tagging) is the office's work, and is
      // deliberately not here.
      'inventory.view',
      'inventory.purchase.cancel',
      'inventory.adjust',
      'inventory.asset.dispose',
      'inventory.report',
      'inventory.export',
      // M26 — the head holds the two hostel codes that override a
      // refusal: putting a child in a room that is under repair or whose
      // gender matches neither building, and releasing a bed over unpaid
      // fees. Running the boarding house day to day — the rooms, the
      // beds, the allocations, the kitchen — is the office's work and is
      // deliberately not here, and neither is handing a deposit back.
      'hostel.view',
      'hostel.allocate.override',
      'hostel.vacate.override',
      'hostel.report',
      'hostel.export',
    ],
  },
  {
    name: 'Vice Principal',
    slug: 'vice-principal',
    description: 'Deputy head — academic oversight.',
    corePermissions: [
      'role.view',
      'user.role.view',
      'grading.view',
      'session.view',
      'calendar.view',
      'event.create',
      'event.update',
      'structure.view',
      'section.manage',
      'class.subject.assign',
      'staff.view',
      'user.view',
      'teacher.view',
      'teacher.assign',
      // M21 — the deputy still works the leave inbox, now over the
      // unified HR table (teachers AND staff), but not the payroll.
      'hr.view',
      'leave.apply',
      'leave.approve',
      'student.view',
      'student.status',
      'guardian.view',
      'enrollment.view',
      'enrollment.create',
      'enrollment.transfer',
      'enrollment.roll.assign',
      'promotion.view',
      'promotion.manage',
      'attendance.view',
      'attendance.mark',
      'attendance.edit',
      'attendance.staff.view',
      'attendance.report',
      'student.leave.view',
      'student.leave.approve',
      'timetable.view',
      'timetable.manage',
      'timetable.publish',
      'timetable.export',
      // Runs the exam cycle up to publication — the result announcement
      // itself stays with the Principal.
      'exam.view',
      'exam.manage',
      'exam.schedule',
      'exam.status',
      'exam.seat-plan.manage',
      'exam.admit-card',
      'exam.export',
      // Verifies and locks what the teachers entered, and runs the
      // processor — but publication stays with the Principal, as with
      // the exam status machine's final step.
      'mark.view',
      'mark.entry',
      'mark.submit',
      'mark.verify',
      'mark.lock',
      'result.view',
      'result.process',
      'result.export',
      // M22 — academic oversight: the deputy reads every section's
      // homework and can pull the marks sheet, but does not author or
      // evaluate. Deliberately NOT `assignment.evaluate` — marking a
      // teacher's homework for them is the same category error as the
      // four-eyes mark flow guards against.
      'assignment.view',
      'assignment.all',
      'assignment.export',
      'material.view',
    ],
  },
  {
    name: 'Teacher',
    slug: 'teacher',
    description:
      'Teaching staff — colleague directory, own schedule, class attendance, the exam routine they invigilate, and mark entry for their own papers.',
    corePermissions: [
      'grading.view',
      'session.view',
      'calendar.view',
      'structure.view',
      'teacher.view',
      'student.view',
      'guardian.view',
      'enrollment.view',
      'attendance.view',
      'attendance.mark',
      'attendance.qr.checkin',
      'student.leave.view',
      // Own routine + the section grids they teach (read-only).
      'timetable.view',
      'timetable.export',
      // Read-only exam routine — invigilators need the sitting schedule
      // and seat plans.
      'exam.view',
      'exam.export',
      // Enters and submits marks; verifying and locking are somebody
      // else's job by design, which is the point of a four-eyes flow.
      'mark.view',
      'mark.entry',
      'mark.submit',
      'result.view',
      // M22 — the one module where the teacher is the AUTHOR rather than
      // a reader with a narrow write. They set the work, publish it,
      // mark it and keep the class-notes library; what they deliberately
      // do NOT get is `assignment.all` (another teacher's section is not
      // theirs) or `assignment.evaluate.override` (reopening a closed
      // assignment is a decision above the person who closed it — the
      // M16/M20/M21 separation-of-duties encoding).
      'assignment.view',
      'assignment.manage',
      'assignment.publish',
      'assignment.evaluate',
      'assignment.export',
      'material.view',
      'material.manage',
    ],
  },
  {
    name: 'Accountant',
    slug: 'accountant',
    description:
      'Fees and finance — fee setup, invoicing, the collection desk and the money reports (Module 16), plus the chart of accounts, vouchers and the accounting statements (Module 20).',
    corePermissions: [
      'session.view',
      'structure.view',
      'student.view',
      'guardian.view',
      'enrollment.view',
      'fee.view',
      'fee.setup',
      'fee.override.manage',
      'fee.invoice.generate',
      'fee.invoice.cancel',
      'fee.collect',
      'fee.refund',
      'fee.report',
      'fee.export',
      // M18 — the accountant workspace dashboard + reports hub.
      'dashboard.accountant',
      'report.view',
      // M20 — the accountant keeps the books: the chart of accounts,
      // vouchers, budgets, the posting map and every report.
      'accounting.view',
      'account.manage',
      'voucher.create',
      'voucher.post',
      'accounting.posting-map.manage',
      'accounting.report',
      'accounting.export',
      'budget.manage',
      'accounting.period.manage',
      // M25 — fuel, maintenance and repair receipts are spending, so the
      // person who keeps the books records them. Putting children on
      // buses is the office's job and is deliberately not here.
      'transport.view',
      'transport.expense.manage',
      'transport.report',
      'transport.export',
      // M24 — a received purchase posts to the ledger, so the accountant
      // reads the store's reports to reconcile what was capitalized
      // against what was expensed. They do not run it: buying, receiving
      // and issuing are the office's, and the two write-off codes are the
      // head's.
      'inventory.view',
      'inventory.report',
      'inventory.export',
      // M26 — the security deposit is money the school HOLDS, and handing
      // it back is a payment, so the person who keeps the books records
      // it. Giving a student a bed is the office's job and is
      // deliberately not here — the warden records that a boarder has
      // gone, the accountant records that the deposit went with them.
      'hostel.view',
      'hostel.deposit.refund',
      'hostel.report',
      'hostel.export',
      // Deliberately NOT granted: `fee.override.approve` (a waiver needs
      // a senior's sign-off) and `fee.overpay` — the two places where
      // taking the money and authorising it must be different people.
      // For the same reason, NOT `voucher.cancel` (reversing a posted
      // voucher is the head's call) and NOT `accounting.period.reopen`
      // — the person who closed the books must not be able to quietly
      // reopen them.
      // M21 — the accountant computes the payroll and pays out against an
      // approved run: they may generate it, correct a draft payslip and
      // read every report, and they keep the provident-fund passbook.
      'hr.view',
      'salary.view',
      'payroll.view',
      'payroll.generate',
      'payroll.payslip.edit',
      'payroll.disburse',
      'pf.manage',
      'payroll.report',
      'payroll.export',
      // Deliberately NOT granted: `payroll.approve` — the person who
      // computed a payroll must not be the one who signs it off, which is
      // the same rule as `fee.override.approve` and `voucher.cancel`
      // above. Nor `salary.structure.manage` / `salary.assign`: what a
      // teacher is paid is set by the head, not by whoever pays it.
    ],
  },
  {
    name: 'Admission Officer',
    slug: 'admission-officer',
    description:
      'Admissions desk — student registration and the full application pipeline (Module 10).',
    corePermissions: [
      'structure.view',
      'session.view',
      'student.view',
      'student.create',
      'student.update',
      'student.document.manage',
      'student.guardian.manage',
      'student.idcard.generate',
      'student.import',
      'guardian.view',
      'guardian.manage',
      'admission.view',
      'admission.cycle.manage',
      'admission.application.review',
      'admission.payment.record',
      'admission.test.manage',
      'admission.merit.generate',
      'admission.admit',
      'enrollment.view',
      'enrollment.create',
      'enrollment.roll.assign',
    ],
  },
  {
    name: 'Librarian',
    slug: 'librarian',
    description:
      'Library desk — the catalogue, the copies, the members and the whole circulation loop (Module 23).',
    corePermissions: [
      // The desk needs to see who it is lending to, and to which class.
      'student.view',
      'teacher.view',
      'staff.view',
      'structure.view',
      'session.view',
      // The library itself.
      'library.view',
      'library.catalog.manage',
      'library.copy.manage',
      'library.member.manage',
      'library.issue',
      'library.fine.collect',
      'library.reservation.manage',
      'library.stock.verify',
      'library.report',
      'library.export',
      // Deliberately NOT granted, and each for its own reason:
      //   `library.fine.waive` — the person who takes the money must not
      //     also be the one who decides it is not owed (the M16/M20/M21
      //     separation-of-duties rule; the head or an admin waives).
      //   `library.issue.override` — the limits, the fine block and
      //     another member's hold are the school's policy, not the
      //     desk's; overriding them is a decision with a name on it.
    ],
  },
  {
    name: 'Student',
    slug: 'student',
    description: 'Student portal access (ownership-scoped).',
    corePermissions: [],
  },
  {
    name: 'Parent',
    slug: 'parent',
    description: 'Parent/guardian portal access (children-scoped).',
    corePermissions: [],
  },
  {
    name: 'Office Staff',
    slug: 'office-staff',
    description:
      'General office staff — directory access, the notice board and day-to-day messaging.',
    corePermissions: [
      'staff.view',
      // M17 — the office desk writes notices and runs routine sends.
      'notification.view',
      'notification.send',
      'notification.bulk',
      'notice.view',
      'notice.manage',
      'notice.publish',
      'sms.credit.view',
      // M19 — the office keeps the website's day-to-day content current
      // (news, gallery, downloads, FAQs) and works the contact inbox.
      // Deliberately NOT granted: `website.page.manage` (the institutional
      // pages — about, mission, principal's message — are the head's
      // words) and `website.committee.manage`.
      'website.view',
      'website.news.manage',
      'website.gallery.manage',
      'website.download.manage',
      'website.faq.manage',
      'website.message.view',
      'website.message.manage',
      // M21 — the office files leave applications on behalf of staff who
      // hand in a paper form, and can see the HR workspace. Approving,
      // and everything to do with pay, stays above them.
      'hr.view',
      'leave.apply',
      // M25 — the office runs the buses: the fleet list, the drivers, the
      // routes and who rides them. Deliberately NOT granted:
      // `transport.assign.override` — putting more children on a full bus
      // is the head's decision, not the desk's (the M16/M20/M21/M23
      // separation-of-duties rule) — and `transport.expense.manage`,
      // because the fuel money is the accountant's ledger.
      'transport.view',
      'transport.vehicle.manage',
      'transport.driver.manage',
      'transport.route.manage',
      'transport.assign',
      'transport.report',
      'transport.export',
      // M24 — the office IS the store: the catalogue, the suppliers, the
      // deliveries, the gate passes and the asset tags. Deliberately NOT
      // granted: `inventory.purchase.cancel` (reversing stock a school may
      // already have issued is the head's call — the M20 `voucher.cancel`
      // rule in a second ledger), `inventory.adjust` (the person who
      // counts the shelf must not also be the person who decides the
      // ledger was wrong) and `inventory.asset.dispose` (writing a
      // projector off is a decision with a name on it).
      'inventory.view',
      'inventory.catalog.manage',
      'inventory.purchase.manage',
      'inventory.purchase.receive',
      'inventory.issue',
      'inventory.asset.manage',
      'inventory.report',
      'inventory.export',
      // M26 — the office runs the boarding house: the buildings, the
      // rooms, the beds, who sleeps in them, the kitchen's plans and the
      // meal-off inbox. Deliberately NOT granted: the two overrides
      // (`hostel.allocate.override`, `hostel.vacate.override`), which are
      // the head's, and `hostel.deposit.refund`, which is the
      // accountant's — the office may record that a boarder has left, and
      // may not hand their money back (the M16/M20/M21/M23/M24/M25
      // separation-of-duties rule, continued into the hostel).
      'hostel.view',
      'hostel.manage',
      'hostel.allocate',
      'hostel.vacate',
      'hostel.mess.manage',
      'hostel.mealoff.approve',
      'hostel.report',
      'hostel.export',
    ],
  },
];

export const SYSTEM_ROLE_SLUGS: ReadonlySet<string> = new Set(
  SYSTEM_ROLES.map((r) => r.slug),
);

/** Locked baseline per system-role slug (empty set for unknown slugs). */
export function coreLockedPermissions(slug: string): ReadonlySet<string> {
  const def = SYSTEM_ROLES.find((r) => r.slug === slug);
  return new Set(def?.corePermissions ?? []);
}
