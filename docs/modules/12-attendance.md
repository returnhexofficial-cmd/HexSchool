# Module 12 — Attendance Management · Completion Document

| | |
|---|---|
| **Module** | 12 — Attendance Management |
| **Completion date** | 2026-07-22 |
| **Actual effort** | 1 dev-day (est. was 5) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 12 |

## Summary of Implemented Features

- **Student attendance, daily mode.** `GET /attendance/students` returns the marking sheet for a (section, date): the M11 canonical roster, any existing marks, holiday state, and an `editable`/`lockReason` pair. `POST /attendance/students` upserts the whole grid in one transaction. Every row keys on **`enrollment_id`**, never `student_id`.
- **Entry guards** (roadmap §6): no future dates; no dates outside the section's session; **COMPLETED/ARCHIVED sessions are read-only** (the M05 rule, enforced for the first time here); holidays blocked unless `overrideHoliday` + `attendance.holiday.override`; re-marking an already-marked day needs `attendance.edit`; editing past the configured window needs `attendance.edit.past`. The last three are runtime permission checks in the service (the M08 convention — one route serves both cases).
- **Approved-leave override.** A submitted `ABSENT` becomes `LEAVE` when an approved leave covers that date; the response reports `leaveOverrides`.
- **QR check-in.** `POST /attendance/qr-checkin` resolves the card's `qr_token` → student → current enrollment, then grades arrival against the section's **shift start time** (falling back to `attendance.default_start_time`): within grace → PRESENT, past it → LATE, past the half-day cutoff → HALF_DAY. A re-scan inside `attendance.qr_duplicate_window_minutes` is idempotent (`marked: false, alreadyMarked: true`), not an error. Returns the student's photo (signed URL), class/section and roll for the scanner's confirmation card.
- **Late-holiday tool.** `POST /attendance/convert-holiday` flips every mark on a date (section-scoped or school-wide) to `HOLIDAY`, which removes the day from both sides of every percentage. Audited with the mandatory reason.
- **Staff/teacher attendance.** `GET/POST /attendance/staff` over the union of `teachers` + `staff_profiles` (polymorphic `person_type` + `person_id`); only ACTIVE/ON_LEAVE employees appear. Same holiday guard.
- **Student leave applications.** Full CRUD + approve/reject. Creating validates the range against the session and refuses overlaps with an open/approved leave. **Approving is the retroactive fix** the roadmap asks for: already-recorded ABSENT/HALF_DAY days in the range are converted to LEAVE (across *every* enrollment the student held that session, so a mid-year transfer is covered), and the count is returned as `correctedDays`.
- **Jobs.** `AutoAbsentJob` (every 15 min, gated on `attendance.auto_absent_enabled` + the Dhaka cutoff) marks unmarked students ABSENT **only in sections someone already started marking** — an untouched sheet never absents a whole class. `AbsentSmsJob` queues one guardian SMS per absent student onto the M02 `notifications` queue (log-only until M17), deduped by `absent_notified_at` and bounded by `attendance.absent_sms_daily_cap`.
- **Teacher-leave hook closed.** `AttendanceListener` subscribes to the M08 `teacher.leave.approved` event and marks those days LEAVE in `staff_attendances`, skipping holidays.
- **Reports + exports.** Daily sheet, monthly register (students × working days), per-student summary with a **per-section split** for transfers, staff monthly register, session summary with a daily trend series, and late analysis. Each has a mirrored `/export` route rendering **XLSX (exceljs) or PDF (pdfkit)**.
- **Debts closed.** `GET /students/:id/attendance-history` (M09) now returns real data; the **M11 promotion rollback guard** now blocks with a 409 once attendance exists in the target session.

## Database Changes

Migration `20260721165553_attendance_management`:

**Enums** — `attendance_status_enum` (PRESENT/ABSENT/LATE/LEAVE/HALF_DAY/HOLIDAY), `attendance_method_enum` (MANUAL/QR/IMPORT/AUTO), `attendance_person_type_enum` (TEACHER/STAFF), `student_leave_applied_by_enum` (GUARDIAN/ADMIN). Student leave reuses the M08 `leave_status_enum`.

**Tables**
- `student_attendances` — `enrollment_id` FK (CASCADE), `section_id` FK, `date`, `period_id` (nullable UUID, no FK until M13), `status`, `check_in_time`, `method`, `remarks`, `marked_by`, `absent_notified_at`, audit + soft delete. Indexes `idx_student_attendances_section_date`, `_enrollment_date`, `_school_date`.
- `staff_attendances` — `person_type` + `person_id` (polymorphic, **no FK** — the two employee lifecycles stay independent, per the M08 decision), `date`, `status`, `check_in_time`, `check_out_time`, `method`, `remarks`, `marked_by`, audit + soft delete.
- `student_leave_applications` — `student_id` FK, `session_id` FK, `from_date`, `to_date`, `reason`, `applied_by`, `status`, `approved_by`, `approved_at`, `decision_note`, audit + soft delete.

**Hand-written constraints** (Prisma cannot express them)
- `uq_student_attendances_entry` — UNIQUE `(enrollment_id, date, COALESCE(period_id, nil uuid))` `WHERE deleted_at IS NULL`. The COALESCE is the M06 trick: Postgres treats NULLs as distinct, so daily-mode rows would otherwise never collide.
- `uq_staff_attendances_entry` — UNIQUE `(person_type, person_id, date)` `WHERE deleted_at IS NULL`.
- `chk_student_leave_applications_range` — `from_date <= to_date`.

## API Endpoints Added

```
GET    /api/v1/attendance/students?sectionId=&date=&periodId=
POST   /api/v1/attendance/students          {sectionId, date, entries[], overrideHoliday?}
POST   /api/v1/attendance/qr-checkin        {qrToken, date?}
POST   /api/v1/attendance/convert-holiday   {date, sectionId?, reason}
GET    /api/v1/attendance/staff?date=&personType=&departmentId=
POST   /api/v1/attendance/staff             {date, entries[], overrideHoliday?}

GET    /api/v1/student-leaves                GET/PUT/DELETE /api/v1/student-leaves/:id
POST   /api/v1/student-leaves
POST   /api/v1/student-leaves/:id/approve | /reject

GET    /api/v1/attendance/reports/daily         + /daily/export?format=xlsx|pdf
GET    /api/v1/attendance/reports/monthly       + /monthly/export
GET    /api/v1/attendance/reports/student/:id   + /student/:id/export
GET    /api/v1/attendance/reports/staff         + /staff/export
GET    /api/v1/attendance/reports/summary       + /summary/export
GET    /api/v1/attendance/reports/late-analysis + /late-analysis/export
```

12 new permission codes: `attendance.view|mark|edit|edit.past|holiday.override|qr.checkin|staff.view|staff.mark|report`, `student.leave.view|manage|approve`. Principal gets them all; Vice Principal marks/edits/approves; Teacher marks, scans and reads leave.

## Frontend Pages Created

- `/admin/attendance` — marking grid: class + section + date pickers, all-present default with tap-to-cycle status buttons, per-row remarks popover, "set all" row, sticky save bar with a live tally, already-marked / holiday / locked banners, and the convert-to-holiday dialog.
- `/admin/attendance/scan` — QR scanner using the browser's built-in `BarcodeDetector` (no scanner dependency) plus a manual/USB-scanner entry field, with a big pass/fail confirmation card showing the student's photo, class, roll, status and minutes late.
- `/admin/attendance/staff` — employee grid (teachers + staff, filterable by type).
- `/admin/attendance/leaves` — leave inbox: status filter, approve/reject dialogs surfacing the retro-correction count, and a create dialog with a debounced student picker.
- `/admin/attendance/reports` — four tabs (Summary / Monthly register / Daily sheet / Late analysis) with XLSX + PDF export buttons, a horizontally-scrolling register matrix with sticky roll/name columns, and a dependency-free SVG trend sparkline.
- `/admin/students/[id]` **Attendance tab** rewritten from the "arrives with Module 12" placeholder to real stat cards + a recent-days table.

Three new sidebar entries (Attendance, Staff Attendance, Student Leave), each permission-gated.

## Components Created (new shared/reusable only)

None — the module is built entirely on the existing shared kit (`PageHeader`, `StatCard`, `EmptyState`, `ErrorState`, `Spinner`, `Can`, shadcn table/dialog/select). The trend sparkline is local to the reports page; a real chart component belongs to the M18 report engine.

## Business Rules Implemented

- Attendance cannot be taken for a future date, a date outside the section's session, or in a COMPLETED/ARCHIVED session.
- Holidays block marking; override needs `attendance.holiday.override`. Weekly off-days come from the M04 `general.weekly_holidays` setting via `CalendarService`.
- LATE counts as present for the percentage but is tracked separately (and drives the late-analysis report against `attendance.late_alert_threshold`).
- Attendance % = `(present + late + 0.5 × half-day) ÷ working days`, where working days exclude holidays, weekly off-days, days before the student's `enrollment_date`, and any day converted to HOLIDAY.
- Approved student leave overrides ABSENT for the covered dates, both retroactively (on approval) and at marking time.
- Editing attendance older than `attendance.edit_window_days` (default 7) requires the elevated permission.
- Employees who are RESIGNED/TERMINATED never appear on the staff sheet.
- Absent SMS is deduped per student per day and capped per day.

## Known Limitations

- **Period mode is schema-only.** `attendance.mode` and the `period_id` column exist, but with no timetable there are no periods to mark; every write passes `periodId: null`. M13 adds the FK and the per-period UI.
- **QR check-in always writes to today's current-session enrollment.** The `date` parameter is accepted but the enrollment lookup uses the current session, so back-dated scanning across a session boundary is not supported.
- **Absent SMS is log-only** until M17 wires the BD gateway (the queue contract is final).
- **The percentage counts LEAVE in the denominator**, per the roadmap formula. Schools that want approved leave excluded entirely will need a setting — deliberately not invented here.
- **`AutoAbsentJob`/`AbsentSmsJob` iterate all schools every 15 minutes.** Fine for one school; M31 should shard or queue this.
- PDF exports are plain tabular renders (no branding/letterhead) — the styled report engine is M18.
- The daily-report roll-up loads each section's roster in a loop; acceptable at one school's section count, worth batching if it shows up in M29 profiling.

## Future Improvements

- Per-period attendance UI once M13 lands (the storage and unique index already allow it).
- Biometric/RFID check-in reusing the QR endpoint's shape (roadmap M32).
- A "close the day" manual action reusing `AutoAbsentJob.runForSchool` instead of waiting for the cron.
- Guardian-raised leave applications from the parent portal (M18) — `applied_by: GUARDIAN` already exists.
- Attendance-percentage caching for the M18 dashboards.

## Breaking Changes

None. Two behaviour changes that consumers should know about:

- **`GET /students/:id/attendance-history` changed shape** — it previously returned `{ available: false, reason, items: [] }` and now returns `{ available: true, counts, markedDays, presentEquivalent, percentage, items[] }`. The frontend tab was updated in the same commit; any other consumer must react.
- **Promotion rollback can now fail with 409.** `POST /promotions/:id/rollback` refuses once attendance rows exist against the enrollments the batch created (the M11 hook, now live).

## Migration Steps

1. `npx prisma migrate deploy` (applies `20260721165553_attendance_management`).
2. `npx prisma generate` — the client gains four enums and three models.
3. `npm run seed` (or restart the app) so the permission registry syncs the 12 new codes and the system roles pick up their defaults.
4. Review the `attendance` settings group under `/admin/settings/attendance` — **auto-absent and absent SMS both default to OFF**; set the cutoff/dispatch times before enabling.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. All attendance configuration lives in the M04 settings registry. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Mark a section, reload the sheet | ✅ | Statuses persist; sheet reports `marked: true` |
| Re-mark the same day | ✅ | Updates in place — still exactly 3 rows in the DB (e2e-asserted) |
| Mark a future date | ✅ blocked | 400 "cannot be taken for a future date" |
| Mark a holiday without/with override | ✅ | 400 → 403 for a user lacking the code → 201 for an admin |
| Convert a marked date to HOLIDAY | ✅ | All rows on the date flip; percentage denominator drops |
| Approve a leave over a recorded absence | ✅ | `correctedDays: 1`, row becomes LEAVE |
| Mark ABSENT after leave approval | ✅ | Stored as LEAVE, `leaveOverrides: 1` |
| Overlapping leave application | ✅ blocked | 409 |
| Unknown QR token / no permission | ✅ | 404 / 403 |
| Staff sheet + mark round trip | ✅ | Union of teachers and staff, marks persist |
| Daily / monthly / student / summary / late reports | ✅ | Counts and working days match the marked data |
| XLSX + PDF export | ✅ | Correct content types; PDF starts with `%PDF` |
| Export without `attendance.report` | ✅ blocked | 403 |
| Promotion rollback with attendance present | ✅ blocked | 409 (M11 guard live) |
| QR time thresholds, dedupe window, shift start | ✅ unit | Fake-timer specs cover PRESENT/LATE/HALF_DAY and re-scan |
| Auto-absent + absent-SMS jobs | ✅ unit | Setting gates, cutoff, holiday skip, idempotency, cap, dedupe |

Tests: **344 backend unit** (61 new) + **17 attendance e2e** (157 e2e total) / **119 frontend** (12 new). The full e2e run shows the known-flaky `school.e2e-spec` audit-diff race (PROJECT_CONTEXT §18) on some runs; it passes standalone and is unrelated to this module.

## Remaining TODOs

- [ ] In-browser click-through: the QR scanner against a real phone camera (the `BarcodeDetector` path is untested outside unit-level logic; the manual-entry path is e2e-covered).
- [ ] In-browser click-through: marking grid with 100+ students (roadmap §9 performance check) — the grid is a plain table today, virtualize if it drags.
- [ ] Run the auto-absent and absent-SMS crons against a live day once M17 makes SMS real.
- [ ] Swap `periodId: null` for real periods when M13 lands, and add the `period_id` FK.

## Links to Related Modules

- Depends on: Module 05 (holidays, `CalendarService`), 08 (teachers + the `teacher.leave.approved` event), 09 (students, guardians, `qr_token`), 11 (the canonical roster and `enrollment_id`).
- Unlocks / hooks completed for: Module 13 (period mode — swap `periodId`), 17 (absent SMS already queued), 18 (dashboards read `AttendanceReportsService`), 21 (payroll reads `staff_attendances`).
- Debts closed: M09 `attendance-history` is live; M11's promotion rollback guard now blocks on attendance.
- New shared capability: `CalendarService.workingDays(schoolId, from, to, appliesTo?)` (M05 extension) — the denominator for any later percentage.
- `PROJECT_CONTEXT.md` sections updated: §5 (shared services), §8 (entity spine), §11 (global rules), §16 (decisions), §18 (debt).
