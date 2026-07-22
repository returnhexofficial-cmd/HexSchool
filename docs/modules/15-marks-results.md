# Module 15 — Marks & Result Processing · Completion Document

| | |
|---|---|
| **Module** | 15 — Marks & Result Processing |
| **Completion date** | 2026-07-22 |
| **Actual effort** | 1 dev-day (est. was 8) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 15 |

## Summary of Implemented Features

- **Mark entry with a four-eyes lifecycle** — `DRAFT → SUBMITTED → VERIFIED → LOCKED`, each step its own permission because they are meant to be different people. A paper moves as a unit (submitting half a section leaves a verifier signing off on an unfinished sheet), a save is all-or-nothing with every bad cell returned at once, and `LOCKED` leaves the flow entirely.
- **The bound the database cannot see.** A component's ceiling is its allocation on `exam_subjects`, one join from the mark row, so `mark-entry.engine.ts` is the enforcement point — and the frontend mirrors it so a cell turns red before a request is sent.
- **Five dependency-free calculation engines**, golden-tested against hand-computed NCTB values: the frozen grade scale (`grading-snapshot.ts`), subject grading with component thresholds and grace (`subject-result.engine.ts`), NCTB GPA with the 4th-subject bonus (`gpa.engine.ts`), competition ranking (`merit.engine.ts`) and the weighted merge (`combined-result.engine.ts`).
- **Processing runs** — idempotent by construction (everything is an upsert on `uq_results_exam_candidate`), durable progress in `result_runs` rather than only in BullMQ, an issue list the UI renders ("no marks for Maths"), and merit assigned in a **second pass** because positions are relative.
- **Publication as its own switch** — versioned `result_publications` with at most one active version (partial unique index). Unpublishing revokes; a re-issue after a correction writes version N+1 with a changelog note.
- **The re-check flow** — changing a `LOCKED` mark demands a reason, writes an unerasable `mark_corrections` row *before* the mark moves, and re-processes that candidate (re-ranking the whole exam, since one new GPA moves everyone below it).
- **Report cards, tabulation sheets and transcripts** (pdfkit / exceljs), plus **result analytics**: pass rate by class and section, a GPA histogram bucketed by the school's own grade letters, subject difficulty, and a year-over-year comparison keyed on the exam **type**.
- **Combined results** — "Annual = 30 % Half-Yearly + 70 % Annual", with the weight set frozen onto every generated row.
- **Public result search** — `@Public`, gated on the active publication's `website` channel, with withheld results and non-existent students returning the *same* 404.

## Database Changes

Migration `prisma/migrations/20260722213000_marks_result_processing/migration.sql`.

**Enums**
- `mark_status_enum` — `DRAFT|SUBMITTED|VERIFIED|LOCKED`
- `result_status_enum` — `PASSED|FAILED|INCOMPLETE|WITHHELD`
- `result_run_status_enum` — `QUEUED|RUNNING|COMPLETED|FAILED`

**Tables**
- `marks` — keyed on **`enrollment_id`**, `uq(exam_subject_id, enrollment_id)`. Four component columns, a stored `total`, `is_absent`, `grace_applied`, and `grade`/`grade_point` written **only by a processing run**. No soft delete: a mark is re-entered in place so its id stays stable for the correction log to point at.
- `mark_corrections` — append-only. No update, no delete, no soft-delete column.
- `results` — one row per (exam, candidate) with `gpa`, `gpa_without_optional`, `grade`, `failed_subjects`, both merit positions, and its own `grading_snapshot`.
- `result_publications` — `version`, `channels JSONB`, `is_active`, revocation columns.
- `result_runs` — durable progress (`total`, `processed`, `issues JSONB`, `error`, `override`, `scope_enrollment_id`).
- `combined_results` — `uq(session_id, name, enrollment_id)`, carrying the frozen `components` and `weights`.

**Hand-written constraints** (Prisma cannot express them)
- `chk_marks_non_negative`, `chk_marks_absent_empty` (absent ⇒ no components, total 0), `chk_marks_grade_pair` (grade and point together or neither).
- `chk_results_gpa_range` (0–5), `chk_results_marks` (obtained ≤ total, failed ≤ subjects), `chk_results_merit_positive`, `chk_results_withheld_reason` (withholding must say why).
- `chk_result_publications_version`, `chk_result_publications_revocation`, `chk_result_runs_progress`, `chk_combined_results_values`.
- **`uq_result_publications_one_active`** — partial unique index over `exam_id WHERE is_active`. Every reader resolves "the" active publication, so it has to be singular.

## API Endpoints Added

```
GET  /api/v1/exams/:examId/marks?examSubjectId=&sectionId=
PUT  /api/v1/exams/:examId/marks
GET  /api/v1/exams/:examId/marks/status | corrections
POST /api/v1/exams/:examId/marks/submit | verify | lock
PUT  /api/v1/exams/:examId/marks/:markId/correct

POST /api/v1/exams/:examId/process
GET  /api/v1/exams/:examId/process/status | process/history

GET  /api/v1/exams/:examId/results            GET /api/v1/exams/:examId/results/:enrollmentId
GET  /api/v1/results/:id                      PUT /api/v1/results/:id/withhold
GET  /api/v1/exams/:examId/publications
POST /api/v1/exams/:examId/publish | unpublish

GET  /api/v1/exams/:examId/tabulation | tabulation.xlsx | tabulation.pdf
GET  /api/v1/exams/:examId/report-cards       GET /api/v1/exams/:examId/analytics
GET  /api/v1/students/:id/transcript | transcript.pdf | results

GET/POST/DELETE /api/v1/combined-results  (+ /batches, /generate)
GET  /api/v1/public/results/search             (@Public)
```

`GET /report-cards` reports the count in `X-Report-Cards-Issued`.

## Frontend Pages Created

- Three new tabs on `/admin/exams/[id]`, extending the M14 tab strip to follow the exam's whole lifecycle:
  - **Mark entry** — keyboard-first grid (Enter/↑/↓ move down the *column*, which is how a stack of scripts is read), per-component columns, absent checkbox that clears the row, live total, red cells from the mirrored engine, sticky save bar, and the submit/verify/lock action behind its own permission;
  - **Results** — processing card with a progress bar that polls only while a run moves, the issue list, the unlocked-papers refusal with an override button, the results table with withhold/release, and the publish dialog (channel checkboxes + changelog note);
  - **Analytics** — GPA histogram, pass rate by class and section, subject difficulty (hardest first) and the year-over-year table.
- `/admin/results/combined` — weighted final results: batch picker, results table, and a generate dialog that validates the weight set sums to 100 before it will submit.
- Sidebar entry "Final Results" behind `result.view`.

## Components Created (new shared/reusable only)

None — built entirely on the existing shared set (`PageHeader`, `StatCard`, `Can`, `EmptyState`, `ErrorState`, `LoadingBlock`, `Spinner`) plus vendored shadcn primitives.

## Business Rules Implemented

- Marks may not exceed their component's allocation (engine + DTO); absent ⇒ all components NULL, total 0, failing grade, never rescued by grace.
- **A missed component threshold forces the failing grade** even when the aggregate would have earned an A+ — the band table only sees the total.
- **NCTB GPA**: the mean of *grade points* over compulsory subjects; the optional (4th) subject contributes only its points **above** the bonus base and never enters the divisor; one compulsory F is a fail with GPA **0.00**, not an arithmetic mean; an optional F never fails anybody.
- Grace lifts a near-miss to exactly the pass mark, is capped per subject *and* in how many subjects it may be spent, and is recorded separately from the entered mark (and printed on the report card).
- Processing requires every paper `LOCKED` unless overridden with `result.process.override`; missing marks produce `INCOMPLETE`, never a zero.
- Merit is competition ranking (1, 2, 2, 4) among **PASSED** candidates only; the tiebreak is a setting (`NONE` shares the position, `ROLL_ASC` separates).
- A `WITHHELD` result stays withheld across re-processing — withholding is a decision about a person, not an arithmetic outcome.
- Mark entry needs the exam in `MARK_ENTRY`/`PROCESSING` and a writable session (the M05 read-only rule).
- Weight sets must sum to 100; a candidate missing from any component exam is skipped, not merged as a zero.

## Design Decisions

### The grade scale is frozen at first PROCESSING, not at PUBLISH

Module 14 froze `exams.grading_snapshot` when an exam was published. That left a real hole: results are computed during `PROCESSING`, so they were graded through the **live** `grading_systems` table, and an edit to a band between processing and publication would freeze a scale **no result on file was ever computed against**.

M15 freezes on the first processing run and reuses the frozen copy verbatim afterwards, so the scale a result was graded through is the scale that gets published. The per-result copy on `results.grading_snapshot` (the roadmap's design) makes a single result self-describing in an export or a re-print years later.

### Publication visibility is the active publication row, not `exams.status`

M14's status machine deliberately cannot rewind past `PUBLISHED` — a published result is corrected by re-issue, not by a quiet rewind of a column. So "unpublish" needed a switch of its own, and versioned `result_publications` is it.

### Where `EXAM_RESULT_GATE` is bound

The gate's code lives in the result module but is provided **inside `ExamModule`**, over re-provisioned stateless repositories: `ResultModule` imports `ExamModule` for the exam aggregate, so binding it the other way would close a cycle. This is exactly the shape M13 used to make M08's `TIMETABLE_CONFLICT_CHECKER` real. It is *also* provided in `ResultModule`, because a republish never reaches the status machine and had to be gated directly (see the bug below).

## Known Limitations

- **Bangla report cards are not bilingual.** pdfkit's default font cannot set Bangla — the same limitation flagged for M09 ID cards and M13 routines. `subjectNameBn` is carried through the API and the roadmap's EN/BN toggle waits for the M18 report engine.
- Report cards and tabulation sheets are unbranded plain tables (no logo, no watermark) for the same reason.
- The public result search resolves `DEFAULT_SCHOOL_ID`, like the M10 public admission endpoints — multi-tenant public routing is an M31 concern.
- Analytics compares at most five earlier exams of the same type, and loads each one's results to do it; a school with a long history will want that pushed into SQL.
- Grace marks are applied at processing time and re-derived on read; changing `exam.grace_marks` after a run changes what a *re-run* would produce, which is intended but worth knowing.
- `ResultReadinessGate` is instantiated twice (once per module). Both are stateless, so this is a cost of the acyclic module graph rather than a correctness issue.
- The mark grid is not virtualized — the same 100+ row caveat M12's attendance grid carries.

## Future Improvements

- Bulk mark import from XLSX (the M09 student-import pattern applies directly).
- Portal surfaces for M18: a student's own result card and a parent's children view, both reading the active publication.
- Grade-boundary "what-if" tooling for a controller of examinations deciding where to set a band.
- Re-check *requests* from the portal, feeding the existing correction flow instead of an office visit.
- Signed/QR-verified report cards, reusing the M09 ID-card generator.

## Breaking Changes

**One, and it is intentional:** publishing an exam is now **gated**. `EXAM_RESULT_GATE` shipped in M14 as a no-op that allowed publication and logged an apology; it now refuses until results are processed and still describe the marks on file. `test/exam.e2e-spec.ts` encoded the old permissive behaviour and was updated to assert the refusal — any other caller that walked an exam to `PUBLISHED` without processing will now get a 409.

Additive changes other modules should know about:
- `ExamsRepository.findByType(examTypeId, schoolId, excludeExamId)` added.
- `MarksRepository` / `ResultsRepository` are re-provisioned in `ExamModule`, `AcademicModule`, `EnrollmentModule` and `StudentModule` for the guards below.
- 13 new permission codes (`mark.*`, `result.*`) and 9 new `exam.*` settings.

## Migration Steps

1. `npm run migrate:deploy` (applies `20260722213000_marks_result_processing`).
2. `npm run seed` — syncs the 13 new permission codes and extends the Principal / Vice Principal / Teacher baselines. Idempotent; never revokes admin-added extras.
3. New `exam.*` settings appear in Settings → Exam with defaults. Worth reviewing before the first result run: `exam.grace_marks` (default 0 = off), `exam.grace_max_subjects`, `exam.merit_tiebreak`, `exam.require_locked_marks`.
4. Redis must be reachable for queued processing. If it is not, runs execute **inline** instead of being lost — but the request then blocks for the length of the run.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Backend unit suite | ✅ 808 passed (69 suites) | Was 589 — **219 new** |
| Backend typecheck (`tsc --noEmit`) | ✅ clean | |
| Backend lint (`eslint src/modules/result src/queues test/result.e2e-spec.ts`) | ✅ 0 errors | |
| **Backend e2e suite** | ✅ **280 passed (15 suites)** | Was 225 — includes the new 55-case `result.e2e-spec.ts`; three consecutive green full runs |
| Migration onto an **empty** Postgres 16 | ✅ full 14-migration chain applied in order | |
| `prisma migrate diff` (migrated DB → schema) | ✅ **No difference detected** | |
| Objects created | ✅ 6 tables, 3 enums, 11 CHECKs, 1 partial unique index | Asserted on both databases |
| Migration + seed applied to **Neon** dev DB | ✅ applied, status up to date, zero drift | 135 permission codes; 13 `mark.*`/`result.*` present |
| Frontend test suite (`vitest run`) | ✅ 195 passed (23 files) | Was 171 — **24 new** |
| Frontend typecheck | ✅ clean | |
| Frontend lint | ✅ 0 errors | |
| Frontend production build | ✅ compiled | `/admin/results/combined` and the extended `/admin/exams/[id]` emitted |

## Bugs found during verification

### The publication gate ran *after* the write (found by the e2e suite)

`ResultPublicationService.publish` created the publication row and stamped
`results.published_at` inside a transaction, and only then called
`ExamsService.changeStatus`, which is where `EXAM_RESULT_GATE` is consulted.
Two consequences, both real:

1. a **refused** publish had already committed an ACTIVE publication row — so
   results the gate had just rejected were live on the portal and the public
   search;
2. a **republish** never reaches the status machine at all (the exam is
   already `PUBLISHED`), so it was never gated — a re-issue after a correction
   could publish stale numbers.

Fixed by consulting the gate at the top of `publish()`, before anything is
written. The e2e case that caught it drives the *staleness* branch, which is
the one only the gate can see.

### Two long-standing e2e flakes, fixed rather than tolerated

Adding a 15th suite tipped both over often enough to be in the way:

- **`health.e2e-spec`** read `body.details`, which only exists on a 200. The
  check goes 503 for reasons that say nothing about the application — the
  memory probes measure the single Jest worker carrying every preceding
  suite's heap (the M14 lesson) — and on 503 the global filter moves the probe
  map to `body.error.details`. It now reads from either shape and keeps
  asserting the *dependency* probes strictly.
- **`school.e2e-spec`** read the audit row immediately after the mutation.
  Audit writes are deliberately fire-and-forget, so it lost the race under
  load; it now polls, as the other suites do. This was flagged in
  PROJECT_CONTEXT §18 as "poll for the row when next touching that suite".

## Cross-module debts closed

| Debt | Where | Status |
|---|---|---|
| `EXAM_RESULT_GATE` is a no-op (M14) | `ExamModule` | **Live** — `ResultReadinessGate` |
| "Blocked once marks exist" on `exam_subjects` (M14) | `ExamSubjectsService.assertNoMarks` | **Live** — unconditional refusal |
| "Blocked once marks exist" on `exam_classes` (M14) | `ExamsService.setClasses` | **Live** — reachable via the one-step-back path |
| Subject removal blocked once marks exist (M06) | `ClassSubjectsService.replaceForClass` | **Live** — removals refused, adds unaffected |
| Promotion rollback guard extends to marks (M11) | `PromotionService.rollback` | **Live** |
| `performance-history` returns real data (M09) | `StudentsService.performanceHistory` | **Live** |
| Combined weight set sums to 100 (M14 deferred it) | `combined-result.engine.ts` | **Live** |

Still open: `EXAM_DUES_GATE` (M16), so `exam.admit_card_block_dues` remains inert.

## Remaining TODOs

- [ ] In-browser click-throughs: the mark grid with a full class and keyboard navigation, a report card printed on A4, and the publish dialog's SMS channel once M17 makes delivery real.
- [ ] Module 16 must bind `EXAM_DUES_GATE`; a natural second use is withholding a result for dues automatically rather than by hand.
- [ ] Module 18 renders results in the student/parent portals — read the **active publication**, never `exams.status`.
- [ ] Module 19 builds the public result-search page; the API is live here.
- [ ] Repo-level: still no `.gitattributes` (`* text=auto eol=lf`) — the CRLF/LF split continues to produce phantom prettier errors in `enrollment` and `rbac`.

## Links to Related Modules

- **Depends on:** Module 04 (grading systems + settings), Module 05 (session read-only rule), Module 06 (`class_subjects` — the optional-subject flag drives candidate resolution), Module 11 (canonical roster; every mark keys on `enrollment_id`), Module 12 (attendance percentage on the report card, via the shared pure engine), Module 14 (the exam aggregate, its papers and the two override precedents).
- **Unlocks / hooks completed for:**
  - **Module 16** — must bind `EXAM_DUES_GATE`; `ResultsService.setWithheld` is the natural hook for an automatic dues withhold.
  - **Module 17** — the result SMS is queued through the existing `notifications` contract and becomes real when the gateway lands.
  - **Module 18** — `ResultsService`, `ResultsRepository`, `MarksRepository` and `ResultReportsService` are exported for the portals.
  - **Module 19** — `GET /public/results/search` is the website's result page API.
- **`PROJECT_CONTEXT.md` sections updated:** §5 (shared services), §8 (entity spine), §11 (global business rules), §16 (technical decisions), §18 (technical debt).
