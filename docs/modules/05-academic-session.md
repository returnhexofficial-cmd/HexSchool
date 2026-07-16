# Module 05 — Academic Session & Calendar · Completion Document

| | |
|---|---|
| **Module** | 05 — Academic Session & Calendar |
| **Completion date** | 2026-07-16 |
| **Actual effort** | 1 dev-day (est. was 2) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 05 |

## Summary of Implemented Features

**Backend (`hexschool-backend`, new `src/modules/academic/` namespace — M06 will extend it)**
- **`academic_sessions`** with the full rule set (roadmap M05 §6): exactly one `is_current` per school (transactional activate + hand-written partial unique index), no overlapping date ranges per school, name unique per school (soft-delete-aware partial index), `chk(start < end)`. **Activate** demotes the previous current (an ACTIVE one rolls over to COMPLETED — the year-rollover flow; revertible via PUT) and promotes the target to ACTIVE+current. Deletion blocked for the current session or while holidays/events reference it (409 "archive instead" — the guard grows to enrollment/attendance/exams from M11). **Mid-year date corrections** are blocked while any holiday/event would fall outside the new range (M05 §8; attendance/exam checks join later).
- **`holidays`** (hard-deleted per spec, audited): must fall within their session; `type` (GOVERNMENT/RELIGIOUS/SCHOOL/WEEKLY) + `applies_to` (ALL/STUDENTS/STAFF). **CSV bulk import** (`POST /holidays/import`, multipart): header `title,start_date,end_date,type,applies_to`, valid rows import, invalid rows come back as a row-level error report with line numbers (BD context: government holidays announced late, M05 §8).
- **`calendar_events`** (soft-deleted): end ≥ start, `type` (EXAM/EVENT/…), `is_public` for the M19 website.
- **`isHoliday(schoolId, date, appliesTo?)`** on the exported `CalendarService` — the shared contract Attendance (M12) and Payroll (M21) consume: checks the per-school weekly off-days from the M04 setting `general.weekly_holidays` (default `["FRIDAY"]`) first, then holiday ranges; returns `{holiday, reason: WEEKLY|RANGE, title}`.
- **`GET /calendar?month=YYYY-MM|sessionId=`** month/session aggregate (weekly off-days + holidays + events) and **`GET /calendar.ics`** iCal export (hand-rolled RFC 5545 writer, all-day VEVENTs with exclusive DTEND, proper text escaping; `@SkipEnvelope` + `text/calendar`).
- **Strict date parsing** (`parseDate`): the DTO regex checks only the shape, so `2026-13-99` / `2026-02-30` used to reach Prisma as Invalid Dates (found via e2e, 500) — every service now round-trips ISO parse↔format and 400s on impossible dates.
- 13 new permission codes (`session.view|create|update|delete|activate`, `calendar.view`, `holiday.create|update|delete|import`, `event.create|update|delete`); Principal/Vice-Principal/Teacher cores extended (idempotent seeder granted them on re-run).

**Frontend (`hexschool-frontend`)**
- **`/admin/sessions`**: DataTable (current-session star, status badges, sortable dates), create/edit dialog (RHF+Zod with strict-date refinements), **activate confirm dialog with scoping-effects warning copy**, guarded delete.
- **`/admin/calendar`**: month grid (Sunday-first weeks via the `buildMonthGrid` util; weekly off-days shaded, holidays amber, events color-coded by type) with month navigation, **list view** with per-row delete, add-holiday and add-event dialogs (scoped to the switcher's session), **iCal download** (blob).
- **Global session switcher** (new convention, roadmap M05 §5): `academicSession` Redux slice + `useAcademicSession()` hook — selection persisted per user (`localStorage: hs_academic_session:{userId}`), hydrates from the stored choice and falls back to the school's current session; `SessionSwitcher` select lives in the admin header. **Every session-scoped page from M06 on reads `useAcademicSession().selected`.**

## Database Changes
- Prisma migration `prisma/migrations/20260716113735_academic_session_calendar/migration.sql`:
  - Enums `session_status_enum`, `holiday_type_enum`, `holiday_applies_to_enum`, `calendar_event_type_enum`.
  - Tables `academic_sessions`, `holidays` (FK → session CASCADE), `calendar_events` (FK → session CASCADE); range indexes on `(school_id, start_date, end_date)`.
  - **Hand-written:** partial uniques `uq_academic_sessions_name` and `uq_academic_sessions_current` (one current per school), CHECKs `chk_academic_sessions_dates` (start < end) and `chk_holidays_dates`/`chk_calendar_events_dates` (start ≤ end).

## API Endpoints Added
```
GET/POST            /api/v1/academic-sessions              session.view / session.create
GET                 /api/v1/academic-sessions/current      session.view (switcher default)
GET/PUT/DELETE      /api/v1/academic-sessions/:id          session.view / session.update / session.delete
POST                /api/v1/academic-sessions/:id/activate session.activate
GET/POST            /api/v1/holidays                       calendar.view / holiday.create
POST                /api/v1/holidays/import                holiday.import (multipart CSV, ≤256 KB)
PUT/DELETE          /api/v1/holidays/:id                   holiday.update / holiday.delete
GET/POST            /api/v1/calendar-events                calendar.view / event.create
PUT/DELETE          /api/v1/calendar-events/:id            event.update / event.delete
GET                 /api/v1/calendar?month=&sessionId=     calendar.view (aggregate)
GET                 /api/v1/calendar.ics                   calendar.view (text/calendar)
```

## Frontend Pages Created
- `/admin/sessions`, `/admin/calendar` (+ sidebar entries, + `SessionSwitcher` in the admin header).

## Components Created (new shared/reusable only)
- `SessionSwitcher` + `useAcademicSession()` + `academicSession` Redux slice (THE session-scoping convention), `buildMonthGrid`/`inRange`/`monthInfo` utils, backend `parseDate` strict date util, `buildIcs` iCal writer, `academicApi` client, academic Zod schemas.

## Business Rules Implemented
- Exactly one current session per school; sessions never overlap in dates; names unique per school.
- Activate is transactional; the demoted ACTIVE session becomes COMPLETED (read-only for entry flows — consumers enforce from M12/M15).
- Delete blocked for the current session or once referenced (holidays/events today; enrollment/attendance/exams extend the same guard).
- Date corrections only while nothing falls outside the new range.
- Holidays must fall within their session; event end ≥ start.
- Weekly off-days are configuration (M04 setting), not holiday rows — `isHoliday` merges both.

## Known Limitations
- CSV import doesn't support quoted commas in titles (simple `split(',')` — documented; XLSX import arrives with the M18 report engine tooling).
- `GET /calendar.ics` requires a Bearer token — calendar apps can't subscribe directly; the UI offers a download instead (tokenized public feed can come with M19).
- COMPLETED-session read-only enforcement is a consumer contract (attendance/marks modules must check), not a DB lock.
- The switcher needs `session.view`; portal user types get session context via their own portal endpoints later (M18).

## Future Improvements
- Tokenized read-only iCal subscription URL (per school) for the public site.
- Holiday templates (recurring national holidays) once multi-year usage patterns emerge.
- `session.date_corrected` domain event when attendance exists (M12 will need to re-validate).

## Breaking Changes
- None. New tables/endpoints only; `general.weekly_holidays` (M04) is now actually consumed.

## Migration Steps
1. `cd hexschool-backend && npx prisma migrate deploy`.
2. `npm run seed` — syncs the 13 new permission codes and extends system-role cores.
3. Frontend: `npm ci && npm run build` as usual. No new env vars or dependencies.

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| — | none | |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Backend lint / typecheck / unit tests | ✅ | 118 tests (91 M01–04 + 27 new: overlap/name/date rules, activate no-op + delegation, delete guards, date-shrink guard, isHoliday weekly/range/appliesTo, month resolution, ICS golden, CSV report, strict-date blind spots) |
| Backend e2e vs live DB+Redis | ✅ | 53 tests across 5 suites (11 new): create/dupe/overlap, activate switch (exactly one current + COMPLETED rollover), current-delete 409, holiday-in-session rule, CSV import report, event date rule, referenced-session delete 409, month aggregate, iCal text/calendar, hard-delete proof; original current session restored in cleanup |
| Migration on dev DB (Neon) | ✅ | Partial uniques + CHECKs applied |
| Seed idempotency | ✅ | 30 registry codes stable, 0 orphaned |
| Frontend lint / typecheck / tests / build | ✅ | 55 tests (46 + 9 new: month-grid weeks/padding, inRange, monthInfo year boundaries, session/holiday/event schemas incl. impossible-date rejection); 17 routes compiled |

## Remaining TODOs
- [ ] Push both repos to GitHub and confirm CI green (M01–04 carry-over).
- [ ] In-browser click-through: create session → activate → add holiday/event → month grid renders → switcher persists across reload (API + component layers verified individually; e2e covers the HTTP flows).

## Links to Related Modules
- Depends on: Module 04 (`general.weekly_holidays` setting via SettingsService), Module 03 (permissions + audit hooks).
- Unlocks / hooks completed for: Module 06 (sessions scope sections/class-subject maps; the switcher convention), M11 (enrollment per session), M12 (`isHoliday` + COMPLETED read-only), M14 (exam windows), M19 (`is_public` events), M21 (payroll `isHoliday`).
- `PROJECT_CONTEXT.md` sections updated: §5, §6, §11, §13, §16.
