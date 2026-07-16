# Module 06 — Academic Structure · Completion Document

| | |
|---|---|
| **Module** | 06 — Academic Structure (Class, Section, Group, Shift, Subject, Department) |
| **Completion date** | 2026-07-17 |
| **Actual effort** | 1 dev-day (est. was 3) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 06 |

## Summary of Implemented Features

**Backend (`hexschool-backend`, extending `src/modules/academic/`)**
- **Seven new tables**: the five session-independent masters (`departments`, `shifts`, `classes`, `groups`, `subjects`), the session-scoped `sections`, and the `class_subjects` curriculum mapping. The Prisma model for classes is `SchoolClass` (the `class` keyword collides in generated TS).
- **Masters CRUD** (`MastersService`): uniqueness conflicts → 409 (department/subject code, class numeric level, group/shift name — all soft-delete-aware partial indexes); **guarded deletes with explanatory 409s** while live rows still reference a master (department←subjects, shift←sections, class/group←sections+mappings, subject←mappings; enrollment/marks guards join in M11/M15). Shifts are hard-deleted per spec; times stored as PG `TIME` with `HH:MM` DTO round-trip helpers.
- **Sections** (`SectionsService`): session-scoped, identity unique per (school, session, class, name, shift) — **hand-written COALESCE unique index so a NULL shift can't evade it** (case-insensitive service check on top); the **group-applicability rule** (a group applies only from its `applicable_from_level`, BD default 9 — sections AND mapping rows below it → 400); capacity advisory (enforced at enrollment, M11); `class_teacher_id` column exists with **no FK until M08 creates `teachers`** (the M02/M04 deferred-FK pattern). Mid-session sections allowed; the UI warns about routines/seat plans.
- **Curriculum mapping** (`ClassSubjectsService`): `GET/PUT /classes/:id/subjects` — PUT is a full bulk replacement with display order (payload order by default), `is_optional` (BD 4th subject), `full_marks_default`, and per-group rows (same subject may appear once per group; NULL-group identity protected by a second COALESCE index). Registry-style validation: unknown subjects/duplicate pairs/inapplicable groups → 400. Marks-exist removal guard is M15's extension point.
- **Clone-to-session** (`StructureCloneService`): copies sections (minus class teachers — per-session decisions, M08) and mappings from one session to another; **additive + idempotent** (identity-matched rows skipped, so partial manual setup survives), `preview: true` dry-runs with the same counts. Single transaction.
- 9 new permission codes: `structure.view` (all reads), one `<entity>.manage` per master (deliberate granularity choice — no real-world role splits create vs delete for a shift), `class.subject.assign`, `structure.clone`. Principal core: all; Vice-Principal: view + sections + mapping; Teacher: view.
- **Seed**: the five standard BD groups (Science/Commerce/Arts/General/Vocational, from class 9), idempotent.
- Test infra: `test/jest-e2e.json` now pins `maxWorkers: 1` — six suites against ONE shared DB/Redis/Mailpit must not interleave.

**Frontend (`hexschool-frontend`)**
- **`/admin/structure`** tabbed area (Classes / Subjects / Departments / Shifts / Groups / Clone to Session).
- **`MasterCrud`** — a new reusable generic (DataTable + FormDialog + ConfirmDialog + search/sort/pagination wired) so each master page is a ~80-line config, not a re-implementation.
- **Class detail** (`/admin/structure/classes/[id]`): Sections and Subjects tabs, both scoped to the **header session switcher** (first real consumers of the M05 convention). Sections tab: add/edit/delete with shift/group selects (only level-applicable groups offered) + the mid-session warning toast. Subjects tab: ordered mapping editor — up/down reordering, optional flag, full marks, per-row group select, add-subject picker, bulk save.
- **Clone wizard**: source/target session selects → preview cards (to-create vs already-present counts) → clone, with the idempotency explained in the UI.

## Database Changes
- Prisma migration `prisma/migrations/20260716165840_academic_structure/migration.sql`:
  - Enum `subject_type_enum` (THEORY/PRACTICAL/BOTH); tables as above (all with `school_id`; sections/mappings FK sessions with CASCADE, masters RESTRICT).
  - **Hand-written:** partial uniques `uq_departments_code`, `uq_classes_numeric_level`, `uq_groups_name`, `uq_subjects_code` (WHERE deleted_at IS NULL), plain `uq_shifts_name`; **COALESCE identity indexes** `uq_sections_identity` (NULL shift → nil UUID) and `uq_class_subjects_identity` (NULL group → nil UUID); CHECKs `chk_shifts_times` (start<end), `chk_classes_level` (0–20), `chk_sections_capacity` (>0), `chk_class_subjects_marks` (1–1000).

## API Endpoints Added
```
GET/POST + PUT/DELETE(:id)  /api/v1/departments | shifts | classes | groups | sections | subjects
                            reads: structure.view · writes: <entity>.manage
GET  /api/v1/classes/:id                          structure.view
GET  /api/v1/classes/:id/subjects?sessionId=      structure.view
PUT  /api/v1/classes/:id/subjects                 class.subject.assign (bulk replace)
POST /api/v1/academic-structure/clone             structure.clone ({from,to,preview?})
```

## Frontend Pages Created
- `/admin/structure` (+ redirect), `/admin/structure/{classes,subjects,departments,shifts,groups,clone}`, `/admin/structure/classes/[id]` (Sections/Subjects tabs).

## Components Created (new shared/reusable only)
- **`MasterCrud`** generic CRUD page (config-driven: columns, Zod schema, form fields, API fns) — the pattern for every future master entity; `structureApi` client with a generic `crud<T>()` factory; structure Zod schemas.

## Business Rules Implemented
- Sections are session-scoped (Class 6-A of 2026 ≠ 2027); classes/subjects/departments/shifts/groups are session-independent masters.
- Group applicability from `applicable_from_level` (default 9) enforced on sections and mapping rows.
- Identity uniqueness that NULLs can't evade (COALESCE indexes) for sections and mappings.
- Delete guards with explanatory 409s across all six entities.
- Clone is additive/idempotent and never copies class-teacher assignments.
- THEORY+PRACTICAL is a subject `type`, never duplicate subjects (M14 handles mark distribution).

## Known Limitations
- Subject-mapping order uses up/down buttons, not drag-and-drop (roadmap said "drag-order"; same capability, simpler dependency surface — revisit if usage demands).
- "Subject can't be removed once marks exist" is unenforceable until M15's marks table (guard slot documented in ClassSubjectsService).
- Master pickers in the UI (shift/group/subject selects, clone) load `limit: 100` — fine for real schools, not paginated pickers.
- `class_teacher_id` is a bare UUID column until M08 adds the `teachers` FK + assignment UI.
- Clone preview reports counts, not row-level lists.

## Future Improvements
- Row-level clone preview diff; drag-and-drop ordering; bulk section generator ("A–D for classes 6–10").
- Fold the section/mapping COALESCE identity checks into shared repo helpers if M11 needs the same trick for rolls.

## Breaking Changes
- None. New tables/endpoints only.
- Dev/test workflow note: e2e now runs suites serially (`maxWorkers: 1`) — slightly slower, no shared-infra flakes.

## Migration Steps
1. `cd hexschool-backend && npx prisma migrate deploy`.
2. `npm run seed` — 9 new permission codes + core grants + the five standard groups.
3. Frontend: `npm ci && npm run build` as usual. No new env vars or dependencies.

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| — | none | |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Backend lint / typecheck / unit tests | ✅ | 138 tests (118 M01–05 + 20 new: shift time rules, uniqueness 409s, all five delete guards, hard-vs-soft delete, group-level rule on create/update/clear, mapping duplicates/unknown subjects/order semantics, clone same-session/preview/idempotency/teacher-not-copied) |
| Backend e2e vs live DB+Redis | ✅ | 67 tests across 6 suites (14 new): masters CRUD + 403s, dupe level/code 409s + bad shift times 400, section identity 409 (case-insensitive) + group-level 400, mapping order persists across re-PUT, clone preview→clone→no-op, delete-guard chain (class/subject/shift) incl. cloned-session references |
| Migration on dev DB (Neon) | ✅ | COALESCE identity indexes + partial uniques + CHECKs applied |
| Seed idempotency | ✅ | 39 registry codes stable; standard groups skip on re-run |
| Frontend lint / typecheck / tests / build | ✅ | 60 tests (55 + 5 new: structure schemas incl. shift-time refine, subject-code, section-name, level bounds); 27 routes compiled |
| Infra incident during verification | ✅ recovered | Docker Desktop had stopped mid-session → Redis/Mailpit down → health 503 + Mailpit test failures; restarted Docker + containers, full suite green. e2e now serial to reduce shared-infra sensitivity |

## Remaining TODOs
- [ ] Push both repos to GitHub and confirm CI green (M01–05 carry-over).
- [ ] In-browser click-through: create class → sections + subject mapping via the detail tabs → clone wizard preview/clone (API + component layers verified individually; e2e covers the HTTP flows).
- [ ] Minor: one e2e suite leaves an open handle at teardown (`--forceExit` currently used); chase with `--detectOpenHandles` in a quiet moment.

## Links to Related Modules
- Depends on: Module 05 (sessions scope sections/mappings; session-switcher convention), Module 03 (permissions + audit), Module 04 (school scope).
- Unlocks / hooks completed for: **Module 07** (departments for staff), **M08** (`class_teacher_id` FK + expertise/assignments; clone already skips teachers), **M09/M11** (sections are where students sit; capacity enforcement), **M13/M14** (shift times, mapping full marks), **M15** (marks-exist guard slot in ClassSubjectsService).
- `PROJECT_CONTEXT.md` sections updated: §5, §6, §8, §16, §18.
