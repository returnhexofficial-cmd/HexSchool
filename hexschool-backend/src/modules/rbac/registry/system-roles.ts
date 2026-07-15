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
    ],
  },
  {
    name: 'Vice Principal',
    slug: 'vice-principal',
    description: 'Deputy head — academic oversight.',
    corePermissions: ['role.view', 'user.role.view'],
  },
  {
    name: 'Teacher',
    slug: 'teacher',
    description: 'Teaching staff. Permissions arrive with Modules 08/12–15.',
    corePermissions: [],
  },
  {
    name: 'Accountant',
    slug: 'accountant',
    description: 'Fees and finance. Permissions arrive with Modules 16/20.',
    corePermissions: [],
  },
  {
    name: 'Admission Officer',
    slug: 'admission-officer',
    description: 'Admissions desk. Permissions arrive with Module 10.',
    corePermissions: [],
  },
  {
    name: 'Librarian',
    slug: 'librarian',
    description: 'Library desk. Permissions arrive with Module 23.',
    corePermissions: [],
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
    description: 'General office staff. Permissions arrive with Module 07.',
    corePermissions: [],
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
