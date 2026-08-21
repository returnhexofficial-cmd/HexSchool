# QA — Module 12: Attendance Management

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc
[`docs/modules/12-attendance.md`](../modules/12-attendance.md).

Run 2026-08-19 as `admin@qa.hexschool.local`, with boundaries driven as
`teacher@qa.hexschool.local`.

## Marking

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M12-01 | Page is session-scoped | ✅ | "Mark daily attendance for **QA 2026**" |
| M12-02 | Date defaults to **today in Dhaka** | ✅ | Opened `2026-08-19` while UTC was still the 18th — the six-hour window in which a UTC default silently offers yesterday's sheet |
| M12-03 | Future dates unreachable | ✅ | `max="2026-08-19"` on the input; API answers **400** "cannot be taken for a future date" |
| M12-04 | Section picker waits for a class | ✅ | Section select disabled until a class is chosen |
| M12-05 | Roster loads in roll order, keyed on enrolment | ✅ | Roll 1 `QA-2026-0001`, roll 2 `QA-2026-0007`; all-present default with a live tally |
| M12-06 | Status cycles and wraps | ✅ | Present → Absent → Late → Half day → Present |
| M12-07 | Per-row remark, in Bangla | ✅ | `অসুস্থতার কারণে অনুপস্থিত` stored and re-read intact |
| M12-08 | Save persists, keyed on `enrollment_id` | ✅ | Both rows carry `enrollment_id`, `method MANUAL`, `period_id NULL` (daily mode) |
| M12-09 | **Re-marking updates in place** | ✅ | Changed one status and saved again — still **exactly 2 rows** in the table, statuses updated. The `COALESCE(period_id, nil)` unique index doing its job |
| M12-10 | Already-marked banner explains the rules | ✅ | "…updates the existing records (needs the attendance-edit permission) and is audited" |

## Guards

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M12-11 | Weekly off-day announced before typing | ✅ | "**Weekly (FRIDAY)** — this date is a holiday. Saving needs the holiday-override permission." |
| M12-12 | Holiday save without override | ✅ blocked | **400** "Weekly (FRIDAY) is a holiday — pass overrideHoliday=true (requires attendance.holiday.override)" |
| M12-13 | Holiday override by a role lacking the code | ✅ blocked | **403** "Marking attendance on a holiday requires attendance.holiday.override" — the escalation from 400 to 403 is exactly right |
| M12-14 | **COMPLETED session is read-only** | ✅ blocked | **400** "Session QA 2025 is COMPLETED — attendance is read-only", and the GET reports `editable: false` with the *same* `lockReason`. Only reachable after fixing **F27** |

## Leave

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M12-15 | Create an application (Bangla reason) | ✅ | `জ্বরের কারণে ছুটি`, PENDING; the page states the retro-correction rule up front |
| M12-16 | **Approval retro-corrects a recorded absence** | ✅ | "Approved — **1 recorded absence(s) corrected to Leave**"; the `2026-08-17` ABSENT row became LEAVE |
| M12-17 | **Marking ABSENT on a covered day stores LEAVE** | ✅ | `{saved: 1, leaveOverrides: 1}` and the row reads LEAVE — the rule holds in both directions |
| M12-18 | Overlapping application | ✅ blocked | **409** "An open or approved leave already covers part of this range" |
| M12-19 | Sheet shows *why* a student is on leave | ✅ | The roster row badges "approved leave" beside the name and locks the toggle |

## Convert to holiday

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M12-20 | Reason is mandatory | ✅ | Convert stays disabled until a reason is typed |
| M12-21 | Consequence stated before acting | ✅ | "Every attendance record on this date becomes HOLIDAY, so the day stops counting in attendance percentages. The change is audited." |
| M12-22 | Every mark on the date flips | ✅ | Both rows on `2026-08-17` → HOLIDAY, including one that was LEAVE — a day that turns out to be a holiday should not consume anyone's leave |
| M12-23 | Audited with the reason | ✅ | `{action: CONVERT_TO_HOLIDAY, converted: 2, reason: "শোক দিবস — দেরিতে ঘোষিত"}` |

## QR check-in

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M12-24 | Manual/scanner entry marks and confirms | ✅ | Card shows name, `QA-2026-0007 · QA Class 6 A · Roll 2`, status **Present**, with an initial where the photo would be |
| M12-25 | Graded against the shift start | ✅ | Scanned at 05:24 Dhaka → PRESENT, `method QR`, `check_in_time` recorded |
| M12-26 | Written to the **Dhaka** day | ✅ | Row dated `2026-08-19` from a UTC timestamp of `2026-08-18 23:24Z` |
| M12-27 | **Re-scan is idempotent, not an error** | ✅ | "Farhana Yasmin was already marked today", card badged "already marked", still **one** row |
| M12-28 | Unknown token | ✅ | **404** "Unknown or revoked QR code" |

## Staff attendance

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M12-29 | Union of teachers and staff | ✅ | 8 employees, `QA-T00x` teachers and `QA-S00x` staff, with designations |
| M12-30 | Marks persist | ✅ | "Saved 8 employee record(s)" |
| M12-31 | Sheet is free of phantom employees | ✅ **after F12** | It was not: **92 orphaned rows** for people who no longer existed |

## Reports

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M12-32 | Summary, register, daily sheet, late analysis render | ✅ | Four tabs; stat cards; per-section table |
| M12-33 | **Percentages follow the documented formula** | ✅ **after F28** | `presentEquivalent 3 ÷ workingDays 7 = 42.86%`, working days already net of the Friday and the converted holiday |
| M12-34 | Overall and per-section figures agree | ✅ **after F28** | Both 42.86% for a student in one section — they read 42.86% and 60% before |
| M12-35 | School-wide figure is a cohort | ✅ **after F28** | 7.14% for one section marked out of six; it read **100%** before |
| M12-36 | XLSX + PDF export | ✅ | `PK..` / `%PDF-`, correct content types |
| M12-37 | Export without `attendance.report` | ✅ blocked | Teacher gets **403** on the export while the read still returns 200 — the gate is on the export, not the data |

## What this pass found

Five findings, of which two were already sitting in the register:

- [**F28**](./FINDINGS.md) — the serious one. `percentage` meant two different
  denominators in a single report payload: 42.86% and 60% for the same student, and
  100% school-wide where the honest figure was 7.14%. Fixed by naming all three
  denominators in the calc engine, where this project's ground rules say arithmetic
  belongs — the helper had drifted precisely because it lived in the service instead.
- [**F12**](./FINDINGS.md) — **closed after being open all campaign.** Deferred twice as
  "an e2e cleanup problem"; it was live in the QA database as 92 orphaned
  `staff_attendances` rows showing as phantom LEAVE. M21 payroll reads that table.
- [**F27**](./FINDINGS.md) — the COMPLETED session had sections but no enrolments, so
  its read-only rule was unreachable. Fixed in the seed.
- [**F24**](./FINDINGS.md)/[**F25**](./FINDINGS.md) — ISO dates on screen and UTC day
  boundaries, both continuing from the M09 pass and both hit again here.

## Locked in

- `e2e/modules/12-attendance.spec.ts` — 5 specs: the Dhaka-day default, the off-day
  banner, session-scoped roster, the status cycle, and save → reload → still marked.
- `e2e/sweeps/dates.spec.ts` — 9 specs. A **runtime** guard for the F9/F18/F24 family
  across seven pages: it does not care how a string was produced, only that no ISO date
  is on screen. Carries two self-checks, because a sweep like this can pass while blind
  in two different ways — a blank page, or a broken pattern.
- `calc/percentage.util.spec.ts` — 9 golden cases pinning the three denominators.

## Deferred

- **Marking grid with 100+ students** (roadmap §9 performance check) — the QA sections
  hold two students each. Needs a fixture built for it; belongs with the
  no-virtualisation debt in `PROJECT_CONTEXT.md` §18 rather than a per-module pass.
- **The `BarcodeDetector` camera path** — needs a real camera and a printed card. The
  manual/scanner entry path that shares every line of logic below the decoder is
  covered above.
- **Auto-absent and absent-SMS crons** — unit-tested with fake timers; running them
  live needs a day to elapse past the cutoff. Worth doing in the M17 pass now that the
  SMS outbox (**F19**) makes a dispatch readable.
- **Period-mode marking** — no periods exist until M13 lands a routine. That is the
  next module in this pass.
