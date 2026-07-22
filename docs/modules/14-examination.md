# Module 14 — Examination Management · Completion Document

| | |
|---|---|
| **Module** | 14 — Examination Management |
| **Completion date** | 2026-07-22 |
| **Verification completed** | 2026-07-22 (migration applied + e2e written and run — see [Post-completion verification](#post-completion-verification)) |
| **Actual effort** | 1 dev-day (est. was 5) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 14 |

## Summary of Implemented Features

- **Exam types** — the small master list every exam hangs off (`name`, optional `weight` as a share of a combined result). Names unique per school, case-insensitively; delete blocked while exams reference the type.
- **Exam aggregate + status machine** — an exam binds a session, a type, a date window, a grading system and a set of classes. The lifecycle is an explicit straight line `DRAFT → SCHEDULED → ONGOING → MARK_ENTRY → PROCESSING → PUBLISHED → ARCHIVED`, with one-step-back moves to undo a mis-click and **no rewind past PUBLISHED**. Three guards sit on the pure transition table:
  - `→ SCHEDULED` requires ≥1 class, ≥1 paper, and **every paper scheduled**;
  - `→ MARK_ENTRY` requires the exam's `end_date` to have passed, unless `override=true` **and** the caller holds `exam.status`;
  - `→ PUBLISHED` asks the Module 15 result gate, and **freezes the grade scale** into `exams.grading_snapshot`.
- **Mark distribution per paper** — a paper is either flat (`full_marks`) or split into CQ/MCQ/practical/CA, and a split must sum to `full_marks` exactly (DB CHECK + engine + client-side mirror). The roadmap's "per-component pass flags" are modelled as nullable per-component **thresholds** (`cq_pass_marks`, …): non-null means that component must be cleared on its own, which is how BD boards treat a practical and what a bare boolean could not express.
- **Exam routine + clash engine** — sittings carry their own wall-clock `start_time` + `duration_min` (see the design decision below). A dependency-free engine detects room double-booking, a class sitting two papers at overlapping times, the "two papers in one day" policy, sittings outside the exam window, and duplicate papers in one payload — **comparing wall-clock minutes, never slot ids**, and including the sittings of *other live exams of the session* because rooms are a school-wide resource.
- **Two override tiers** (the M13 split, re-applied): *structural* clashes — a class in two halls at once, a room double-booked, a date outside the exam — are **never** waivable. The *same-day policy* is, behind `exam.schedule.override`, because schools routinely break their own policy in the last week of an exam.
- **Postponement tool** — `POST /exams/:id/routine/shift-day` moves every sitting of one date to another in one audited operation, re-running the clash engine against the projected routine and optionally extending the exam window. Strikes and cyclones postpone exam days often enough in Bangladesh that doing it as 30 manual edits is a real source of mistakes.
- **Curriculum sync** (roadmap §8) — `GET/POST /exams/:id/subjects-sync` diffs the exam's papers against the attached classes' current `class_subjects`: subjects added to a class have no paper, subjects removed still have one. Adding is opt-out, **removing is opt-in** (it destroys a paper).
- **Seat plans** — two strategies: `SERPENTINE` keeps each class together in roll order and **reverses every other room** so adjacent rooms don't put consecutive rolls side by side; `INTERLEAVE` round-robins the attached classes so no two neighbours sit the same paper. Candidate resolution is the interesting part: only ACTIVE enrollments of classes sitting a paper that day, and for an **optional (4th) subject only the students who chose it**.
- **Append a late enrollee** — a separate action rather than a regeneration, because regenerating moves every other student and invalidates admit cards already printed.
- **Admit cards** — one A4 page per candidate: identity + photo, the full sitting schedule of their class (minus optional papers they didn't take), their seat where a plan exists, instructions from settings, and three signature blocks. A missing photo never blocks issuance — the card prints with a placeholder and is reported as incomplete (the M09 ID-card rule).
- **PDFs** — exam routine (one block per date, holidays flagged) and seat plans (summary + one page per room with an invigilator sign-off line).

## Database Changes

Migration `prisma/migrations/20260722160000_examination_management/migration.sql`.

**Enums**
- `exam_status_enum` — `DRAFT|SCHEDULED|ONGOING|MARK_ENTRY|PROCESSING|PUBLISHED|ARCHIVED`
- `seat_plan_strategy_enum` — `SERPENTINE|INTERLEAVE`

**Tables**
- `exam_types` — `name`, `weight NUMERIC(5,2) NULL`, audit + soft delete.
- `exams` — `session_id`, `exam_type_id`, `name`, `start_date`, `end_date`, `grading_system_id`, `status`, `result_publish_at`, **`grading_snapshot JSONB`**, `instructions`, audit + soft delete.
- `exam_classes` — join table `(exam_id, class_id)`, no soft delete.
- `exam_subjects` — `(exam_id, class_id, subject_id)` unique; `full_marks`, `pass_marks`, the four component columns and their four pass thresholds; `exam_date`, `start_time TIME(0)`, `duration_min`, `room`.
- `seat_plans` — `(exam_id, date, room)` unique, `capacity`, `strategy`. **Hard-deleted** (generated artifact, replaced per date wholesale — the M13 `timetable_entries` precedent).
- `seat_plan_entries` — `seat_plan_id`, **`enrollment_id`** (not `student_id`), `seat_no`; unique per `(plan, seat_no)` and `(plan, enrollment_id)`.

**Hand-written constraints** (Prisma cannot express them)
- `uq_exam_types_name` / `uq_exams_name` — partial unique on `lower(name)` where `deleted_at IS NULL`.
- `chk_exam_types_weight` — 0–100.
- `chk_exams_date_order` — `start_date <= end_date`.
- `chk_exam_subjects_marks` — `full_marks > 0`, `0 <= pass_marks <= full_marks`.
- `chk_exam_subjects_components` — components all NULL, **or** they sum to `full_marks`.
- `chk_exam_subjects_component_pass` — a component threshold requires its component and cannot exceed it.
- `chk_exam_subjects_duration` — 10–360 minutes.
- `chk_exam_subjects_schedule` — date + time + duration together, or none.
- `chk_seat_plans_capacity`, `chk_seat_plan_entries_seat_no` — positive.

**Also touched:** `EnrollmentsRepository.findClassRoster()` added (M11) — an exam paper is set per *class*, so its candidates are the class roster across every section, which no existing query returned.

## API Endpoints Added

```
GET/POST/PUT/DELETE /api/v1/exam-types
GET/POST            /api/v1/exams
GET/PUT/DELETE      /api/v1/exams/:id
PUT                 /api/v1/exams/:id/classes
PUT                 /api/v1/exams/:id/status

GET/PUT             /api/v1/exams/:id/subjects
PUT/DELETE          /api/v1/exams/:id/subjects/:subjectId
GET/POST            /api/v1/exams/:id/subjects-sync

GET                 /api/v1/exams/:id/routine
GET                 /api/v1/exams/:id/routine/pdf
POST                /api/v1/exams/:id/routine/shift-day

GET/DELETE          /api/v1/exams/:id/seat-plans
GET                 /api/v1/exams/:id/seat-plans/candidates
GET                 /api/v1/exams/:id/seat-plans/pdf
POST                /api/v1/exams/:id/seat-plans/generate
POST                /api/v1/exams/:id/seat-plans/append

POST                /api/v1/exams/:id/admit-cards
```

`POST /admit-cards` streams the PDF and reports counts in `X-Admit-Cards-Issued`, `-Incomplete`, `-Blocked` headers.

## Frontend Pages Created

- `/admin/exams` — list for the selected session (type/status/search filters) + new-exam dialog that attaches classes and seeds papers.
- `/admin/exams/types` — exam-type CRUD with the weight field.
- `/admin/exams/[id]` — overview stat row + status dialog, with four tabs:
  - **Papers & marks** — the distribution grid (client-side validation mirroring the engine, red rows, sticky save bar, save-with-override, and the curriculum-sync banner);
  - **Routine** — sittings grouped by date, holiday badges, live clash panel, per-day postpone dialog;
  - **Seat plan** — date picker, candidate count, room boxes with seat chips, generate/regenerate/delete, PDF;
  - **Admit cards** — class or section batch, dues-override toggle, result counts.
- Sidebar entry "Examinations" behind `exam.view`.

## Components Created (new shared/reusable only)

None — the module is built entirely on the existing shared set (`PageHeader`, `StatCard`, `Can`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `LoadingBlock`, `Spinner`) plus vendored shadcn primitives.

## Business Rules Implemented

- Exam dates must lie inside the session; sitting dates inside the exam window. Narrowing the window is refused while a sitting would be stranded outside it.
- COMPLETED/ARCHIVED sessions are read-only for exams (the M05 rule, as enforced by M12/M13).
- Exam names are unique per (school, session), case-insensitively.
- Classes and papers **freeze** once the exam reaches MARK_ENTRY; papers freeze hard at PUBLISHED/ARCHIVED.
- Only DRAFT exams can be deleted; anything further along is archived.
- Pass marks ≤ full marks; component splits must sum to full marks; a component pass threshold requires its component.
- A sitting is all-or-nothing (date + time + duration).
- Only ACTIVE enrollments of attached classes are candidates; optional-subject papers are sat only by the students who chose that subject.
- Seat-plan generation refuses duplicate room names and insufficient total capacity before writing anything.
- The grading system is frozen at PUBLISH — `grading_snapshot` is what Module 15 reads, so editing a grade band later can never restate a published result.

## Known Limitations

- **`EXAM_RESULT_GATE` is a no-op** until Module 15. Publication is currently allowed (and logged) rather than refused — a hard refusal today would make the status machine untestable and the module unusable. M15 binds the real provider and the roadmap's "can't PUBLISH before processing complete" becomes true without a caller change.
- **`EXAM_DUES_GATE` is a no-op** until Module 16, so `exam.admit_card_block_dues` has nothing to block on. The policy code, the permission and the UI toggle are all live and tested.
- The "detaching a class / removing a paper is blocked once marks exist" guard is a slot, not a check — there is no marks table until M15.
- Exam-type `weight` is validated 0–100 individually; that a *combined set* sums to 100 is deliberately left to M15, which is the only module that knows which types a given report card merges.
- Seat plans have no visual room-layout editor (rows × columns); the generator takes a flat capacity per room.
- Admit cards are A4 one-per-page; a 2-up or 4-up print layout was not requested and is not implemented.
- The exam wizard is a dialog + tabs rather than a linear multi-step wizard; the roadmap's step order is preserved by the tab order and the status guards.

## Future Improvements

- Room master data (M24 inventory or a small `rooms` table) so seat-plan capacity is not retyped per generation.
- Invigilator assignment per room, drawing on the M08 teacher roster and the M13 routine to avoid clashes.
- A seat-layout grid (rows × columns) for schools that seat by physical bench.
- Attendance-at-the-exam (present/absent per sitting) — currently M12 covers class attendance only.
- Notifications on schedule changes (the postponement tool is an obvious SMS trigger once M17 lands).

## Breaking Changes

None. Two additive changes other modules should know about:
- `EnrollmentsRepository` gained `findClassRoster(classId, sessionId, schoolId)`.
- Three permission codes use kebab-case segments (`exam.seat-plan.manage`, `exam.admit-card`, `exam.admit-card.dues-override`) to satisfy the registry's `<entity>.<action>` format test — note the hyphens when granting them.

## Migration Steps

1. `npm run migrate:deploy` (applies `20260722160000_examination_management`).
2. `npm run seed` — syncs the 11 new permission codes into `permissions` and extends the Principal / Vice Principal / Teacher system-role baselines. The seeder is idempotent and never revokes admin-added extras.
3. New `exam.*` settings appear in Settings → Exam with defaults; no action required unless the school wants to change them.
4. Create at least one exam type before the first exam (`/admin/exams/types`).
5. A default grading system must exist (M04 seeds "NCTB Standard") — exam creation refuses without one.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Backend unit suite | ✅ 589 passed (60 suites) | Was 444 before this module — **145 new** (144 + the same-day clash regression test added during verification) |
| Backend typecheck (`tsc --noEmit`) | ✅ clean | |
| Backend lint (`eslint src/modules/exam`) | ✅ 0 errors | Only after re-saving the module with LF endings — see [Note on line endings](#note-on-line-endings). `enrollment` and `rbac` still carry pre-existing prettier errors |
| Frontend test suite (`vitest run`) | ✅ 171 passed (22 files) | Was 141 — **30 new** |
| Frontend typecheck | ✅ clean | |
| Frontend lint | ✅ 0 errors | 21 warnings, all pre-existing RHF `watch()` in older pages; the exam files add none |
| Frontend production build | ✅ compiled | `/admin/exams`, `/admin/exams/[id]`, `/admin/exams/types` all emitted |
| **e2e suite** | ✅ **225 passed (14 suites)** | Includes the new `test/exam.e2e-spec.ts` — 45 cases. See below |
| Migration applied against a live DB | ✅ **applied** | Full 14-migration chain replayed onto an empty Postgres 16, then migration 14 applied to the Neon dev database |

## Post-completion verification

The two items the completion run could not do — apply the migration to a real
database and run the e2e suite — were completed on 2026-07-22 against Docker
Postgres 16 and the Neon dev database.

### Migration

| Check | Result |
|---|---|
| Full 14-migration chain replayed onto an **empty** Postgres 16 | ✅ applied in order, no errors |
| `prisma migrate diff` (migrated DB → `schema.prisma`) | ✅ **No difference detected** — the hand-written SQL matches the Prisma schema exactly |
| Objects created | ✅ 6 tables, 2 enums, 9 CHECK constraints, 6 partial unique indexes |
| Migration 14 applied to the **Neon** dev DB (`migrate deploy`) | ✅ applied; `migrate status` up to date, drift check clean |
| Seeder run on both databases | ✅ 122 permission codes; the 11 `exam.*` codes present, spread Super Admin/Principal/Admin 11, Vice Principal 7, Teacher 2 |

Replaying the *whole* chain onto an empty database rather than only applying
migration 14 to an existing one is the stronger check: it proves the migration
composes with its thirteen predecessors from scratch, which is what a fresh
deployment actually does.

### `test/exam.e2e-spec.ts` — 45 cases

Written for this module (it did not exist). Covers, in the order a school
would actually use the module: permission boundaries · exam-type CRUD with
case-insensitive duplicate refusal and the in-use delete guard · exam creation
seeding a paper per curriculum subject · duplicate-name and
outside-the-session refusals · `SCHEDULED` refused while papers are unscheduled
· whole-payload distribution validation (nothing saved on a bad row) · **the
two override tiers** — `CLASS_OVERLAP` and `ROOM` refused even *with*
`override=true`, `CLASS_SAME_DAY` waivable but only for a caller holding
`exam.schedule.override` (a scheduler role without it gets 403) · the routine
read view and its PDF · **candidate resolution**, including the optional-subject
rule (8 candidates on a shared day, 2 on the 4th-subject day) · the
postponement tool, refused past the exam window without `extendExamWindow` ·
seat-plan generation with capacity and duplicate-room refusals · **append a
late enrollee and assert every existing seat is byte-for-byte unchanged** ·
admit cards by class, single reissue, and the "exactly one selector" rule ·
curriculum sync (add is opt-out, remove opt-in) · the status walk to PUBLISHED
with `grading_snapshot` asserted non-empty, no rewind past PUBLISHED, papers
frozen, and a non-DRAFT delete refused.

Four cases drive raw SQL past the service on purpose, because the migration's
hand-written CHECK constraints are the last line of defence if a future caller
skips the engine, and they can only be proven against a real database:
`chk_exam_subjects_components`, `chk_exam_subjects_component_pass`,
`chk_exams_date_order` and `chk_seat_plans_capacity` all reject as intended.

### Bug found by the e2e suite — same-day clash silently dropped

`detectClashes` carried a de-duplication guard on the `CLASS_SAME_DAY` branch:

```ts
(!bIsCandidate || (a.examSubjectId ?? '') <= (b.examSubjectId ?? ''))
```

The candidate loop already visits each unordered pair exactly once (`j > i`,
with `existing` only ever on the right-hand side), so the guard was redundant —
and because it compared ids, it **dropped the clash entirely whenever the two
papers' ids happened to sort the other way**. Real ids are UUIDs, so the
same-day policy was silently not enforced on roughly half of all saves.

It survived the unit suite because every case there lists `es-1` before `es-2`,
which always satisfies `<=`. Reproduced deterministically by swapping the ids,
then fixed by deleting the guard (and the now-unused `bIsCandidate`
parameter); a regression test asserting the clash fires *regardless of id
order* was added to `exam-clash.engine.spec.ts`. Backend units went 588 → 589.

This is the concrete argument for the e2e suite having been a gap rather than
a formality: the behaviour was wrong in a way no amount of the existing
unit coverage could see.

### Also fixed: `health.e2e-spec.ts` was order-dependent

The health e2e asserted `memory_heap`/`memory_rss` were `up`. Those probes
measure whatever process runs the check — under `test:e2e` that is the single
Jest worker carrying the accumulated heap of every preceding suite, not a real
API process. Adding a 14th suite pushed it past the 512 MB threshold and the
assertion went red on something that says nothing about the application. It now
asserts the *dependency* probes (`database`, `redis`, and `disk` off Windows)
strictly and only checks the memory probes are present, tolerating Terminus's
503. Any future module's e2e suite would have tripped the old form.

### Note on line endings

The exam module's working-tree files were saved with CRLF while the repo's
prettier config expects LF, so `eslint src/modules/exam` reported ~7,680
`Delete ␍` errors (against 0 for `timetable` and `attendance`). They were
re-saved with LF, which makes the module lint clean. `git diff` renders **no
textual change** for the 32 affected files — but committing them does rewrite
the stored blobs, since `core.autocrlf=true` with no `.gitattributes` leaves
the repo's stored line endings inconsistent between modules. Adding a
`.gitattributes` with `* text=auto eol=lf` would settle it repo-wide; that is
a repo-level decision and was left to the owner.

## Remaining TODOs

- [x] ~~Run the e2e suite and apply the migration against a live Postgres.~~ Done 2026-07-22 — 45-case `exam.e2e-spec.ts` written and green, full chain + migration 14 applied to Docker Postgres 16 and to Neon, zero schema drift.
- [x] ~~Confirm the seeded permission codes land correctly on an existing deployment.~~ Verified on both databases: 11 `exam.*` codes, kebab-case segments intact, role spread as designed.
- [ ] In-browser click-throughs: the distribution grid with a real class-worth of papers, the seat-plan room boxes at 200+ candidates, and an admit-card PDF printed on A4. *(Still the only untested-by-machine surface.)*
- [ ] Module 15 must bind `EXAM_RESULT_GATE`; Module 16 must bind `EXAM_DUES_GATE`.
- [ ] Repo-level: decide on a `.gitattributes` (`* text=auto eol=lf`) so the CRLF/LF split stops producing phantom lint failures — `enrollment` (307) and `rbac` (566) still carry prettier errors.

## Links to Related Modules

- **Depends on:** Module 04 (grading systems + settings), Module 05 (session window, `CalendarService.isHoliday`), Module 06 (`class_subjects` curriculum, classes, subjects), Module 11 (canonical roster — extended with `findClassRoster`), Module 13 (the conflict-engine and two-tier-override patterns this module re-applies; `period_slots` deliberately **not** reused — see below).
- **Unlocks / hooks completed for:**
  - **Module 15** — consumes `ExamsService`, `ExamsRepository`, `ExamSubjectsRepository`, `ExamRoutineService` (all exported); must bind `EXAM_RESULT_GATE` and read `exams.grading_snapshot` rather than the live grading system; must extend the delete guards on `exam_classes`/`exam_subjects` once marks exist.
  - **Module 16** — must bind `EXAM_DUES_GATE`; `exam.admit_card_block_dues` then starts biting with no admit-card code change.
  - **Module 17** — the postponement tool and status changes are natural SMS triggers.
  - **Module 18** — `ExamRoutineService` renders the exam routine in the student/parent/teacher portals.
- **`PROJECT_CONTEXT.md` sections updated:** §8 (entity spine), §16 (technical decisions), §18 (technical debt).

### Design decision: exam sittings do NOT reuse M13 `period_slots`

`PROJECT_PROGRESS.md` flagged this as the open question to settle first. **Decision: exam sittings get their own wall-clock `start_time` + `duration_min` on `exam_subjects`.**

Rationale: a paper runs 2–3 hours and does not fit inside a 40-minute bell period, so reusing slots would mean either inventing exam-only slots per shift (duplicating the bell schedule for every exam) or spanning N slots (making "which slot is this sitting in" ambiguous for the conflict engine). The roadmap's own §3 design already gives `exam_subjects` `start_time`/`duration_min` columns, which settles it.

What is preserved from M13 is the *technique*, not the table: the clash engine compares **wall-clock minutes**, which is what lets a room clash be detected across two exams whose classes run in different shifts — exactly the reasoning that made M13 compare minutes rather than slot ids.
