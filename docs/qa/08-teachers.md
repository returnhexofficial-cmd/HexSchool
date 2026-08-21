# QA — Module 08: Teacher Management

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/08-teachers.md`](../modules/08-teachers.md).

Run 2026-08-18 as `admin@qa.hexschool.local`.

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M08-01 | Teacher list renders, dates localised | ✅ | 2 seeded teachers; no raw ISO, no machine-locale dates |
| M08-02 | Teacher detail exposes all seven tabs | ✅ | Profile · Qualifications · Subjects · Assignments · Leaves · Evaluations · Documents — exactly roadmap §5 |
| M08-03 | **Assignment matrix renders subjects × teacher** *(owed click-through)* | ✅ | Class → section → grid of 4 subjects each with a teacher dropdown; **Science badged "Optional"** from its class-subject mapping |
| M08-04 | **Expertise override warns before assigning** | ✅ | Selecting a teacher without the subject in their expertise set raises: *"Rahim Uddin does not have this subject in their expertise set. Assign anyway (recorded in the audit log)?"* with Cancel / Assign anyway — roadmap §6 |
| M08-05 | **Assignment saves and is visible on both sides** | ✅ | Toast "Assignment saved"; the grid row shows the teacher plus an **"Overridden"** badge; the Workload panel updates live to `Rahim Uddin · QA-T001 · 1`; and the teacher's own Assignments tab lists `QA Class 6 · A · QA Morning · Bangla QA-BAN` |
| M08-06 | Assignment matrix refuses cleanly with no curriculum | ✅ | Before the seed carried class-subject mappings: *"This class has no subjects mapped for session QA 2026 — assign the curriculum first (Academic Structure → class → Subjects)."* An empty state that names the fix **and** where to do it |
| M08-07 | Teacher document upload → MinIO | ✅ | `teachers/<school>/<teacher>/documents/<uuid>.pdf`, signed URL 200 `application/pdf`, 555 bytes byte-exact; date rendered `18/08/2026` |
| M08-08 | Leaves tab renders balances and an accurate empty state | ✅ | Per-type balances plus "No leave on record — Applications filed for this teacher appear here", and a link to the leave inbox |
| M08-09 | **Leave approval inbox** *(owed click-through)* | ⏭ **deferred to pass I (M21)** | The inbox needs leave *applications*, which need per-employee per-session **leave balances** — M21/HR fixture territory, not M08's. The HR suite also carries two known failures in exactly this flow (**F10**) plus a fixture leak (**F12**), so the leave path deserves one deliberate pass rather than a half-driven one here |

**Closes the assignment-matrix half of this module's owed click-through**, plus the
teacher document upload. The leave inbox is sequenced into pass I with the rest of the
leave machinery.

## Seed gap found and fixed

The matrix could not be exercised at all on the first attempt: the QA seed created
subjects and classes but **no `class_subjects` mappings**, so every class had a
curriculum of nothing. The app was right to refuse; the fixture was wrong.

`demo-school.seeder.ts` now maps all four subjects onto each class **for both
sessions** — 24 mappings — with Science flagged `isOptional` so the NCTB optional-subject
rule (points above the bonus base, never in the divisor) has something to exercise
later. `class_subjects` cascades from the academic session, so the existing purge
already cleans it.

This unblocks more than M08: the timetable (M13), examinations (M14) and marks (M15)
all hang off the same mapping.
