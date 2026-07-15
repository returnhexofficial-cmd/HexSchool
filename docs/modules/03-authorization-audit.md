# Module 03 — Authorization, Roles & Audit Logging · Completion Document

| | |
|---|---|
| **Module** | 03 — Authorization, Roles & Audit Logging |
| **Completion date** | 2026-07-16 |
| **Actual effort** | 1 dev-day (est. was 4) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 03 |

## Summary of Implemented Features

**Backend (`hexschool-backend`)**
- **Permission registry as code** (`src/modules/rbac/registry/permission.registry.ts`) — single TS source of truth (9 codes across `roles|permissions|users|audit` modules so far; later modules append). Idempotent seeder syncs registry → `permissions` table: new codes inserted/revived, removed codes flagged `is_orphaned` (never hard-deleted; the guard and `PUT …/permissions` ignore/refuse them).
- **System roles** (`registry/system-roles.ts`): the 11 roadmap roles (Super Admin … Office Staff) seeded per school with `is_system=true` and a **locked core permission set** (extend-only; seeder re-runs grant new core codes but never revoke admin-added extras). Bootstrap Super Admin gets the `super-admin` role (≥1-role invariant holds from day one).
- **`PermissionsGuard`** (global, third in the pinned guard chain throttle → JWT → permissions) + `@RequirePermissions(...codes)` (AND) and `@RequireAnyPermission(...codes)` (OR — both may be combined and both must pass). `userType=SUPER_ADMIN` bypasses. Undecorated routes stay authentication-only.
- **Redis-cached permission resolution** (`PermissionsService` + `PermissionsCacheService`): user → roles → codes cached 5 min (`perm:{userId}`), explicitly invalidated on any role-grant or user-role change; Redis outage degrades to per-request DB lookups (never blocks authorization).
- **Global `AuditInterceptor`** (registered in the global `AuditModule`): every successful mutating request writes one immutable `audit_logs` row. Value precedence: ① service-layer hooks via `AuditContextService` (AsyncLocalStorage; `RolesService` records real old/new permission-set and role diffs, `AuthService` attributes anonymous login/reset), ② route `@Audit({action, entityType})`, ③ inference (method→action, controller→entityType, `:id`/response id, redacted request body). Recursive secret redaction (password/token/otp/secret/authorization families). Writes are fire-and-forget (failure logged, request unaffected). `@SkipAudit()` exempts machine noise (`/auth/refresh`) and anti-enumeration routes (`forgot-password`, `verify-otp`).
- **Role CRUD + assignment APIs** with the roadmap business rules: slug unique per school (kebab-case, DB CHECK + partial unique index), system roles non-deletable/non-renamable with locked cores, delete blocked while assigned, optimistic concurrency via `expectedUpdatedAt` (409 on stale), user keeps ≥1 role, last `super-admin` holder cannot be demoted.
- `/auth/me` now returns real permission codes (Super Admins get the full non-orphaned catalog for UI gating).

**Frontend (`hexschool-frontend`)**
- `usePermissions()` hook (`can`/`canAny`/`isSuperAdmin` over the auth-store codes) + **`<Can permission|anyOf fallback>`** gate component.
- **Admin shell** (`(admin)/layout.tsx`): sidebar driven by `ADMIN_MENU` config where each item declares its required permission (rendered inside `<Can>`), header with `UserMenu`.
- **Roles pages**: `/admin/roles` (DataTable: search/sort/pagination/export, system/custom badges, grant+holder counts, create dialog with RHF+Zod, guarded delete) and `/admin/roles/[id]` (details editor + **permission matrix** grouped by module with check-all-per-module, search, core codes rendered checked+disabled via `lockedCodes`; saves carry `expectedUpdatedAt`).
- **Audit log viewer** `/admin/audit-logs`: filters (action, entity type, date range), paginated table, detail dialog with **JSON diff viewer** (`JsonDiff` — union of keys, changed rows highlighted, old struck-through / new highlighted).

## Database Changes
- Prisma migration `prisma/migrations/20260715184354_authorization_rbac_audit/migration.sql`:
  - Tables `permissions` (uq `code`, `is_orphaned`), `roles` (audit + soft delete + `school_id`), `role_permissions` (composite PK), `user_roles` (composite PK), `audit_logs` (**BIGSERIAL id, no FK to users** — partition-ready for M30; indexes `(school_id, entity_type, entity_id)` and `(user_id, created_at)`).
  - Hand-written: partial unique `uq_roles_slug (school_id, slug) WHERE deleted_at IS NULL`, CHECK `chk_roles_slug_kebab`.
  - `audit_logs.action` is VARCHAR (not a PG enum) so later modules add verbs (EXPORT, APPROVE, …) without enum migrations; canonical list in `src/modules/audit/audit.constants.ts` (mirrored in frontend enums).

## API Endpoints Added
```
GET    /api/v1/roles                    role.view (list + grant/holder counts)
GET    /api/v1/roles/:id                role.view (+ permissionCodes, lockedCodes)
POST   /api/v1/roles                    role.create
PUT    /api/v1/roles/:id                role.update      (expectedUpdatedAt → 409 on stale)
DELETE /api/v1/roles/:id                role.delete      (soft; system/assigned → 400/409)
PUT    /api/v1/roles/:id/permissions    role.permission.assign (full replace; core locked)
GET    /api/v1/permissions              permission.view OR role.view (?includeOrphaned=true)
GET    /api/v1/users/:id/roles          user.role.view
PUT    /api/v1/users/:id/roles          user.role.assign (≥1 role; last super-admin protected)
GET    /api/v1/audit-logs               audit.view (filters: userId, entityType, entityId, action, dateFrom/dateTo)
GET    /api/v1/audit-logs/:id           audit.view
```

## Frontend Pages Created
- `/admin/roles`, `/admin/roles/[id]`, `/admin/audit-logs`; `(admin)` route group now has a shared shell layout (sidebar + header).

## Components Created (new shared/reusable only)
- `<Can>` (permission gate), `usePermissions()`, `JsonDiff` (old/new diff table), `PermissionMatrix` (roles-page-local but reusable pattern), `ADMIN_MENU` config (permission-per-item convention), `rbacApi` client, RBAC Zod schemas.

## Business Rules Implemented
- System roles: non-deletable, non-renamable; core permission sets locked (extend-only), enforced server-side from the code registry.
- A user must retain ≥1 role (DTO-level `ArrayNotEmpty`); the last holder of `super-admin` cannot lose it.
- Role deletion blocked while any user holds it (409 with count).
- Role/grant changes invalidate affected users' permission caches immediately; 5-min TTL is the safety net.
- Two admins editing one role: last-write-wins guarded by `expectedUpdatedAt` optimistic check (409 on stale).
- Audit logs are immutable — read-only API surface, no update/delete anywhere.
- Orphaned (registry-removed) permission codes: excluded from effective permissions (guard denies gracefully), rejected on assignment, flagged by the seeder.

## Known Limitations
- **User role assignment UI** ships with the user detail page in Module 07 (the API is live now); role assignment currently happens via API/Swagger.
- Audit fallback `newValues` is the redacted request body, not the entity state — services should set precise old/new diffs via `AuditContextService` (RolesService/AuthService already do; the convention for later modules).
- Audit writes are fire-and-forget: a failed write is logged, not retried/queued.
- `audit_logs` monthly partitioning + retention deferred to Module 30 (schema is partition-ready: BIGSERIAL, no FKs).
- Super Admin bypass keys off `user_type`; the seeded `super-admin` *role* is catalog/UI convenience.
- Most system roles (Teacher, Accountant, …) have empty core sets until their modules add codes.

## Future Improvements
- Batch/queue audit writes if mutation volume grows; add `EXPORT` auditing to DataTable exports (M18 report engine).
- Role-change domain events (`role.permissions_changed`) once anything needs to react beyond cache invalidation.
- Permission descriptions i18n (Bangla) alongside the M04+ dual-field convention.

## Breaking Changes
- **Global guard registration moved**: `JwtAuthGuard` is no longer an `APP_GUARD` provider in `AuthModule` — the full chain (Throttler → JwtAuthGuard → PermissionsGuard) is pinned in `AppModule` providers, because global-guard execution follows provider registration order and root providers register before imported modules'. Behavior for existing routes is unchanged.
- **Every mutating route is now audited** unless explicitly `@SkipAudit()` — future modules get the trail for free but must use `AuditContextService` for meaningful diffs.
- `GET /auth/me` `permissions` is now populated (was `[]`) — no client change needed (M02 shaped for this).

## Migration Steps
1. `cd hexschool-backend && npx prisma migrate deploy` (or `migrate dev` locally).
2. `npm run seed` — syncs the permission registry, seeds the 11 system roles + core grants, attaches `super-admin` to the bootstrap Super Admin. Safe to re-run.
3. Frontend: no new env/deps; `npm run build` as usual.

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| `REDIS_URL` | Reused | Permission-set cache (5 min TTL) via a dedicated lazy ioredis connection |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Backend lint / typecheck / unit tests | ✅ | 64 tests (32 M01–02 + 32 new: guard AND/OR/bypass, cache hit/miss/invalidation, role rules incl. last-super-admin + optimistic 409, redaction, registry integrity) |
| Backend e2e vs live DB+Redis | ✅ | 27 tests (16 new): 403→grant→200→revoke→403 with the SAME access token (live cache invalidation), role CRUD + 409s, system-role locks, audit rows for CREATE/LOGIN with redacted password, audit API guarded, ≥1-role rule |
| Migration on dev DB (Neon) | ✅ | `prisma migrate dev` applied incl. hand-written partial index/CHECK |
| Seed idempotency | ✅ | Second run: 9 codes re-synced, 0 orphaned, roles/grants unchanged |
| Frontend lint / typecheck / tests / build | ✅ | 38 tests (25 M02 + 13 new: `<Can>` AND/OR/bypass/fallback, role schema, JsonDiff); 15 routes + proxy compiled |

## Remaining TODOs
- [ ] Push both repos to GitHub and confirm CI green (M01/M02 carry-over).
- [ ] In-browser click-through of `/admin/roles` matrix + audit viewer against the dev server (API + component layers verified individually; e2e covers the HTTP flows).

## Links to Related Modules
- Depends on: Module 02 (JwtAuthGuard pipeline, `/auth/me` shape, UsersRepository).
- Unlocks / hooks completed for: **every later module** (`@RequirePermissions` + audit trail are global conventions now), Module 04 (first consumer of the guard on school/settings APIs), Module 07 (user role assignment UI slot + `GET/PUT /users/:id/roles` live), Module 30 (audit partitioning/retention).
- `PROJECT_CONTEXT.md` sections updated: §5, §10, §13, §16, §18.
