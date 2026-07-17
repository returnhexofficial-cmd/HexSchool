# Module 08 — Teacher Management · Completion Document

| | |
|---|---|
| **Module** | 08 — Teacher Management |
| **Completion date** | 2026-07-17 |
| **Actual effort** | 1 dev-day (est. was 4) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 08 |

## Summary of Implemented Features

- **Teacher registry** (`teachers`): the M07 staff pattern — transactional creation (gap-free ID from the shared SequenceService using the new `general.teacher_id_pattern` setting, default `{SCHOOL_CODE}-T-{YY}{SEQ4}`; user with temp password + forced change; **`teacher` system role** assigned in the same transaction), photo upload (EXIF-normalized 512px PNG), welcome credentials via the notifications queue, soft delete that also soft-deletes the user and revokes sessions.
  - **DECISION (roadmap asked to record it):** `teachers` is a **separate table sharing the user**, NOT an extension of `staff_profiles` — personal columns are duplicated; teacher-specific fields (`salary_grade`, `mpo_index_no`, `specialization`, teacher designations) live alongside them. Teaching and non-teaching staff stay independent lifecycles; M21 payroll unifies over both.
- **Qualifications** CRUD (degree/institution/year/result; year 1950–current, DB CHECK + service).
- **Subject expertise** (`teacher_subjects`): replace-set endpoint; drives assignment checks and the ★ highlighting in the matrix UI.
- **Assignments** (`teacher_section_subjects`): one teacher per (session, section, subject) — assigning an occupied slot **replaces** the holder, history kept in audit_logs. Expertise mismatch → 409 unless `override:true` by an actor holding `teacher.assign.override` (Super Admin bypasses). **Timetable conflict hook** shipped as a DI token (`TIMETABLE_CONFLICT_CHECKER`) bound to a no-op — M13 swaps the provider.
- **Bulk transfer** (`POST /teacher-assignments/transfer`): moves every assignment of a teacher in a session to a colleague (target must cover the subjects, or override). **Resign guard**: RESIGNED/TERMINATED (and delete) are blocked with a 409 while the teacher holds assignments or class-teacher duties in the *current* session.
- **Class teacher** (deferred M06 FK now live): `sections.class_teacher_id` → `teachers` with ON DELETE SET NULL; section create/update accepts `classTeacherId`, validated ACTIVE + capped by the new `academic.max_class_teacher_sections` setting (default 1 per session). Section lists include the class teacher.
- **Leaves** (`teacher_leaves`, interim — HR M21 absorbs them): request/edit/delete while PENDING only; range must be from ≤ to **and inside the current session**; an APPROVED leave never overlaps another APPROVED leave of the same teacher (checked at create AND approve); approve/reject with `approved_by`; **`teacher.leave.approved` event** emitted for M12 attendance.
- **Evaluations** (`teacher_evaluations`): per-criterion scores (names from the new `academic.teacher_evaluation_criteria` json setting) + overall 0–100 (DB CHECK), evaluator = acting user, session-scoped.
- **Workload report** (interim): per-teacher assignment counts per session (`GET /teacher-assignments/workload`); periods/week arrive with M13.
- **Documents** (`teacher_documents`): mirrors staff documents (PDF/JPG/PNG ≤10 MB, hard-deleted with the S3 object; shares `staff_document_type_enum`).
- **Schedule** (interim): `GET /teachers/:id/schedule?sessionId=` = the teacher's slots until M13 adds periods.

## Database Changes

Migration `20260717051823_teacher_management`:

- Enums: `teacher_designation_enum`, `leave_type_enum`, `leave_status_enum` (teachers reuse `staff_status_enum`, `gender_enum`, `staff_document_type_enum`).
- `teachers` (+`uq_teachers_user`, **`uq_teachers_employee_id(school_id, employee_id)` not deleted_at-scoped** — same never-reuse rule as staff, `chk_teachers_dates`), `teacher_qualifications` (`chk_teacher_qualifications_year` 1950–2100), `teacher_subjects` (composite PK), `teacher_section_subjects` (`uq_teacher_assignments_slot(session, section, subject)`), `teacher_leaves` (`chk_teacher_leaves_dates`), `teacher_evaluations` (`chk_teacher_evaluations_score` 0–100), `teacher_documents` (`chk_teacher_documents_size`).
- `fk_sections_class_teacher` — the M06-deferred FK, ON DELETE SET NULL.
- Schema-only: `uq_staff_profiles_employee_id` declared in Prisma (M07 hand-written; stops drift), same for the new teachers index (generated directly this time).

Settings registry: `general.teacher_id_pattern`, `academic.max_class_teacher_sections` (1), `academic.teacher_evaluation_criteria` (5 default criteria).

## API Endpoints Added

```
CRUD   /api/v1/teachers                     (+ GET ?designation=&departmentId=&status=&subjectId=)
PUT    /api/v1/teachers/:id/status          POST /api/v1/teachers/:id/photo
GET/POST /api/v1/teachers/:id/qualifications   PUT/DELETE /:qid
GET/PUT  /api/v1/teachers/:id/subjects      (expertise replace-set)
GET    /api/v1/teachers/:id/schedule?sessionId=
GET/POST /api/v1/teachers/:id/evaluations   PUT/DELETE /:eid
GET/POST /api/v1/teachers/:id/documents     DELETE /:docId
GET    /api/v1/teacher-assignments          (?sessionId=&sectionId=&teacherId=)
GET    /api/v1/teacher-assignments/workload?sessionId=
POST   /api/v1/teacher-assignments          POST /api/v1/teacher-assignments/transfer
DELETE /api/v1/teacher-assignments/:id
GET/POST /api/v1/teacher-leaves             PUT/DELETE /:id
POST   /api/v1/teacher-leaves/:id/approve | reject
```

Sections (M06 surface, extended): `classTeacherId` on create/update; lists include `classTeacher`.

New permission codes (13): `teacher.view|create|update|delete|status`, `teacher.qualification.manage`, `teacher.document.manage`, `teacher.subject.assign`, `teacher.assign`, `teacher.assign.override`, `teacher.leave.manage`, `teacher.leave.approve`, `teacher.evaluation.manage`. Principal gains all but delete; Vice Principal `view/assign/leave.approve`; the Teacher role gains `teacher.view` (colleague directory).

## Frontend Pages Created

- `/admin/teachers` — list (designation/department/expertise-subject/status filters, CSV export) with header links to the matrix and leave inbox.
- `/admin/teachers/new` — multi-section form (Account/Personal/Employment incl. salary grade + MPO index + specialization/Address).
- `/admin/teachers/[id]` — tabs: **Profile** (edit/photo/delete), **Qualifications**, **Subjects** (expertise checkboxes), **Assignments** (session-scoped slots — doubles as the interim Schedule view — + transfer-all dialog), **Leaves** (teacher-scoped), **Evaluations** (criteria from settings, overall = average), **Documents**.
- `/admin/teachers/assignments` — **assignment matrix**: class → section → curriculum subjects × teacher dropdowns (★ = expertise match, "Overridden" badge on mismatches, override confirm on 409) + session workload table.
- `/admin/teachers/leaves` — approval inbox (PENDING by default; record/approve/reject/delete).
- M06 section dialog now has a class-teacher picker + column; sidebar gains "Teachers" (`teacher.view`).

## Components Created (new shared/reusable only)

- `TIMETABLE_CONFLICT_CHECKER` DI token + no-op impl — the M13 hook interface.
- Frontend `LeavesTable` — shared by the inbox page and the detail tab.

## Business Rules Implemented

- One teacher per (session, section, subject); reassignment replaces with audit history.
- Class-teacher cap per session from `academic.max_class_teacher_sections` (default 1); only ACTIVE teachers.
- Approved-leave overlap blocked; leave range inside the current session; PENDING-only edits.
- Expertise-mismatch assignments need `teacher.assign.override`.
- Resign/terminate/delete blocked until current-session duties are transferred (bulk-transfer helper provided).
- Same M07 rules: age ≥ 18, joining ≤ today, email-or-phone, IDs never reused, status cascade deactivates the account (sessions revoked first).

## Known Limitations

- Schedule/workload are assignment-based until the timetable exists (M13): no periods/week, no time conflicts (hook is a no-op by design).
- Part-time teachers across shifts are allowed with no shift checks (per roadmap §8 — M13 handles time).
- `teacher_qualifications.document_url` is a reserved column; certificate scans go through the Documents tab for now.
- Leave self-service for teachers arrives with the portal (M18); today leaves are recorded by admins on their behalf.
- Evaluation criteria fall back to built-in defaults in the UI when the viewer lacks `settings.view`.
- In-browser photo/document upload click-through still pending (same status as M04/M07).

## Future Improvements

- M13: replace the no-op conflict checker; upgrade workload to periods/week; real schedule grid.
- M12: subscribe to `teacher.leave.approved` to mark Leave days.
- M21: migrate `teacher_leaves` into the HR leave system (balances, entitlements).

## Breaking Changes

- None. Sections API gains an optional field; existing payloads unaffected. `SectionsService` has two new constructor dependencies (its unit-test mocks were extended).

## Migration Steps

1. `npx prisma migrate deploy` (3 enums + 6 tables + sections FK).
2. `npm run seed` (syncs 13 new permission codes; extends Principal/Vice-Principal/Teacher core sets).
3. No env changes. Optional settings: `general.teacher_id_pattern`, `academic.max_class_teacher_sections`, `academic.teacher_evaluation_criteria`.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | none |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Create teacher → user (TEACHER) + teacher role + `-T-` ID in one tx | ✅ | e2e |
| Expertise mismatch → 409; override (with permission) → 201 | ✅ | e2e |
| Re-assigning a slot replaces the holder (single row) | ✅ | e2e |
| Workload + schedule endpoints | ✅ | e2e |
| Leave create/approve; overlap → 409; decided leaves immutable | ✅ | e2e |
| Class-teacher set; cap (1) blocks a second section → 409 | ✅ | e2e |
| RESIGNED blocked with duties → transfer (2 moved) → resign OK → user INACTIVE | ✅ | e2e |
| Permission guards (403 for unprivileged users) | ✅ | e2e |
| Qualification year > current → 400 | ✅ | e2e |
| Assignment matrix / leave inbox in-browser click-through | ⏳ | pending (validation + API layers e2e-tested) |

## Remaining TODOs

- [ ] In-browser click-through: assignment matrix, leave inbox, teacher photo/document uploads.
- [ ] M13 must replace the `TIMETABLE_CONFLICT_CHECKER` no-op provider.

## Links to Related Modules

- Depends on: Modules 06 (structure, subjects, sections), 07 (user-creation pattern, SequenceService, document/photo conventions).
- Unlocks / hooks completed for: **M12** (`teacher.leave.approved` event, teacher records for attendance), **M13** (conflict-checker DI slot, assignments to schedule), **M09** (pattern proven twice — students next), **M21** (leaves to migrate, salary grade/MPO fields), **M06 debt closed** (`sections.class_teacher_id` FK).
- `PROJECT_CONTEXT.md` sections updated: §5 (timetable hook row), §8 (teachers in the entity spine), §16 (separate-table decision), §18 (debt updates).
