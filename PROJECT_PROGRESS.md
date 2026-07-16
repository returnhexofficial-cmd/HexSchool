# PROJECT_PROGRESS.md — SMIS Progress Tracker

> **Last updated:** 2026-07-16 · **Overall completion: 13 % (4 / 32 modules)**

## Status Summary

| | |
|---|---|
| Completed modules | 01, 02, 03, 04 |
| **Current module** | **05 — Academic Session & Calendar** |
| Remaining | 28 |
| Blockers | None |
| Phase | Phase 1 (MVP) — Modules 01–18 |

## High-Priority Tasks (now)

1. Module 05: `academic_sessions` / `holidays` / `calendar_events` Prisma models + migration (single `is_current` partial unique index; date-range CHECKs; no session date overlap per school).
2. Module 05: session CRUD + transactional `activate` endpoint; holiday/event CRUD; `isHoliday(date)` service (weekly holidays come from the M04 `general.weekly_holidays` setting); iCal export.
3. Module 05: frontend sessions list + activate confirm; calendar month grid; **global session switcher in the admin header** (persisted per user — becomes a global convention).
4. Housekeeping: push both repos to GitHub and confirm CI green (workflows are authored, unverified; backend CI now runs `prisma migrate deploy`).

## Recently Completed

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
| 05 Session | 2 | 16 Fees/Payments | 8 | 27 Docs/Certs | 4 |
| 06 Structure | 3 | 17 Communication | 5 | 28 Cmp/Vis/Alumni | 4 |
| 07 Staff/Users | 4 | 18 Portals | 6 | 29 Reports v2 | 5 |
| 08 Teachers | 4 | 19 Website CMS | 7 | 30 SysAdmin | 6 |
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
