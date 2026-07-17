# Module 07 — Staff & User Management · Completion Document

| | |
|---|---|
| **Module** | 07 — Staff & User Management |
| **Completion date** | 2026-07-17 |
| **Actual effort** | 1 dev-day (est. was 4) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 07 |

## Summary of Implemented Features

- **Staff registry**: full CRUD for non-teaching staff (`staff_profiles`), 1:1 with a user account. Creation is **transactional**: gap-free employee ID + user (temp password, `must_change_password=true`) + default system role + profile are one transaction — any failure rolls everything back including the claimed sequence number.
- **Shared Sequence/ID generator** (`SequenceModule` → `SequenceService`): per-school, per-prefix counters in `document_sequences`, claimed with an atomic upsert (row-lock serialized) *inside the caller's transaction* — gap-free by construction. Token-pattern renderer (`{SCHOOL_CODE} {YYYY} {YY} {MM} {SEQ<n>}`); employee IDs use the new `general.employee_id_pattern` setting (default `{SCHOOL_CODE}-S-{YY}{SEQ4}`) with a per-joining-year counter (`staff:{YY}`). M09/M10/M16/M20 reuse this service.
- **Designation → default role**: PRINCIPAL/VICE_PRINCIPAL/ACCOUNTANT/ADMISSION_OFFICER/LIBRARIAN map to their system roles; everything else gets `office-staff` — so the ≥1-role invariant holds from birth.
- **Welcome credentials**: `staff.created` event → `StaffListener` enqueues SMS (phone first, email fallback) with employee ID + one-time temp password (never stored in plaintext).
- **Status lifecycle**: `PUT /staff/:id/status` with mandatory reason (audited, feeds HR M21). `RESIGNED`/`TERMINATED` cascade via event listener: **sessions revoked first, then user set INACTIVE**; back-to-`ACTIVE` reactivates the account.
- **Photo upload**: ≤2 MB JPEG/PNG/WebP → `sharp().rotate()` (EXIF orientation normalized per roadmap §8) → 512px PNG on S3 (`photos` purpose), stored as key, signed URL on read.
- **Documents**: PDF/JPG/PNG ≤10 MB per staff member (`staff_documents`, hard-deleted with the S3 object — audit keeps history, same treatment as M05 holidays).
- **NID duplicate soft check**: `GET /staff/check-nid` — the form warns inline, creation is never blocked (BD data quality reality, roadmap §8).
- **User administration** (completes the `/users` resource M03 started): `GET /users` (filters: type/status/role; searches email/phone/staff name; returns roles + linked staff profile), `PUT /users/:id/status` (self-change blocked, last-active-Super-Admin protected, non-ACTIVE revokes all sessions), `POST /users/:id/reset-password` (temp password returned once + queued to SMS/email, forced change, all sessions revoked).
- **Staff deletion**: soft-deletes the profile **and** the user (partial uniques free the email/phone for re-registration) and revokes sessions; the employee ID stays burned — its unique index deliberately ignores `deleted_at`.

## Database Changes

Migration `20260716231424_staff_user_management`:

- Enums: `staff_designation_enum`, `gender_enum` (shared with M08/M09), `employment_type_enum`, `staff_status_enum`, `staff_document_type_enum`.
- `staff_profiles`: profile fields per roadmap §3 + audit/soft-delete. `uq_staff_profiles_user(user_id)`; **`uq_staff_profiles_employee_id(school_id, employee_id)` is NOT deleted_at-scoped** (IDs never reused); `chk_staff_profiles_dates (dob < joining_date)`; indexes on `(school_id, status)` and `department_id`.
- `staff_documents`: hard-deleted file records (`school_id`, `staff_id` CASCADE, title, type, `file_url` = S3 key, mime, size, uploaded_by); `chk_staff_documents_size`.
- `document_sequences`: `(school_id, prefix, next_value)` with `uq_document_sequences_prefix` + `chk_document_sequences_value` — the shared counter table.
- Schema-only alignment: `Shift.@@unique([schoolId, name])` declared in Prisma to match the hand-written M06 `uq_shifts_name` (stops `migrate dev` drift wanting to drop it).

## API Endpoints Added

```
GET    /api/v1/staff                       (?designation=&departmentId=&status=&search=)
GET    /api/v1/staff/check-nid             (?nid=&excludeId=)
GET    /api/v1/staff/:id
POST   /api/v1/staff
PUT    /api/v1/staff/:id
DELETE /api/v1/staff/:id
PUT    /api/v1/staff/:id/status
POST   /api/v1/staff/:id/photo             (multipart)
GET    /api/v1/staff/:id/documents
POST   /api/v1/staff/:id/documents         (multipart: file + title + type)
DELETE /api/v1/staff/:id/documents/:docId
GET    /api/v1/users                       (?userType=&status=&roleId=&search=)
PUT    /api/v1/users/:id/status
POST   /api/v1/users/:id/reset-password
```

New permission codes (9): `staff.view|create|update|delete|status|document.manage`, `user.view|status|password.reset`. Principal gains the staff set + `user.view`; Vice Principal `staff.view` + `user.view`; Office Staff `staff.view`.

## Frontend Pages Created

- `/admin/staff` — list (DataTable: designation/department/status filters, search, CSV export).
- `/admin/staff/new` — multi-section registration form (Account / Personal / Employment / Address) with live NID-duplicate warning.
- `/admin/staff/[id]` — detail with tabs: **Profile** (edit + photo upload + delete), **Documents** (upload/view/delete), **Roles** (the user-role-assignment UI slot promised in M03), **Activity** (audit-log slice with JSON diff dialog); status-change dialog with reason.
- `/admin/users` — all accounts with quick actions behind `<Can>`: reset password (one-time temp-password dialog with copy), activate/deactivate.
- Sidebar: “Staff” (`staff.view`) and “Users” (`user.view`) menu items.

## Components Created (new shared/reusable only)

- **Backend `SequenceService`** (exported by `SequenceModule`) — THE document-number generator for all later modules (PROJECT_CONTEXT §5).
- Frontend `StaffForm` (+ `toFormValues`/`toApiInput`) — reused by create page and detail Profile tab; the multi-section layout is the template for the Teacher (M08) and Student (M09) forms.

## Business Rules Implemented

- Employee IDs gap-free within a transaction and never reused, even after soft delete.
- Deactivating a user (directly or via staff-status cascade) revokes all refresh tokens immediately.
- RESIGNED/TERMINATED staff auto-deactivate the linked account (event listener); re-ACTIVE reactivates it.
- Staff must be ≥18 (DOB), joining date ≤ today and after DOB.
- Email or phone required (phone-only staff supported — welcome goes by SMS).
- You cannot change your own account status; the last active Super Admin cannot be deactivated.
- NID duplicates warn (soft check) — never a unique constraint.

## Known Limitations

- Photo upload is plain file-pick (no in-browser crop; server normalizes to 512px square) — crop UI can come with M09 student photos.
- SMS delivery is still log-only until M17 (queue contract unchanged); phone-only staff effectively receive credentials via the admin's temp-password dialog until then.
- Reset-password/welcome notification enqueue is fire-and-forget: with Redis down the message is silently skipped (admin still holds the returned temp password).
- `GET /users` search does not match guardian/teacher profile names yet (those tables arrive in M08/M09).
- Staff list CSV export exports the current page (DataTable v1 behavior, known since M01).

## Future Improvements

- Bulk staff import (XLSX) — the M09 student import pipeline can be generalized backward.
- Per-designation seat/quota reporting for HR (M21).
- Move the temp-password handover fully to SMS once M17 lands (stop returning it in the API response, config-gated).

## Breaking Changes

- None for existing endpoints. `UsersRepository` gained methods (`paginateAdminList`, `countOtherActiveSuperAdmins`, `setTempPassword`) and `UserRolesRepository` gained `assignRole` — additive only.

## Migration Steps

1. `npx prisma migrate deploy` (creates enums + 3 tables).
2. `npm run seed` (syncs the 9 new permission codes; extends Principal/Vice-Principal/Office-Staff core sets).
3. No env changes. Optional: override `general.employee_id_pattern` in Settings → General.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | none (optional `S3_BUCKET_PHOTOS` / `S3_BUCKET_DOCUMENTS` honored by the existing bucket-per-purpose convention) |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Create staff → user + role + employee ID in one tx | ✅ | e2e: `HXS-S-21NNNN` pattern, `must_change_password=true`, accountant role assigned |
| 5 parallel creates → distinct employee IDs | ✅ | e2e concurrency test (row-lock serialized upsert) |
| Duplicate phone → 409; underage/future joining → 400 | ✅ | e2e |
| NID duplicate warns, never blocks | ✅ | e2e: second staff with same NID → 201 |
| Admin reset-password → temp password logs in | ✅ | e2e (real login with returned password) |
| RESIGNED → user INACTIVE + all sessions revoked | ✅ | e2e (cascade order: revoke first, then flip status) |
| Delete staff → contact freed, employee ID burned | ✅ | e2e (re-register same phone gets a NEW ID) |
| Self status change blocked | ✅ | e2e |
| Permission guards (403 without codes) | ✅ | e2e |
| Photo/document upload against MinIO in-browser | ⏳ | validation layers e2e-tested; browser click-through pending (same status as M04 logo) |

## Remaining TODOs

- [ ] In-browser click-through of photo/document upload against MinIO (validation + storage layers individually verified).
- [ ] Consider folding `PermissionsCacheService` into `RedisCacheService` (carried from M03→04).

## Links to Related Modules

- Depends on: Module 03 (roles/permissions/audit), 04 (settings, school code), 06 (departments).
- Unlocks / hooks completed for: **M08 Teachers** (same user-creation pattern + `gender_enum`), **M09 Students** (SequenceService for UIDs, document-table pattern), **M03's role-assignment UI slot** (now the staff detail Roles tab), **M21 HR** (status-with-reason audit trail).
- `PROJECT_CONTEXT.md` sections updated: §5 (SequenceService row), §8 (staff_profiles in the entity spine), §16 (fire-and-forget notification decision, employee-ID unique not soft-delete-scoped), §18 (TODO moved/added).
