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
  // Modules 04+ append their codes here (school.*, session.*, student.*, …).
];

/** Fast membership checks for validators and the seeder. */
export const PERMISSION_CODES: ReadonlySet<string> = new Set(
  PERMISSION_REGISTRY.map((p) => p.code),
);

/** Loose union type — tightens nothing at runtime but documents intent. */
export type PermissionCode = (typeof PERMISSION_REGISTRY)[number]['code'];
