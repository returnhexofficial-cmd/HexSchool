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

  // Modules 09+ append their codes here (student.*, …).
];

/** Fast membership checks for validators and the seeder. */
export const PERMISSION_CODES: ReadonlySet<string> = new Set(
  PERMISSION_REGISTRY.map((p) => p.code),
);

/** Loose union type — tightens nothing at runtime but documents intent. */
export type PermissionCode = (typeof PERMISSION_REGISTRY)[number]['code'];
