# Module 18 — Portals & Dashboards + Reports v1 · Completion Document

| | |
|---|---|
| **Module** | 18 — Portals & Dashboards (Student, Parent, Teacher, Principal) + Reports v1 — **Phase 1 capstone** |
| **Completion date** | 2026-07-24 |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 18 |

## Summary of Implemented Features

- **`PortalModule` — a pure aggregator.** No new business tables; it imports the feature modules and composes their already-scoped, exported services into role experiences. A leaf module (nothing imports it), so importing this many modules is cycle-free.
- **Ownership-based authorization (`OwnershipGuard` + `PortalResolverService`).** Portal reads are authorized by **who owns the record**, not by a permission code: a student reads only themselves, a parent only children linked to them via `student_guardians`, a teacher only what they teach. Every check funnels through `assertOwnsStudent`, so there is one place IDOR is prevented — and the services re-check ownership even on routes the guard covers (belt-and-suspenders).
- **Student portal** — an overview (attendance %, average GPA, outstanding dues, today's classes, notices) plus Attendance (a 60-day heat strip), Results (published exams + average GPA), and Dues (running ledger), all me-scoped.
- **Parent portal** — a child switcher over the guardian's linked children, mirroring the student panels per child; a stranger's child id is refused (403).
- **Teacher portal** — today's periods, weekly load, the sections they teach, notices, and shortcuts into the admin attendance / mark-entry / routine pages they hold permission for.
- **Admin/Principal dashboard** — student totals + by-class bars, today's attendance %, teacher attendance, fee collection (today/month/dues), pending admissions, latest-exam result stats, upcoming events and recent notices, cached 5 min in Redis.
- **Accountant workspace** — today's collection by method, pending invoices, and a 6-month collection trend, cached.
- **Reports hub (`GET /reports`)** — a code registry of every existing report, filtered server-side to the reports the caller may actually run, rendered as a searchable catalog grouped by module.
- **Three deferred hooks closed** — the automatic **result-withhold-on-dues**, the portal **Pay Now** over the M16 gateways, and the **dues-reminder SMS blast** to defaulters (the M17 "defaulters audience").

## Database Changes

**None.** Roadmap §3 makes `dashboard_snapshots` optional; the dashboards are cached with the existing `RedisCacheService` (best-effort, degrades to a live compute when Redis is down), so M18 adds **no migration**. The full migration chain therefore remains 16 migrations and the DB stays in sync.

## API Endpoints Added

```
GET  /api/v1/portal/me
GET  /api/v1/portal/student/overview | attendance | results | dues | routine
POST /api/v1/portal/student/pay
GET  /api/v1/portal/parent/overview
GET  /api/v1/portal/parent/child/:childId/overview | attendance | results | dues | routine
POST /api/v1/portal/parent/child/:childId/pay
GET  /api/v1/portal/teacher/overview | routine
GET  /api/v1/portal/teacher/section/:sectionId/roster

GET  /api/v1/dashboard/admin           (cached 5 min; RequirePermissions dashboard.admin)
GET  /api/v1/dashboard/accountant      (cached 5 min; RequirePermissions dashboard.accountant)
POST /api/v1/dashboard/withhold-dues-results   (result.withhold)
POST /api/v1/dashboard/dues-reminders          (fee.report)

GET  /api/v1/reports                    (self-filtering by permission)
```

**3 permission codes**: `dashboard.admin`, `dashboard.accountant`, `report.view`. Portal routes deliberately carry **no** permission code — ownership is the authorization. Baselines: **Principal** gains `dashboard.admin` + `report.view`; **Accountant** gains `dashboard.accountant` + `report.view`; Admin/Super Admin inherit all.

No new settings keys.

## Frontend Pages Created

- **`(portal)` route group** — a lighter, mobile-first shell (top bar + bell + account menu, no fixed sidebar; parents are mobile users). `/portal` reads `/portal/me` and dispatches:
  - **Student** — tabbed panels (Overview / Attendance / Results / Dues).
  - **Parent** — a child switcher above the same panels, fetching the selected child.
  - **Teacher** — today's periods, week summary, my sections, notices, and Take-Attendance / Mark-Entry / Routine shortcuts.
- **`/admin` dashboard** — replaced the placeholder landing with the real admin dashboard (stat cards + a students-by-class bar chart + result stats + upcoming events + recent notices), gated by `dashboard.admin` with a graceful zero-state for users without it.
- **`/admin/reports`** — the searchable reports hub, grouped by module.
- Sidebar gains a **Reports** entry (`report.view`); `proxy.ts` now lets a **teacher** into `/admin/attendance`, `/admin/exams`, `/admin/timetables` (the operational pages they hold permission for — the sidebar `<Can>` and the API guards remain authoritative).

## Components Created (new shared/reusable only)

- **`StudentPanels`** (`app/(portal)/portal/student-panels.tsx`) — the tabbed student view, parameterised by fetcher functions so a student (self) and a parent (child) share one implementation.
- **`BarRow` / `ColumnChart`** (`app/(admin)/admin/dashboard-charts.tsx`) — dependency-free, theme-aware dashboard chart primitives (no chart library vendored).
- **`formatBDT`** (`lib/api/portal.ts`) — a taka money formatter for the portals/dashboards.

## Business Rules Implemented

- **Portal reads are ownership-scoped, not permission-scoped.** A parent/student who requests another student's id gets a `403` (`OwnershipGuard` on any route decorated `@OwnsStudent`), and the services re-verify with `assertOwnsStudent`.
- **A parent with multiple children uses one account** and a child switcher; children come from `student_guardians`.
- **Portal users see only published artifacts** — routines resolve the published version (M13), results the active publication (M15), notices the published feed (M17).
- **Result-withhold-on-dues** withholds the result of every candidate of an exam who still owes money (`LedgerService.outstandingFor` + `ResultsService.setWithheld`); idempotent (an already-withheld result is skipped).
- **Portal Pay Now** verifies each invoice belongs to the owned student before reusing the M16 online-payment init — the gateway verdict is still concluded only by the M16 server-side `verify()`.
- **Dashboards are cached** 5 min; a brand-new school with no data / no current session renders zero-states rather than erroring (roadmap §8).

## Design Decisions

### PortalModule is imported by nothing, so it may import everything
The capstone is composition: rather than duplicate per-student reads, the portal reuses the exported, already-scoped services (`StudentsService.performanceHistory` / `attendanceHistory`, `LedgerService.studentLedger`, `RoutineService`, `ResultsService`). Because no module imports PortalModule, importing this many is cycle-free — the inverse of every other module's careful re-provisioning.

### Ownership is the authorization for portals, not a permission code
A student/parent has no `student.view`; giving portals their own permission codes would either over-grant (any student could read any student) or require per-row policy anyway. The `PortalResolverService` resolves the logged-in user to the exact student ids they own, and that set *is* the authorization — checked by a guard and re-checked in the services.

### No `dashboard_snapshots` table — Redis cache instead
The roadmap marks the table optional. A best-effort Redis cache (`RedisCacheService`) gives the same "fast landing page" without a table + a nightly job + a drift surface, and degrades to a live compute when Redis is down. So M18 ships with no migration.

### Teachers operate from admin pages, not portal clones
Rebuilding attendance-marking and mark-entry inside the portal would duplicate two of the most complex M12/M15 grids. Teachers already hold `attendance.mark` / `mark.entry`; the portal links them into those admin pages and `proxy.ts` lets a teacher render the shell there (the sidebar `<Can>` and the API guards decide what they can actually do).

### The dashboard aggregate is a narrow read repository, not six service calls
`DashboardRepository` runs the cross-module counts/sums directly over Prisma (the M12/M17 `EmployeeDirectory`/`AudienceRepository` precedent) — importing six report services to pull one number each would bloat the module for no gain; `DashboardService` caches the assembled result.

## Known Limitations

- **Teacher "pending mark entries"** (roadmap §5) is not surfaced — marks are keyed on paper, not teacher, so counting a teacher's outstanding entries needs an assignment-join that was out of scope for the capstone; teachers reach mark entry through the exam pages instead.
- **The Reports hub links to endpoints**, it does not embed a param-form runner per report — the actual run/export happens on each module's own page. A single in-hub runner is a natural M29 (Reports v2) upgrade.
- **The parent "contact-school" form / SMS history** (roadmap §5) is deferred — contact-school is an M28 ticket, and per-recipient SMS history is a filter on the M17 delivery log.
- **The attendance "calendar heat view"** is a rolling 60-day strip, not a month-grid calendar (kept simple and mobile-friendly).
- **Dashboards resolve `DEFAULT_SCHOOL_ID` scoping via the token** like every module; multi-tenant is M31.
- **`resultStats`** reports only the single most-recently-published exam, not a trend.

## Future Improvements

- A per-report param-form runner inside the Reports hub (M29 Reports v2).
- Portal document/certificate downloads once M27 issues them.
- Teacher pending-mark-entry counts once an assignment→paper index exists.
- Parent contact-school → M28 ticket; SMS history view over the M17 log.
- A `dashboard_snapshots` table + nightly precompute if the live aggregate ever gets heavy at scale.

## Breaking Changes

**None.** All additions are new endpoints, 3 append-only permission codes, and a frontend route group. The `/admin` landing page changed from a placeholder to a real dashboard (gated, with a zero-state fallback). `proxy.ts` widened teacher access to three admin path prefixes (still API-authoritative).

## Migration Steps

1. **No migration** — M18 adds no tables.
2. `npm run seed` — syncs the 3 new permission codes and extends the Principal/Accountant baselines (idempotent).
3. Nothing else: the portals and dashboards read existing data.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Backend unit suite | ✅ 932 passed | Was 924 — **8 new** (ownership guard + report registry specs) |
| **Backend e2e suite** | ✅ **357 passed (18 suites)** | Was 343/17 — includes the **14-case `portal.e2e-spec.ts`** (IDOR matrix) |
| `portal.e2e-spec.ts` | ✅ 14 passed | Principal resolution, student/parent/teacher reads, **parent→stranger 403**, **student→stranger 403**, student-owns-self, dashboard permission gating, reports permission filtering |
| Migration chain | ✅ unchanged (16 migrations) · DB in sync | M18 adds no migration |
| Seed on Neon | ✅ 159 permission codes synced | +3 for M18; roles extended |
| Frontend test suite (`vitest run`) | ✅ 218 passed (26 files) | Was 214 — **4 new** (`portal.test.ts`) |
| Frontend typecheck / lint | ✅ clean | |
| Frontend production build (`next build`) | ✅ compiled | `/portal` and `/admin/reports` emitted |

## Bugs / rough edges found during verification

### The teacher overview 400'd with no current session (found by the e2e)
`teacherRoutine` throws when neither a session id nor a current session can be resolved, so a teacher's landing page 400'd for a school with no current session (the roadmap §8 "brand-new school" case). Fixed by returning a graceful zero-state (name + notices, no periods) when `getCurrent` is null — the dashboards must render for an empty school.

## Cross-module debts closed

| Debt | Where | Status |
|---|---|---|
| Result-withhold-on-dues not wired (M15/M16) | `PortalActionsService.withholdResultsForDues` | **Live** — withholds every dues-owing candidate of an exam |
| Portal payment view deferred (M16) | `PortalActionsService.payDues` + `POST /portal/**/pay` | **Live** — ownership-checked Pay Now over the M16 gateways |
| Dues-reminder / defaulters audience deferred (M17) | `PortalActionsService.sendDuesReminders` | **Live** — `FEE_DUES` blast to defaulters' guardians via `NotificationService` |
| Portal in-app notifications (M17) | header `NotificationBell` + `/notifications/me` | **Live** — the M17 inbox is user-keyed, so it already serves portal users |
| M09/M12/M13/M15/M16/M17 "M18 renders …" notes | portal pages | **Live** — routines, results, dues, notices surfaced in the portals |

## Remaining TODOs

- [ ] In-browser click-throughs: the parent child-switcher on a phone viewport, a student Pay-Now redirect to a sandbox gateway, and the teacher shortcuts into the admin grids.
- [ ] Reports hub in-place param runner (M29).
- [ ] Teacher pending-mark-entry count.
- [ ] Repo-level: still no `.gitattributes` (`* text=auto eol=lf`) — the CRLF/LF split continues to produce phantom prettier warnings.

## Links to Related Modules

- **Depends on:** Modules 02–17 (it aggregates all of them).
- **Unlocks / hooks completed for:** Module 19 (Website CMS reuses the public read patterns), Module 22 (Assignments plug into the portals), Module 29 (Reports v2 extends the registry). Closed the M15/M16 result-withhold-on-dues, the M16 portal payment view, and the M17 dues-reminder blast.
- **`PROJECT_CONTEXT.md` sections updated:** §5 (shared services), §10 (authorization — the OwnershipGuard), §11 (global business rules), §16 (technical decisions), §18 (technical debt).

---

**Phase 1 (MVP) is complete — Modules 01–18.** The scripted end-to-end path exists across the system: admission → enrollment → attendance → exam → result → fee → SMS, now surfaced to each role through its portal and to administration through the dashboards.
