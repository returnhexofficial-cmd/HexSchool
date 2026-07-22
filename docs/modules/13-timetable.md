# Module 13 — Timetable / Class Routine · Completion Document

| | |
|---|---|
| **Module** | 13 — Timetable / Class Routine |
| **Completion date** | 2026-07-22 |
| **Actual effort** | 1 dev-day (est. was 4) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 13 |

## Summary of Implemented Features

- **Bell schedule per shift.** `period_slots` are defined against a **shift**, not a section, so the morning and day shifts each keep their own day shape. Full CRUD with the two structural rules from roadmap §7: a slot must sit inside its shift's working window, and no two live slots of a shift may overlap. Name and position uniqueness are checked in the service so the caller gets a readable 409 instead of a raw index violation.
- **Versioned section routines.** `timetables` holds at most one **DRAFT** being built and one **PUBLISHED** in force per (session, section); publishing promotes the draft and **ARCHIVEs** the version it replaces, so `effective_from` + `version` still answer "which routine was in force on 12 March". A new draft can be seeded from the published one (`copyFromPublished`), the normal way to make a mid-year change without taking the live routine down.
- **The conflict engine** (`calc/conflict.engine.ts`, dependency-free). The central decision: bookings are compared by their **wall-clock window**, never by `period_slot_id`. Slot ids are per-shift, so a part-time teacher's morning "Period 4" and day-shift "Period 1" can cover the same minutes — the cross-shift clash schools actually care about (roadmap §8), which an id comparison misses. Detects: teacher double-booking, room double-booking, duplicate cells inside one payload, and a per-teacher daily-period cap. Windows are **half-open**, so 08:00–08:45 and 08:45–09:30 do not collide.
- **Combined classes as a first-class marker, not an override.** `combined_with_section_id` records that two sections sit the same lesson; the engine treats the pair as one booking. Roadmap §8 explicitly wanted this instead of "override abuse", and the daily cap counts a combined lesson **once** — the teacher stands in one room.
- **Two rule tiers, deliberately different.** *Structural* rules can never be overridden — a BREAK slot cannot hold a lesson, a subject must be on the class's M06 curriculum map, a weekly holiday offers no day, a teacher cannot be in two rooms at once. Overriding those would produce a routine nobody can teach. The *assignment* rule (M08 says teacher X owns this section+subject) **is** overridable with `timetable.assign.override`, because schools legitimately run substitutes the assignment matrix has not caught up with.
- **All-or-nothing grid saves.** `PUT /timetables/:id/entries` replaces the draft's cells wholesale. Validation runs over the whole payload first, so a rejected save leaves the previous draft byte-identical. The 409 carries the offending cells in the envelope's `error.details.conflicts`, which is what lets the builder paint red cells rather than only showing a toast.
- **Publish re-runs the engine.** Another section may have gone live since the draft was last saved, so publishing validates again and refuses rather than putting a broken routine in force. An empty routine cannot be published.
- **Read views.** `GET /sections/:id/routine` (the printable grid), `GET /teachers/:id/routine` (a personal week drawn on the union of every bell schedule they appear in, plus free-period counts per day), and `GET /timetables/master` (whole-school coverage per section + a read-only teacher-load heat list).
- **Portal visibility rule.** Only PUBLISHED routines are returned. `?includeDraft=true` is honoured **only** for actors holding `timetable.manage`; everyone else silently gets the published view rather than a 403 — the flag is a builder convenience, not an access request.
- **`getCurrentPeriod(sectionId, datetime)`.** Resolves which period a section is in at a moment: holiday short-circuits everything, and a slot is returned even when its routine cell is empty (a school may mark attendance in a period with no lesson scheduled). This is the helper period-mode attendance calls.
- **Printable PDFs** (pdfkit): section routine, teacher personal routine, and a master load sheet. All landscape — a week of periods never fits portrait legibly. BREAK/ASSEMBLY rows are shaded and span the week rather than printing an empty cell per day, which would suggest a lesson could go there.

### Debts closed in other modules

- **M08 `TIMETABLE_CONFLICT_CHECKER` is no longer a no-op.** `RoutineConflictChecker` is now bound to the token: reassigning a section-subject walks the published cells that reassignment would move and refuses if the incoming teacher is already booked at those minutes. The question is narrower than the builder's — the cells already exist and name a teacher; handing them to somebody else is only safe if that person is free in every one of them.
- **M08 teacher workload finalized.** `GET /teacher-assignments/workload` now returns `periodsPerWeek` alongside `assignments`. The row set is the **union** of teachers with duties and teachers with routine periods, so a substitute carrying real load is not hidden. A teacher with duties but no routine yet reports 0 — exactly the gap a scheduler wants to see.
- **M12 period mode is live.** `student_attendances.period_id` was a bare UUID column because `period_slots` did not exist; the FK lands in this migration. The marking sheet and `POST /attendance/students` now resolve a period when `attendance.mode = 'period'`: an explicit period must be a CLASS slot of the section's own shift, and omitting it means "the period running now".

## Database Changes

Migration `20260722104500_timetable_class_routine`:

**Enums** — `period_slot_type_enum` (CLASS/BREAK/ASSEMBLY), `weekday_enum` (SAT…FRI, Saturday-first because the BD school week runs SAT→THU), `timetable_status_enum` (DRAFT/PUBLISHED/ARCHIVED).

**Tables**
- `period_slots` — `shift_id` FK, `name`, `start_time`/`end_time` `TIME(0)`, `type`, `display_order`, audit + soft delete. Soft-deleted so a retired slot never orphans the routine history that referenced it.
- `timetables` — `session_id` FK (CASCADE), `section_id` FK (CASCADE), `status`, `effective_from`, `version`, `published_at`, `published_by`, `notes`, audit + soft delete.
- `timetable_entries` — `timetable_id` FK (CASCADE), `day`, `period_slot_id` FK, `subject_id` FK, `teacher_id` FK, `room_no`, `combined_with_section_id` FK (SET NULL), audit. **No soft delete** — the bulk endpoint replaces cells outright and the audit log keeps the diff (the M06 `class_subjects` pattern).

**Hand-written constraints** (Prisma cannot express them)
- `uq_period_slots_order` — UNIQUE `(shift_id, display_order)` `WHERE deleted_at IS NULL`.
- `uq_period_slots_name` — UNIQUE `(shift_id, lower(name))` `WHERE deleted_at IS NULL`.
- `chk_period_slots_time_order` — `start_time < end_time`.
- `uq_timetables_live_version` — UNIQUE `(session_id, section_id, status)` `WHERE deleted_at IS NULL AND status <> 'ARCHIVED'`. At most one DRAFT and one PUBLISHED; archived versions are unlimited (they *are* the history). This is why publish **archives the superseded row first** — the index permits only one non-archived row per state.
- `uq_timetable_entries_cell` — plain UNIQUE `(timetable_id, day, period_slot_id)`.

**M12 FK added** — `fk_student_attendances_period` on `student_attendances.period_id → period_slots(id)` `ON DELETE RESTRICT`. This is the change that turns period-mode marking on.

**Deliberately not a CHECK** — "a combined class must point at a *different* section". The owning section lives one join away on `timetables` and Postgres forbids subqueries in CHECK, so the entry service enforces it (and the conflict engine relies on that).

## API Endpoints Added

```
GET    /api/v1/period-slots?shiftId=          GET /api/v1/period-slots/:id
POST   /api/v1/period-slots                   PUT/DELETE /api/v1/period-slots/:id

GET    /api/v1/timetables?sessionId=&classId=&sectionId=&status=
POST   /api/v1/timetables                     {sectionId, sessionId?, effectiveFrom?, copyFromPublished?}
GET    /api/v1/timetables/:id                 (grid axes + saved cells + live conflicts)
PUT    /api/v1/timetables/:id/entries         {entries[], override?}   (full replacement)
POST   /api/v1/timetables/:id/publish         {effectiveFrom?, notes?}
DELETE /api/v1/timetables/:id                 (drafts only)
GET    /api/v1/timetables/:id/pdf
GET    /api/v1/timetables/conflicts?sessionId=&teacherId=&day=&periodSlotId=&sectionId=&roomNo=
GET    /api/v1/timetables/master?sessionId=&shiftId=&classId=   + /master/export

GET    /api/v1/sections/:id/routine?sessionId=&includeDraft=    + /routine/pdf
GET    /api/v1/sections/:id/current-period?date=&at=
GET    /api/v1/teachers/:id/routine?sessionId=&includeDraft=    + /routine/pdf
```

**Route-ordering note.** `master` and `conflicts` are declared **before** `:id` in `TimetablesController` — Nest matches in declaration order and a fixed segment would otherwise hit the `ParseUUIDPipe` and 400. `current-period` is mounted on the *section* (`/sections/:id/current-period`) rather than under `/timetables` for the same reason; that collision was caught by the e2e suite.

## Frontend Pages Created

- `/admin/timetables` — routines for the selected session, filterable by class and status, with the new-draft dialog (class → section → "start from the published routine").
- `/admin/timetables/[id]` — **the routine builder.** Days × periods grid, cell editor popover (subject → teacher list with the assigned teacher ★-marked → room → combined-with), live conflict probe inside the editor, red cells with a tooltip listing every reason, per-day copy/clear, sticky save bar with filled/capacity counts, and a publish dialog that surfaces the free-period count before committing.
- `/admin/timetables/master` — section coverage bars + the read-only teacher-load heat table (banded by load relative to the busiest teacher).
- `/admin/timetables/periods` — the bell-schedule editor, shift-first; new periods pre-fill their start from the previous period's end.
- Teacher detail gains a **Routine** tab (personal week, free-period counts, print button).

## Components Created (new shared/reusable only)

None — the module is built entirely on the existing `PageHeader` / `FormDialog` / `ConfirmDialog` / `EmptyState` / `Can` set. The routine grid is deliberately page-local: the builder's grid and the teacher viewer's grid differ in what a cell contains and in whether cells are editable, and a shared abstraction over the two would have been thinner than the props needed to configure it.

## Business Rules Implemented

- Only PUBLISHED routines are portal-visible; `includeDraft` requires `timetable.manage`.
- A cell's subject must be on the section's class-subject map for the session (group-scoped rows plus group-agnostic ones).
- A cell's teacher should hold that section+subject (M08); otherwise `override=true` + `timetable.assign.override`, and the response reports each `unassignedOverride`.
- BREAK/ASSEMBLY slots cannot hold entries.
- Weekly holidays (derived from `general.weekly_holidays`, **not** a separate setting) are excluded from the day axis.
- One DRAFT + one PUBLISHED per section per session; publishing archives the superseded version.
- Drafts can be deleted; PUBLISHED/ARCHIVED versions are the section's history and are refused with a 409.
- COMPLETED/ARCHIVED sessions are read-only (the M05 rule, as enforced by M12).
- `effective_from` must fall inside the session.
- A period whose times move is refused while attendance was marked in it — retiring it and adding a new slot keeps that history honest. Renaming stays allowed.
- Period delete is guarded by both routine cells and attendance rows.

## Known Limitations

- **No substitution feature.** A teacher on approved leave does not alter the routine; the roadmap defers substitutions to the Phase 3 backlog. The teacher routine's `freeByDay` counts are the raw material a future substitution search would use.
- **A section with no shift is only supported when the school defines exactly one bell schedule.** With two or more, the builder refuses and asks for the section to be given a shift — guessing which schedule applies would silently mis-time attendance.
- **Room conflicts are string-matched** on `room_no` (trimmed, case-insensitive). There is no room master table; M24 (Inventory/Facilities) is where one would live.
- **The master grid returns per-section cells but the UI renders coverage, not the full cross-section matrix.** For a large school the complete grid is a very wide table; the roadmap's "heat view of teacher load" is what shipped, and the per-section grid is one click away.
- **Exam routines (M14) reuse `period_slots` but no exam-specific slot type exists yet** — M14 will decide whether exam sittings are period-shaped or their own timing.
- **No drag-and-drop** in the builder; cells are edited via a popover. Drag would need conflict feedback mid-gesture, which the current probe-per-open design does not provide.

## Future Improvements

- Auto-generate a draft routine from the assignment matrix + a periods-per-subject-per-week target (the constraint-solver version of this module).
- Substitution log: mark a cell as covered by another teacher for a date range without versioning the whole routine.
- Room master + capacity, so the room conflict check can also flag "35 students in a 20-seat lab".
- Bulk "apply this routine to every section of the class" for schools where sections run identical timetables.
- Cache the conflict competition set per session — the engine currently reads all published cells of the session on every save.

## Breaking Changes

- **`TimetableConflictCheck` (M08 interface) gained a required `schoolId`.** The only caller is `TeacherAssignmentsService`, updated in this module. Any future implementation of the token must accept it.
- **`WorkloadRow` (M08) gained `periodsPerWeek`.** Additive to the JSON, and the frontend workload table ignores unknown fields — no consumer breaks, but the sort order changed to periods-first.
- **`AttendanceSheet` (M12) gained `mode` and `period`.** Additive.
- **`POST /attendance/students` now rejects a `periodId` while `attendance.mode` is `daily`** (previously the value was accepted and stored). Silently dropping it would file marks under the daily identity key and let a duplicate slip past the partial unique index. No caller sent one — the frontend never populated it.
- **`src/modules/attendance/calc/clock.util.ts` moved to `src/common/utils/clock.util.ts`** — it is now a shared concern (both attendance and timetable need Dhaka minutes-of-day arithmetic). All six importers were updated; no re-export shim was left.

## Migration Steps

1. `npx prisma migrate deploy` — applies `20260722104500_timetable_class_routine` (3 tables, 3 enums, the `student_attendances.period_id` FK, 5 hand-written indexes/checks).
2. `npx prisma generate`.
3. Restart the API so the RBAC seeder syncs the 6 new `timetable.*` permission codes and extends the Admin/Principal/Vice-Principal/Teacher core sets.
4. **Define a bell schedule before building routines** — `/admin/timetables/periods`, one set per shift. Routines cannot be created for a section whose shift has no CLASS periods.
5. Period-mode attendance stays **off** until `attendance.mode` is set to `period`; the default remains `daily` and existing marks are untouched.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Build a bell schedule, overlap + out-of-shift rejected | ✅ | e2e; 409 / 400 with the offending sibling named |
| Draft → save grid → publish → v1 PUBLISHED | ✅ | e2e |
| Second draft for the same section refused | ✅ | e2e, 409 (partial unique index) |
| Lesson in a BREAK slot refused | ✅ | e2e, 400 |
| Teacher already booked → whole payload refused, draft unchanged | ✅ | e2e; conflicts present in `error.details.conflicts` |
| Same slot, different teacher accepted | ✅ | e2e |
| Empty routine cannot be published | ✅ | e2e, 400 |
| Published routine visible to a plain viewer | ✅ | e2e |
| Draft hidden from a viewer, shown to a builder | ✅ | e2e (both directions) |
| Conflicts probe: busy vs free slot | ✅ | e2e |
| Master grid + teacher load | ✅ | e2e |
| Section routine PDF renders | ✅ | e2e, content-type + non-trivial body |
| `current-period` resolves the slot + cell; null outside the schedule | ✅ | e2e (weekday computed, not hard-coded) |
| Workload reports periods/week | ✅ | e2e |
| Reassignment blocked by the published routine | ✅ | e2e — the M08 hook, live |
| Period delete guarded by routine cells | ✅ | e2e, 409 |
| Published routine cannot be deleted | ✅ | e2e, 409 |
| Cross-shift clash detected by wall clock | ✅ | unit (conflict engine) |
| Combined class excuses a shared teacher, one-sided marker enough | ✅ | unit |
| Daily cap counts a combined lesson once | ✅ | unit |
| Period-mode marking files under the running period | ✅ | unit (attendance service) |
| `periodId` refused in daily mode | ✅ | unit |
| In-browser click-through of the builder grid | ⬜ | **Pending** — schema-tested only; see TODOs |

## Remaining TODOs

- [ ] In-browser click-through: builder grid interactions (cell popover, copy/clear day, red-cell tooltips), publish dialog, master heat table, and the teacher Routine tab. Everything below the API is covered by tests; the DOM interactions are not.
- [ ] Verify the routine PDF against a real Bangla subject/teacher name — pdfkit's default font has the same Bangla limitation flagged in M09's ID cards.
- [ ] The `school.e2e-spec` audit-diff race is still flaky when the full e2e suite runs serially (passes in isolation). Pre-existing, unrelated to M13, still on the housekeeping list.
- [ ] Decide with M14 whether exam sittings reuse `period_slots` or get their own timing table.

## Links to Related Modules

- **Depends on:** Module 06 (sections, subjects, shifts, class-subject map), Module 08 (teacher assignments), Module 11 (sections carry the roster), Module 05 (session status + `general.weekly_holidays`).
- **Unlocks / hooks completed for:**
  - **Module 08** — the `TIMETABLE_CONFLICT_CHECKER` provider is now the real `RoutineConflictChecker`, and the workload endpoint's periods/week stub is finalized.
  - **Module 12** — `student_attendances.period_id` has its FK; period-mode marking is live via `RoutineService.getCurrentPeriod`.
  - **Module 14** — `period_slots` are the foundation exam routines reuse.
  - **Module 18** — `TimetableModule` exports `RoutineService`, `PeriodSlotsRepository` and `TimetableEntriesRepository` for the portal/dashboard routine views.
- **Module graph note:** the real conflict checker lives in `src/modules/timetable` but is **bound inside `TeacherModule`** over a re-provisioned `TimetableEntriesRepository`. TimetableModule imports TeacherModule for `TeachersRepository`, so the reverse import would cycle — this is the M07 stateless-re-provision convention applied to a DI hook.
- `PROJECT_CONTEXT.md` sections updated: §5 (shared utilities — `clock.util` promoted to `common/utils`), §11 (global business rules — routine visibility + versioning), §18 (technical debt — substitutions deferred, room master deferred).
