# Module 22 — Assignments & Homework · Completion Document

| | |
|---|---|
| **Module** | 22 — Assignments & Homework |
| **Completion date** | 2026-07-30 |
| **Actual effort** | 1 dev-day (est. was 3) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 22 |

## Summary of Implemented Features

The teaching loop that Phase 1 left out: a teacher sets work for a section,
students hand it in, the teacher marks it, and the parent can see what is
outstanding. Three tables, five dependency-free engines, and one design
decision that everything else falls out of.

**The ownership policy reads the live duty roster, never the stored
author.** `AssignmentPolicyService` answers "may this person set / read /
mark 8B's physics?" by querying `teacher_section_subjects` at the moment
of the request, not by comparing `assignments.teacher_id`. That single
choice delivers roadmap §8's *"teacher reassigned → new teacher inherits
evaluation rights for that section-subject"* with no data migration, no
reassignment sweep and no back-fill job — the M08 duty table already
moved, so the answer moves with it. Trusting the stored id would have
produced exactly the situation §8 names: a departed teacher still marking,
and the incoming one locked out. The original author keeps access as well,
because a teacher who set work on Monday and was reassigned on Tuesday
must still be able to read the marks they had already given.

**Assignments walk `DRAFT → PUBLISHED → CLOSED`**, with one step back
(the M14 status-machine convention — a mis-click needs undoing, and
closing homework is not the irreversible act publishing a result is).
DRAFT is invisible to students; a direct read of a draft id from the
portal returns the same 404 a non-existent id gets, which is the M15/M19
"a read must not confirm what the caller may not see" rule. Publishing is
what notifies the section. CLOSED freezes evaluation the way an APPROVED
payroll run freezes a payslip — and the unlock is a separate permission,
`assignment.evaluate.override`, which the Teacher baseline deliberately
does not hold.

**Submissions key on `enrollment_id`** like every other academic record,
and carry **no soft delete**: a resubmission replaces the row in place so
the evaluation hanging off its id stays attached (the M15 `marks` rule),
which is also what lets `uq_assignment_submissions_identity` be a plain
unique rather than a partial one. A resubmission **clears the mark and
feedback**, because whatever was said about the old work no longer
describes what is on file. `is_late` is **stored, not derived** — moving
a deadline afterwards must not silently rewrite what last week's
submission report said, and forgiving lateness is the teacher's call at
evaluation rather than a side effect of editing a date (the M21
stored-`days` reasoning).

**Only a student may submit.** A parent reads the same lists (§5's
"child's pending/late overview") and is refused on `submit`, in the
service and again in the UI, because the school's record of who did the
work has to mean what it says.

**Five dependency-free engines**, golden-tested (103 tests before a
service existed):

- `submission-window.engine.ts` — the single verdict every "can they hand
  this in" question funnels through: published, not closed, late allowed,
  resubmission allowed, not already evaluated. The portal's disabled
  button, the API's 409 and the list's `submitBlockedReason` all read the
  same function, so they cannot disagree (the M16 `deriveStatus` lesson).
  A **RETURNED** submission bypasses the resubmission knob entirely —
  the teacher explicitly asked for the work again, and refusing there
  would make return-for-revision a dead end.
- `evaluation.engine.ts` — the bound a DB CHECK cannot express (a mark
  against its assignment's `full_marks`, one join away — the M15
  `mark-entry.engine.ts` situation), plus the bulk grid, which is
  **all-or-nothing and returns every bad cell at once**.
- `assignment-stats.engine.ts` — submission %, late/evaluated counts, the
  mark spread, and the per-student pending list. The denominator is the
  **roster ∪ the submitters**, so a student who transferred out after
  handing work in counts on both sides rather than printing 3/2 = 150 %.
  Marks average over EVALUATED rows only — an unmarked submission is not
  a zero (the M15 rule).
- `attachment.util.ts` — size/count/type limits and the https + host
  allow-list for material links, matched at a **label boundary** so
  `youtube.com.evil.test` fails a `youtube.com` entry.
- `zip.util.ts` — a store-mode ZIP writer for §5's "download-all", with
  CRC-32, MS-DOS timestamps, UTF-8 filename flag (Bangla survives) and
  zip-slip-safe entry names. Dependency-free for the same reason
  `ics.util.ts` (M05) and `feed.util.ts` (M19) are: everything a student
  uploads is already compressed, so deflate buys a percent or two for a
  dependency and a CPU spike per download.

**Notifications** go through `NotificationService.send()` (M17's single
entry point) on publish, 24 h before the deadline, and — §8's
zero-submission case — to the teacher after due + 3 days. Default channel
is **IN_APP, not SMS**: homework is the highest-frequency event in the
system (daily, per section, per subject), and defaulting to SMS would
burn a term's credit in a fortnight. `assignment.notification_channel`
is how a school opts into SMS, which then goes to the guardian's phone
only. Every send is wrapped — a flat SMS balance must not make "publish"
fail (the M07/M20 "delivery never blocks the mutation" rule).

**The §8 auto-close is deliberately a nudge.** Closing locks evaluation,
and a cron deciding that nobody may hand in late work — three days after
a deadline the teacher may well have extended verbally — is the school's
call, not the machine's. The job messages the teacher and leaves the
assignment PUBLISHED.

**Learning materials** sit beside it: notes, slides, and video/web links,
scoped to a section or class-wide (`section_id` NULL). The visibility
query writes the NULL branch out explicitly, because a missing filter
means "every section" — the opposite of what class-wide means (the M06
COALESCE-index lesson in query form).

**7 + 2 permission codes, 14 `assignment.*` settings.** This is the first
module whose **primary author is the Teacher role** rather than the
office: teachers set, publish, mark and export their own work and keep
the notes library. They deliberately do **not** get `assignment.all`
(another teacher's section is not theirs) or
`assignment.evaluate.override` (reopening a closed assignment is a
decision above the person who closed it) — the M16/M20/M21
separation-of-duties encoding, continued.

**The virus-scan placeholder is a DI token, not a comment.**
`ATTACHMENT_SCANNER` ships bound to a pass-through; every upload path
already calls it and already handles a refusal, so switching a school to
ClamAV is one provider binding. That is the M08
`TIMETABLE_CONFLICT_CHECKER` / M14 `EXAM_RESULT_GATE` convention — the
call site is the part that is easy to forget.

## Verification

Run 2026-07-30 against a clean local stack (`docker compose up -d postgres
redis minio mailpit` — started **by name**, per the M20 trap in
`test/README.md`).

| Check | Result |
|---|---|
| `npx tsc --noEmit` (backend) | clean |
| `npx tsc --noEmit` (frontend) | clean |
| `npx jest` (backend unit) | **1394 passed / 104 suites** — 1255 before, **+139** (103 engine, 36 service) |
| `npx vitest run` (frontend) | **349 passed / 33 files** — 302 before, **+47** |
| `npm run test:e2e` (full suite) | **587 passed / 22 suites** — 526 / 21 before, **+61** in `test/assignment.e2e-spec.ts` |
| `npx eslint` on the new paths | clean, both repos |
| `npx next build` | compiles; emits `/(admin)/admin/assignments/page` and `/(admin)/admin/assignments/[id]/page` |
| Migration replay onto an **empty** Postgres 16 | all 20 migrations apply; `migrate diff` reports **no difference** |
| Migration on the Neon dev DB | applied; `migrate diff` reports **no difference** |
| Constraints/indexes/enums present on the replayed DB | 6 CHECKs, 12 indexes (incl. `uq_assignment_submissions_identity`), 4 enums, `settings_group_enum.assignment` — asserted by query and each CHECK re-asserted by the e2e suite rejecting a bad row |

**What the verification found.** No defects in the module — but
`chk_assignments_window` refused the *test harness* on the first run, when
two cases back-dated `due_at` past `assigned_at` to simulate an overdue
assignment. That is the constraint doing exactly its job on the first
input that tried to go round it; the fixture now moves the whole window
into the past, which is what an overdue assignment actually is. Two other
first-run failures were harness-only (`await import()` needs
`--experimental-vm-modules` under this Jest config; a `toHaveBeenCalledWith`
arity). 58 of 61 passed on the first run, 61 of 61 after.

## Database Changes

Migration `20260730120000_assignments_homework`.

**Enums (4 new + 1 altered)**

| Enum | Values |
|---|---|
| `assignment_type_enum` | `ASSIGNMENT`, `HOMEWORK` |
| `assignment_status_enum` | `DRAFT`, `PUBLISHED`, `CLOSED` |
| `submission_status_enum` | `SUBMITTED`, `RESUBMITTED`, `EVALUATED`, `RETURNED` |
| `learning_material_type_enum` | `NOTE`, `SLIDE`, `VIDEO_URL`, `LINK`, `OTHER` |
| `settings_group_enum` | `+ assignment` |

**Tables (3)**

- **`assignments`** — session × section × subject × teacher, `type`,
  `title`, sanitized `instructions`, `attachment_urls JSONB`,
  `assigned_at`/`due_at` (wall-clock instants, because "due Thursday" at
  a BD school means a time of day and 23:59 vs 00:01 is exactly what
  `is_late` decides), nullable `full_marks`, `allow_late`, `status` with
  `published_at`/`closed_at`, plus `due_reminder_sent_at` and
  `no_submission_alert_at` as the jobs' idempotency (the M12
  `absent_notified_at` pattern — a column on the row the job acts on
  beats a second table nobody reads). Audit + soft delete.
- **`assignment_submissions`** — `assignment_id` × **`enrollment_id`**,
  `text_answer`, `attachment_urls JSONB`, `submitted_at`, `is_late`,
  `attempt`, `marks`, `feedback`, `evaluated_by`/`evaluated_at`,
  `status`. Audit columns, **no soft delete** (see Summary).
- **`learning_materials`** — session × class × optional section × subject
  × teacher, `type`, `title`, `description`, `file_urls JSONB`,
  `link_url`. Audit + soft delete.

**Indexes**: `uq_assignment_submissions_identity` (plain unique — the
table has no `deleted_at`), plus 3 scope indexes on `assignments`, 2 on
submissions and 3 on materials.

**CHECK constraints (6)**, each asserted in the e2e suite to actually
reject a bad row:

| Constraint | What it holds |
|---|---|
| `chk_assignments_window` | `due_at > assigned_at`, positive `full_marks`, non-blank title |
| `chk_assignments_status_evidence` | non-DRAFT carries `published_at`; CLOSED carries `closed_at` |
| `chk_assignment_submissions_content` | text **or** at least one file — an empty submission is not a submission, and it would otherwise land on the teacher's grid as handed-in and inflate the one percentage this module exists to report |
| `chk_assignment_submissions_evaluation` | `attempt ≥ 1`, non-negative marks, EVALUATED/RETURNED record who and when, RETURNED carries feedback |
| `chk_learning_materials_payload` | a VIDEO_URL/LINK has its URL; anything else has a file or a link |
| `chk_learning_materials_link_scheme` | `link_url` is `https://…`, always — this column is rendered as an anchor in a student's browser |

`learning_materials.section_id` uses `ON DELETE RESTRICT`, not Prisma's
default SET NULL for an optional relation: NULL means "class-wide" here,
so a deleted section would silently promote a private material to the
whole class.

## API Endpoints Added

```
GET    /api/v1/assignments                       ?sessionId&sectionId&subjectId&type&status&mine&search
POST   /api/v1/assignments
GET    /api/v1/assignments/:id
PATCH  /api/v1/assignments/:id
DELETE /api/v1/assignments/:id                   204 — refused once anybody has submitted
POST   /api/v1/assignments/:id/publish
POST   /api/v1/assignments/:id/close
POST   /api/v1/assignments/:id/reopen
GET    /api/v1/assignments/:id/stats
GET    /api/v1/assignments/:id/submissions       the evaluation grid
PUT    /api/v1/assignments/:id/evaluate          the bulk grid (all-or-nothing)
POST   /api/v1/assignments/attachments           multipart
GET    /api/v1/assignments/:id/export/submissions.zip
GET    /api/v1/assignments/:id/export/marks.xlsx

GET    /api/v1/submissions/:id
PUT    /api/v1/submissions/:id/evaluate
PUT    /api/v1/submissions/:id/return

GET    /api/v1/learning-materials                ?sessionId&classId&sectionId&subjectId&type&mine&search
POST   /api/v1/learning-materials
GET    /api/v1/learning-materials/:id
PATCH  /api/v1/learning-materials/:id
DELETE /api/v1/learning-materials/:id            204
POST   /api/v1/learning-materials/files          multipart

— portal (M18 routes, ownership-scoped, no permission codes) —
GET    /api/v1/portal/assignments                ?sessionId&subjectId&tab
GET    /api/v1/portal/assignments/:id
POST   /api/v1/portal/assignments/:id/submit     students only
POST   /api/v1/portal/assignments/attachments    multipart
GET    /api/v1/portal/materials                  ?subjectId
GET    /api/v1/portal/parent/child/:childId/assignments
GET    /api/v1/portal/parent/child/:childId/materials
```

## Frontend Pages Created

- `/admin/assignments` — two tabs (Assignments, Learning materials).
  Filters by status/type/section/mine/search; the create dialog is
  section-subject scoped and the API refuses anything the teacher does
  not teach.
- `/admin/assignments/[id]` — the assignment, its stats strip, the
  lifecycle buttons, the two exports, and the **submissions grid** with
  inline marks + feedback. The grid is a staged edit with one save (the
  M15 mark-grid pattern): only touched cells live in state, invalid cells
  turn red immediately against the assignment's own `full_marks`, and
  Save posts the whole batch — so one bad cell blocks the write and the
  server hands back every problem at once.
- Portal: `AssignmentPanels` in `(portal)/portal/assignment-panels.tsx`,
  rendered in the student view (with the submit form) and in the parent's
  per-child view (**without** it — the same component, one prop apart),
  plus the materials library with a per-subject filter.
- `ADMIN_MENU` gained an Assignments entry, visible on
  `assignment.view` **or** `material.view`.

## Components Created (new shared/reusable only)

None promoted to `components/shared` — `AssignmentPanels` has two
consumers but both are portal views, so it stays beside them (the M06
`MasterCrud` convention: promote on the second *area*, not the second
call site).

## Business Rules Implemented

- A teacher may set, read and mark work only for section-subjects they
  hold **now**; `assignment.all` widens that to the whole school. The
  original author keeps access after a reassignment.
- Only a DRAFT can be published; publishing overdue work is refused
  (it tells the class nothing actionable and would immediately trip the
  zero-submission nudge). Only a PUBLISHED assignment can be closed; only
  a CLOSED one reopened.
- A student submits only for their own enrollment, only to their own
  section's PUBLISHED (non-CLOSED) work, and only late if `allow_late`.
  A parent may not submit at all.
- An empty submission is refused in the service and by CHECK.
- A resubmission replaces the row and clears the mark, feedback and
  evaluator. An EVALUATED submission cannot be overwritten by the
  student — the teacher's `return` is the door back.
- Marks ≤ `full_marks`; `full_marks` cannot be lowered below a mark
  already given (the report would print 18/15 and nobody could say which
  figure was wrong).
- Returning work requires feedback, and clears the mark.
- Evaluation is editable until CLOSED, then locked behind
  `assignment.evaluate.override`.
- Deleting an assignment is refused once anybody has submitted — the FK
  cascades, so a delete would take real student work with it (the
  M14/M15 "blocked once marks exist" guard).
- Every submission id in a bulk payload must belong to *that* assignment,
  or a teacher who legitimately holds one section could post another
  section's ids and mark them.
- External material links are https and on the school's host allow-list;
  an empty allow-list honestly means "any https host".
- Author HTML is sanitized on **write** through the M19 allow-list
  sanitizer, so the stored row is the guarantee for every reader.

## Known Limitations

- Submission attachments are listed in the portal but not individually
  downloadable there — the teacher's zip export is the download path.
  A per-file signed-URL endpoint is a small follow-up.
- Instructions are authored as **HTML in a textarea**; the sanitizer
  makes that safe, but there is no WYSIWYG (the same gap M19 has for
  content and M20 for voucher attachments).
- The submissions grid is not virtualized (the same 100+ row caveat
  M12's attendance grid and M15's mark grid carry).
- The zip is assembled **in memory**, so a section handing in forty 10 MB
  PDFs is a ~400 MB buffer. Fine for a class; stream it if a school
  starts archiving a whole term at once.
- No plagiarism/similarity checking, and the virus scanner is the
  pass-through binding (`ATTACHMENT_SCANNER`) until a ClamAV container is
  wired.
- `assignment.notification_channel` is school-wide — a school cannot yet
  choose SMS for exams and IN_APP for daily homework.
- Reminder timing is hourly, so a deadline is reminded about within an
  hour of the configured window rather than to the minute.

## Future Improvements

- Per-file signed download links in the portal, and a teacher-side
  preview instead of "download the zip".
- A group/peer-assessment mode, and rubric-based marking (M32's LMS
  extension is where the roadmap parks this).
- Roll assignment marks into a continuous-assessment component so a
  term's homework can feed M15's CA column.
- Copy-an-assignment-to-another-section, which is the single most obvious
  thing a teacher with four sections will ask for.

## Breaking Changes

None. Every table, route, permission and setting is additive.

Two files gained members that later modules must keep appending to rather
than reordering: `NOTIFICATION_CODES` (three new codes) and
`SETTINGS_REGISTRY` (a new `assignment` group, which required the
`settings_group_enum` ALTER).

## Migration Steps

1. `npx prisma migrate deploy` — creates 3 tables, 4 enums, adds
   `assignment` to `settings_group_enum`, 6 CHECKs, 1 unique + 8 indexes.
2. `npx prisma generate`.
3. Restart the API: the permission seeder syncs the 9 new codes and
   extends the Principal / Vice-Principal / **Teacher** role baselines;
   the notification-template seeder adds the three `ASSIGNMENT_*`
   defaults.
4. Nothing to back-fill — there is no prior assignments data.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. Attachments reuse the existing `S3_BUCKET_DOCUMENTS` / `S3_BUCKET_DEFAULT` purpose. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Teacher sets work for their own section-subject | ✅ | e2e |
| Teacher refused another section / another subject / another teacher's name | ✅ | e2e, three cases |
| Admin (`assignment.all`) files on a teacher's behalf | ✅ | e2e |
| Publish → the section's student **and** guardian get an IN_APP notification; the other section does not | ✅ | e2e asserts exactly 2 rows |
| Student submits, resubmits (attempt 2, one row), is refused after evaluation | ✅ | e2e |
| Mark above `full_marks` refused, naming the cell | ✅ | e2e |
| `full_marks` cannot be lowered below a mark already given | ✅ | e2e |
| Return for revision clears the mark; student resubmits | ✅ | e2e |
| Close → submissions refused, evaluation locked, override unlocks | ✅ | e2e |
| Bulk grid: one bad cell writes nothing; a foreign submission id refused | ✅ | e2e |
| IDOR: teacher B refused A's submission / grid / evaluate | ✅ | e2e |
| IDOR: student refused another section's assignment (403 submit, 404 read) | ✅ | e2e |
| **Parent refused submitting for their own child**, and the row count is unchanged | ✅ | e2e |
| Parent reads own child's overview; refused a stranger's | ✅ | e2e |
| Six CHECK constraints each reject a bad row | ✅ | e2e |
| Materials: class-wide visible to the class, section-scoped invisible to another section | ✅ | e2e |
| Link host allow-list refuses `youtube.com.evil.test`; http refused | ✅ | e2e |
| Zip export is a real archive (signatures + payload) | ✅ | e2e reads the bytes |
| Due-soon reminder fires once, skips submitters, is idempotent | ✅ | e2e |
| Zero-submission nudge reaches the teacher and does **not** close the assignment | ✅ | e2e |
| Author HTML sanitized on write (`<script>`, `javascript:` stripped) | ✅ | e2e reads the stored row |
| Migration replays onto an empty Postgres 16 with zero drift | ✅ | verified |
| Migration applied to Neon with zero drift | ✅ | verified |
| In-browser click-through of the grid, the submit form on a phone, the zip download | ⏳ | pending, like every module's UI pass |

## Remaining TODOs

- [ ] In-browser click-throughs: the submissions grid with a full class,
      the portal submit form with a real file on a phone, the zip opened
      in Explorer/Finder, and the parent's per-child overview.
- [ ] Per-file signed download links in the portal.
- [ ] Bind a real `ATTACHMENT_SCANNER` (ClamAV) when a school wants it.

## Links to Related Modules

- **Depends on:** 08 (the `teacher_section_subjects` duty roster the
  policy reads), 11 (`getSectionStudents` / `getStudentCurrentEnrollment`
  — every submission keys on the `enrollment_id` those return), 17
  (`NotificationService.send`), 18 (`PortalResolverService` +
  `OwnershipGuard`), 05 (`SessionsService` for the current session), 19
  (the `sanitizeHtml` allow-list sanitizer, imported as a pure engine).
- **Hooks completed for:** none outstanding — this module closed no
  earlier debt. It leaves `ATTACHMENT_SCANNER` as its own documented
  no-op, the M08/M14 convention.
- **Unlocks:** M29 (Reports v2 — submission-rate analytics per teacher /
  section / subject), M32c (the LMS extension the roadmap parks rubrics
  and peer assessment in).
- **Graph note:** `AssignmentModule` imports Enrollment / Academic /
  Communication / School / Rbac / Storage, and deliberately **not**
  `TeacherModule` — the policy needs one query against
  `teacher_section_subjects`, which TeacherModule does not export, so it
  reads it directly over PrismaService (the M17 `AudienceRepository` /
  M18 `DashboardRepository` / M19 `PublicSiteRepository` precedent). That
  also keeps the graph honest about the real dependency: the *duty
  roster*, not teacher management. Nothing imports AssignmentModule back
  except the leaf `PortalModule`.
- `PROJECT_CONTEXT.md` sections updated: §5 (shared services), §8 (entity
  spine), §11 (global business rules), §16 (decisions), §18 (debt).
