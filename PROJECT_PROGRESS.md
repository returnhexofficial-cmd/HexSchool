# PROJECT_PROGRESS.md — SMIS Progress Tracker

> **Last updated:** 2026-07-17 · **Overall completion: 25 % (8 / 32 modules)**

## Status Summary

| | |
|---|---|
| Completed modules | 01, 02, 03, 04, 05, 06, 07, 08 |
| **Current module** | **09 — Student & Guardian Management** |
| Remaining | 24 |
| Blockers | None |
| Phase | Phase 1 (MVP) — Modules 01–18 |

## High-Priority Tasks (now)

1. Module 09: `students` (permanent `student_uid` via SequenceService `{SCHOOL_CODE}-{YEAR}{SEQ5}`, lazy portal account, `qr_token`), `guardians` (+ lazy accounts), `student_guardians` (one primary per student — partial unique), `student_medical_info` (permission-gated `student.medical.view`), `student_documents`, `student_status_history`; note the M02-constraint adjustment from roadmap M09 §8 (user uniqueness at `(school_id, user_type, phone)` — guardians can be staff).
2. Module 09: guardian dedup by phone (siblings share guardians), duplicate-student detector (name+dob+guardian phone — warn only), ID-card PDFs (single + batch per section, QR from `qr_token`, rotate endpoint), XLSX bulk import with row-level error report + template download.
3. Module 09: frontend registration wizard (Personal→Guardians search-or-create→Address→Medical→Documents→Review), student list/detail tabs, guardian pages, import wizard, ID-card preview/batch dialog.
4. Housekeeping: push both repos to GitHub and confirm CI green; chase the M06 e2e open handle; in-browser click-throughs (M04 logo, M07/M08 uploads, M08 matrix + leave inbox).

## Recently Completed

- **Module 08 — Teacher Management** (2026-07-17): `teachers` live as a **separate table sharing the user** (decision recorded; M07 transactional-creation pattern with `general.teacher_id_pattern` IDs + auto `teacher` role), qualifications (year 1950–current), **subject expertise** (`teacher_subjects`) and **assignments** (`teacher_section_subjects`, one teacher per session×section×subject — upsert replaces with audit history; expertise mismatch → 409 unless `override` + `teacher.assign.override`; `TIMETABLE_CONFLICT_CHECKER` DI hook no-op until M13), **bulk transfer** + resign guard (RESIGNED/TERMINATED/delete blocked while current-session duties exist), **class-teacher FK on sections** (M06 debt closed; cap via `academic.max_class_teacher_sections`), interim **leaves** (within current session, approved-overlap blocked, PENDING-only edits, `teacher.leave.approved` event for M12), **evaluations** (criteria from `academic.teacher_evaluation_criteria`), documents, interim workload/schedule endpoints. 13 permission codes. Frontend: `/admin/teachers` (list/new/7-tab detail), **assignment matrix** (★ expertise, override confirm, workload table), **leave inbox**, class-teacher picker in the M06 section dialog. 193 backend unit + 96 e2e / 73 frontend tests green. See `docs/modules/08-teachers.md`.

- **Module 07 — Staff & User Management** (2026-07-17): staff registry live — **transactional creation** (gap-free employee ID + user with temp password/`must_change_password` + designation-mapped default system role + profile, one tx), welcome credentials via the notifications queue, photo (EXIF-normalized 512px PNG) & document (pdf/jpg/png ≤10 MB, hard-deleted with S3 object) uploads, status transitions with mandatory reason + **RESIGNED/TERMINATED → account-deactivation cascade** (sessions revoked first), NID duplicate soft-check (warn, never block), staff delete soft-deletes the user too (frees contact; employee ID stays burned — its unique ignores `deleted_at`). New shared **`SequenceService`** (`document_sequences`, row-lock upsert inside caller's tx — M09/10/16/20 reuse it; pattern from new `general.employee_id_pattern` setting). User admin surface: `GET /users` (type/status/role filters), status control (self-change blocked, last-active-Super-Admin protected, non-ACTIVE revokes sessions), admin reset-password (one-time temp password + queued SMS/email). 9 permission codes; Principal/Vice-Principal/Office-Staff core sets extended. Frontend: `/admin/staff` (list/new/detail with Profile/Documents/**Roles** (the M03 UI slot)/Activity tabs), `/admin/users` with quick actions behind `<Can>`. 162 backend unit + 81 e2e / 67 frontend tests green. See `docs/modules/07-staff-users.md`.

- **Module 06 — Academic Structure** (2026-07-17): all six entities live (`departments`, `shifts`, `classes`, `groups`, `sections`, `subjects`) + `class_subjects` curriculum mapping — soft-delete-aware uniques, **COALESCE identity indexes** so NULL shift/group can't evade section/mapping uniqueness, group-applicability rule (streams from class 9), guarded deletes with explanatory 409s, `class_teacher_id` deferred-FK column for M08; **bulk subject assign** (order/optional/full-marks/per-group) and **clone-to-session** (additive, idempotent, preview dry-run, teachers not copied); 9 permission codes (`<entity>.manage` granularity); standard BD groups seeded. Frontend: `/admin/structure` tabbed area on a new reusable **`MasterCrud`** generic, class detail with session-scoped Sections/Subjects tabs (first consumers of the M05 switcher), clone wizard. e2e now runs serially (`maxWorkers: 1` — shared dev infra). 138 backend unit + 67 e2e / 60 frontend tests green. See `docs/modules/06-academic-structure.md`.

- **Module 05 — Academic Session & Calendar** (2026-07-16): `academic_sessions` (one `is_current` per school via partial unique index, transactional activate w/ COMPLETED rollover, no date overlap, guarded delete + date corrections), `holidays` (within-session rule, **CSV bulk import with row-level error report**), `calendar_events` (`is_public` for M19); **`isHoliday()`** on the exported CalendarService (weekly off-days from the M04 setting + ranges) for Attendance/Payroll; `GET /calendar` month aggregate + **`/calendar.ics`** iCal export; strict date parsing (regex-shape blind spots like `2026-13-99` now 400, caught via e2e). Frontend: `/admin/sessions` (activate confirm w/ scoping warning), `/admin/calendar` (month grid w/ shaded weekly off-days + color-coded entries, list view, dialogs, iCal download), **global session switcher in the admin header** (Redux slice + `useAcademicSession()`, persisted per user — the session-scoping convention for all later modules). 13 new permission codes. 118 backend unit + 53 e2e / 55 frontend tests green. See `docs/modules/05-academic-session.md`.

- **Module 04 — School Setup & Settings** (2026-07-16): `schools` table live with the bootstrap row (`DEFAULT_SCHOOL_ID`) inserted in-migration before the deferred `users`/`roles` FKs; settings registry as code (8 groups) + `SettingsService` (typed getters, Redis 60 s cache with bust-on-write, **AES-256-GCM secrets at rest**, `__SECRET__` masking); school profile CRUD + logo upload (sharp → 512px PNG → S3, signed URLs); grading systems CRUD with overlap/coverage validators + **NCTB Standard seed** as default (one-default partial unique index); test-email (via saved config, verified against Mailpit) / test-sms (log-only) endpoints; 8 new permission codes. Frontend: `/admin/settings` tabbed area (profile + logo, generic group forms with secret reveal + send-test, grading editor with live overlap/gap warnings), school name+logo in the admin sidebar. New deps: sharp. 91 backend unit + 42 e2e / 46 frontend tests green. See `docs/modules/04-school-setup.md`.

- **Module 03 — Authorization, Roles & Audit Logging** (2026-07-16): full RBAC live — permission registry as code (idempotent sync seeder, orphan flagging), 11 seeded system roles with locked core permission sets, global `PermissionsGuard` (+`@RequirePermissions`/`@RequireAnyPermission`, Super Admin bypass, Redis-cached 5 min with instant invalidation on role change), role/permission/user-role CRUD APIs with optimistic concurrency + last-super-admin/≥1-role protection, global `AuditInterceptor` (AsyncLocalStorage service hooks for real old/new diffs, secret redaction, immutable `audit_logs`), `/auth/me` now returns real codes. Frontend: admin shell with permission-gated sidebar, `<Can>` + `usePermissions()`, roles list + permission-matrix editor, audit log viewer with JSON diff dialog. **Note:** global guard chain now pinned in `AppModule` (throttle → JWT → permissions). 64 backend unit + 27 e2e / 38 frontend tests green. See `docs/modules/03-authorization-audit.md`.

- **Module 02 — Authentication** (2026-07-15): full JWT auth live — login/lockout, rotating refresh tokens w/ reuse detection (theft ⇒ revoke all + SMS alert), OTP-backed reset via new `notifications` queue, session manager, global `JwtAuthGuard` + `@Public()`, nightly purge job; frontend login/forgot/verify/reset/change flows (RHF+Zod), Redux Toolkit auth store, `proxy.ts` route guards, forced-password-change interstitial. **Stack changes:** ORM switched TypeORM → **Prisma 7** (owner decision; data layer rebuilt, migrations via `prisma migrate`), frontend global state on **Redux Toolkit** (owner decision, replaces planned Zustand). 43 backend + 25 frontend tests green. See `docs/modules/02-authentication.md`.
- **Module 01 — Project Setup & Core Infrastructure** (2026-07-15): both repos bootstrapped production-grade; Docker dev environment (postgres/redis/minio/mailpit) verified live; global pipes/filters/interceptors, BaseRepository, Swagger, Bull Board, health/version endpoints; shadcn/ui + shared components v1; 23 tests green across repos. See `docs/modules/01-project-setup.md`.
- Master roadmap, project context, dependency graph, and this tracker authored (project inception).

## Upcoming Milestones

| Milestone | Target | Definition |
|---|---|---|
| M-A: Foundation ready | End of Module 04 | Auth + RBAC + audit + settings live; a user can log in and manage roles |
| M-B: Academic core | End of Module 11 | Students enrolled into sections with rolls; structure clonable per session |
| M-C: Daily operations | End of Module 13 | Attendance + routines running for a pilot section |
| M-D: First results | End of Module 15 | Full exam cycle: marks → GPA → report cards → publish |
| M-E: Money flowing | End of Module 17 | Invoices, online payment (sandbox), SMS receipts |
| **M-F: MVP demo** | **End of Module 18** | Scripted end-to-end demo: admission → enrollment → attendance → exam → result → fee → SMS |
| M-G: Phase 2 complete | End of Module 29 | All operational modules + analytics v2 |
| M-H: Production-hardened | End of Module 30 | Backups verified, monitoring, CD pipeline |
| M-I: SaaS-ready | End of Module 31 | Multi-tenant isolation suite green |

## Estimated Effort per Module
*(1 unit ≈ 1 focused dev-day; solo-dev calibrated, refine after Module 03 actuals)*

| Module | Est. | Module | Est. | Module | Est. |
|---|---|---|---|---|---|
| ~~01 Setup~~ ✅ | 4 → **1** | 12 Attendance | 5 | 23 Library | 4 |
| ~~02 Auth~~ ✅ | 5 → **1** | 13 Timetable | 4 | 24 Inventory | 4 |
| ~~03 RBAC+Audit~~ ✅ | 4 → **1** | 14 Examination | 5 | 25 Transport | 3 |
| ~~04 School Setup~~ ✅ | 3 → **1** | 15 Marks/Results | 8 | 26 Hostel | 3 |
| ~~05 Session~~ ✅ | 2 → **1** | 16 Fees/Payments | 8 | 27 Docs/Certs | 4 |
| ~~06 Structure~~ ✅ | 3 → **1** | 17 Communication | 5 | 28 Cmp/Vis/Alumni | 4 |
| ~~07 Staff/Users~~ ✅ | 4 → **1** | 18 Portals | 6 | 29 Reports v2 | 5 |
| ~~08 Teachers~~ ✅ | 4 → **1** | 19 Website CMS | 7 | 30 SysAdmin | 6 |
| 09 Students | 6 | 20 Accounting | 6 | 31 Multi-School | 8 |
| 10 Admission | 6 | 21 HR/Payroll | 7 | 32 Future track | per sub-project |
| 11 Enrollment | 4 | 22 Assignments | 3 | | |

**Phase 1 ≈ 81 units · Phase 2 ≈ 47 units · Phase 3 (30–31) ≈ 14 units.**

## Module Ledger
*(one row appended per completed module)*

| # | Module | Started | Completed | Actual effort | Completion doc |
|---|--------|---------|-----------|---------------|----------------|
| 01 | Project Setup & Core Infrastructure | 2026-07-15 | 2026-07-15 | 1 dev-day (est. 4) | `docs/modules/01-project-setup.md` |
| 02 | Authentication (+ Prisma & Redux stack switches) | 2026-07-15 | 2026-07-15 | 1 dev-day (est. 5) | `docs/modules/02-authentication.md` |
| 03 | Authorization, Roles & Audit Logging | 2026-07-15 | 2026-07-16 | 1 dev-day (est. 4) | `docs/modules/03-authorization-audit.md` |
| 04 | School Setup & Settings | 2026-07-16 | 2026-07-16 | 1 dev-day (est. 3) | `docs/modules/04-school-setup.md` |
| 05 | Academic Session & Calendar | 2026-07-16 | 2026-07-16 | 1 dev-day (est. 2) | `docs/modules/05-academic-session.md` |
| 06 | Academic Structure | 2026-07-16 | 2026-07-17 | 1 dev-day (est. 3) | `docs/modules/06-academic-structure.md` |
| 07 | Staff & User Management (+ shared SequenceService) | 2026-07-17 | 2026-07-17 | 1 dev-day (est. 4) | `docs/modules/07-staff-users.md` |
| 08 | Teacher Management (+ class-teacher FK, M13 conflict-hook slot) | 2026-07-17 | 2026-07-17 | 1 dev-day (est. 4) | `docs/modules/08-teachers.md` |
