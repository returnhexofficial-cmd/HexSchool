# Module 11 — Enrollment & Promotion · Completion Document

| | |
|---|---|
| **Module** | 11 — Enrollment & Promotion |
| **Completion date** | 2026-07-21 |
| **Actual effort** | 1 dev-day (est. was 4) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 11 |

## Summary of Implemented Features
- **Enrollment master** (`enrollments`): binds a student to a (session, class, section, group, shift) with a roll number. One live enrollment per student per session and roll-unique-per-section are enforced by hand-written **partial unique indexes** (`WHERE deleted_at IS NULL AND status <> 'CANCELLED'`), so a CANCELLED enrollment frees both the session slot and the roll for a re-enrollment. `class_id` is denormalized from the section for fast roster/promotion queries.
- **Single & bulk enroll**: `POST /enrollments` (auto-assigns the next roll when omitted, or takes an explicit roll) and `POST /enrollments/bulk` (enrolls many into one section, skipping already-enrolled students with a per-student reason report). Roll strategies: `NEXT` (input order) / `ALPHABETICAL` (by name).
- **Capacity enforcement**: section capacity is a hard gate at enrollment; exceeding it requires `overrideCapacity=true` **and** the `enrollment.capacity.override` permission (runtime check, Super Admin bypasses) — same pattern as the M08 assignment override.
- **Section transfer** (`POST /enrollments/:id/transfer-section`): moves a student to another section of the **same class and session**; keeps the roll if free in the target, otherwise auto-reassigns. Every transfer writes an append-only `enrollment_transfers` row (from/to section + roll).
- **Roll re-numbering** (`POST /enrollments/roll-assign`): renumbers a whole section 1…N by current roll order or by student name, using a **two-phase update** (park at negative temp rolls, then set finals) to slip past the partial-unique index during the shuffle.
- **Cancel** (`DELETE /enrollments/:id`): sets status `CANCELLED` (keeps the history row; frees the slot + roll).
- **Canonical roster queries** (exported for M12/M14/M16): `getSectionStudents(sectionId)` (ACTIVE roster in roll order) and `getStudentCurrentEnrollment(studentId, sessionId)`. Served over HTTP by `GET /sections/:id/students`.
- **Promotion wizard** (`promotion_batches` + `promotion_items`): build a DRAFT batch from a class→class mapping (one item per candidate, decision auto-filled: mapped→`PROMOTE`, mapped-to-nothing→`GRADUATE`, unmapped→`EXCLUDE`; editable per student), `preview` (decision counts + target-section distribution + missing-target warnings), `execute` (transaction: create new-session enrollments, close old ones as `PROMOTED`/`RETAINED`/`COMPLETED`, mark graduates `GRADUATED` with a status-history row), and `rollback` (delete the new enrollments, reactivate the old ones, revert graduations). `ROLLED_BACK`/`EXECUTED` statuses keep the audit trail.
- **M09 debt closed**: `POST /sections/:id/id-cards` — section-scoped batch ID cards, now that rosters exist.
- **M06 delete-guard extended**: deleting a section is blocked (409) while it has live enrollments.
- **Frontend**: `/admin/enrollments` (class+section picker reading the global session switcher → roster table with inline roll edit, transfer dialog, cancel, bulk-enroll picker, renumber, section ID cards) and `/admin/promotions` (batch list + new-batch dialog that auto-maps Class N → Class N+1) with a `/admin/promotions/[id]` wizard (per-student decision grid, preview card, execute/rollback/delete). New sidebar entries **Enrollment** and **Promotions**.

## Database Changes
Migration `20260721152208_enrollment_promotion`:
- **Enums**: `enrollment_type_enum` (NEW/PROMOTED/READMITTED/TRANSFERRED_IN), `enrollment_status_enum` (ACTIVE/TRANSFERRED_OUT/PROMOTED/RETAINED/COMPLETED/CANCELLED), `promotion_batch_status_enum` (DRAFT/EXECUTED/ROLLED_BACK), `promotion_decision_enum` (PROMOTE/RETAIN/GRADUATE/EXCLUDE).
- **Tables**: `enrollments` (soft-deletable, audit fields), `enrollment_transfers` (append-only log, no soft delete), `promotion_batches` (status-lifecycle, no soft delete), `promotion_items`.
- **Partial unique indexes** (hand-written): `uq_enrollments_student_session (student_id, session_id) WHERE deleted_at IS NULL AND status <> 'CANCELLED'`, `uq_enrollments_roll (session_id, section_id, roll_no) WHERE deleted_at IS NULL AND status <> 'CANCELLED'`.
- FK cascades chosen so e2e session/student teardown cascades cleanly (session/section/student → enrollments CASCADE; batch → items CASCADE; `promotion_items.from_enrollment` SET NULL).

## API Endpoints Added
```
GET    /api/v1/enrollments                       (filter session/section/class/student/status)
GET    /api/v1/enrollments/enrollable            (?sessionId=&search=  — picker source)
POST   /api/v1/enrollments                       (single enroll)
POST   /api/v1/enrollments/bulk                  (bulk by section)
POST   /api/v1/enrollments/roll-assign           (renumber a section)
GET    /api/v1/enrollments/:id
GET    /api/v1/enrollments/:id/transfers         (transfer history)
PUT    /api/v1/enrollments/:id                   (roll / optional subject / group / shift)
POST   /api/v1/enrollments/:id/transfer-section
DELETE /api/v1/enrollments/:id                   (cancel)
GET    /api/v1/sections/:id/students             (canonical roster)
POST   /api/v1/sections/:id/id-cards             (section batch ID cards — M09 debt)
GET    /api/v1/promotions
POST   /api/v1/promotions                        (build DRAFT batch)
GET    /api/v1/promotions/:id
GET    /api/v1/promotions/:id/preview
PUT    /api/v1/promotions/:id/items              (edit decisions, DRAFT only)
POST   /api/v1/promotions/:id/execute
POST   /api/v1/promotions/:id/rollback
DELETE /api/v1/promotions/:id                    (delete DRAFT)
```
10 new permission codes: `enrollment.view|create|update|delete|transfer|capacity.override|roll.assign`, `promotion.view|manage|execute`. Granted to Principal (all), Admission Officer (view/create/roll.assign), Vice Principal (view/create/transfer/roll.assign + promotion view/manage), Teacher (view).

## Frontend Pages Created
- `/admin/enrollments` — section-scoped enrollment manager (roster, enroll picker, transfer, roll edit, renumber, cancel, ID cards).
- `/admin/promotions` — promotion batch list + new-batch dialog.
- `/admin/promotions/[id]` — promotion wizard (decision grid, preview, execute, rollback, delete).

## Components Created (new shared/reusable only)
- None. Reused `DataTable`/`FormDialog`/`ConfirmDialog`/`PageHeader`/`EmptyState`/`ErrorState`/`Can` and the M05 session switcher.

## Business Rules Implemented
- One live enrollment per student per session (DB partial unique + service pre-check); roll unique per section (DB partial unique).
- Section capacity enforced; override needs `enrollment.capacity.override`.
- Transfer target must be the same class + session; roll kept if free else reassigned.
- Optional (4th) subject validated against the class's optional `class_subjects` for the session (group-aware).
- Promotion: PROMOTE/RETAIN create a new-session enrollment; final class (mapped to no target) GRADUATEs the student; EXCLUDE is a no-op; execution is transactional and a batch executes only once (DRAFT gate); rollback only from EXECUTED.
- Deleting a section is blocked while it has live enrollments.

## Known Limitations
- **Promotion capacity**: promotion execution does **not** enforce target-section capacity (an administrative bulk op); capacity is enforced only on interactive enroll/transfer.
- **Rollback guard is a hook**: rollback is currently always allowed because attendance (M12) and marks (M15) tables don't exist yet — the guard point is marked in `PromotionService.rollback` and must start blocking once those modules land.
- **M10 ADMITTED backfill**: there is no dedicated "backfill" endpoint. Converted (ADMITTED) applicants become ACTIVE students with no enrollment, so they surface automatically in the `enrollable` picker and are enrolled via the normal single/bulk flow — the intended path (roadmap note: run M11 before the first real admission cycle).
- **`enrollmentDate` proration** for mid-year `TRANSFERRED_IN` students is stored but not yet consumed (attendance/fees proration arrives with M12/M16).
- In-browser click-throughs (enroll picker, promotion wizard, section ID cards) verified by e2e at the API layer; on-device UI walkthrough pending (same status as prior modules).

## Future Improvements
- Optional target-capacity warnings in the promotion preview.
- Server-side "promote next N from waitlist"-style bulk helpers if admission volume grows.
- Roll-drag reordering in the roster UI (currently renumber-by-strategy + inline edit).

## Breaking Changes
- None. Additive schema + new module. `SectionsService.remove` now 409s when a section has live enrollments (previously it soft-deleted unconditionally) — intended per roadmap M06 §6 / M11.

## Migration Steps
1. `cd hexschool-backend && npx prisma migrate deploy` (applies `20260721152208_enrollment_promotion`).
2. `npm run seed` (or let the app's RBAC sync run) to insert the 10 new permission codes and extend the system-role grants — idempotent.
3. `npx prisma generate` if developing locally (regenerates the client with the new models).

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Single + auto-roll enroll | ✅ | e2e: roll 1 then 2 |
| Duplicate session enrollment | ✅ | 409 |
| Capacity block + override | ✅ | 409 without override; admin override succeeds |
| Bulk enroll skips enrolled | ✅ | skipped report returned |
| Transfer reassigns taken roll | ✅ | keepRoll but taken → next roll; transfer log written |
| Renumber section | ✅ | 1…N sequential |
| Section roster | ✅ | `GET /sections/:id/students` |
| Section delete guard | ✅ | 409 with live enrollments |
| Promotion build → execute → rollback | ✅ | 6 promoted, new roster created, rollback restores |
| **In-browser QA (Playwright MCP, 2026-08-18)** | 🔶 | 4/5 scenarios; promotion deferred. **Closes the enrollment half of this doc's owed click-through**: after admitting an application the student surfaced in the enrollable picker (already-enrolled students did not), enrolling assigned roll 3, and the DB confirmed `NEW · ACTIVE · QA Class 6 §A`. Critically, admission created the student with **0 enrollments** — no silent auto-enrolment, exactly as designed. Promotion deferred to pass D/E: its rollback guard only bites once attendance (M12) and marks (M15) exist, so driving it now would prove only the happy path. See [`docs/qa/11-enrollment-promotion.md`](../qa/11-enrollment-promotion.md) and [`J1`](../qa/journeys/J1-admission-to-enrollment.md). |

## Remaining TODOs
- [ ] Start enforcing the promotion rollback guard once M12/M15 tables exist.
- [x] In-browser click-through of the **enrollment** UI — done 2026-08-18 (enrollable picker → enroll → roll assigned). Promotion still owed: deferred to pass D/E so the rollback guard can be tested once M12/M15 data exists.
- [ ] Consider target-capacity warnings during promotion preview.

## Links to Related Modules
- Depends on: Module 06 (sections/classes/class-subjects), Module 09 (students).
- Unlocks / hooks completed for: Module 12 Attendance, Module 14 Examination, Module 16 Fees (all key on `enrollment_id` via the canonical roster queries). Closed the M09 section-scoped batch ID-card debt and the M06 section delete-guard debt. Serves the M10 ADMITTED-student backfill via the standard enroll flow.
- `PROJECT_CONTEXT.md` sections updated: §5 (canonical roster service), §8 (entity spine), §16 (decisions).
