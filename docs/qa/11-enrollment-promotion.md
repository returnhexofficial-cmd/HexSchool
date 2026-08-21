# QA — Module 11: Enrollment & Promotion

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc
[`docs/modules/11-enrollment-promotion.md`](../modules/11-enrollment-promotion.md).

Run 2026-08-18 as `admin@qa.hexschool.local`.

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M11-01 | Enrollment page is session-scoped | ✅ | Subtitle tracks the switcher: "Enroll and manage rolls for QA 2026" |
| M11-02 | Class → section roster loads with rolls | ✅ | `A (cap 30)` shows capacity; roster lists roll, UID, name, type, optional subject, and Roll / Transfer / Cancel actions |
| M11-03 | **Enrollable picker offers admitted-but-unenrolled students** *(owed click-through)* | ✅ | After admitting `ADM-26-000001`, the picker listed exactly `Tahmid Rahman · HEX-202600001` and **excluded** the two already-enrolled students in that section |
| M11-04 | **Enrolling assigns the next roll** | ✅ | "Enrolled 1 student(s)."; roster row `3 · HEX-202600001 · Tahmid Rahman · NEW`. DB confirms `roll_no 3, type NEW, status ACTIVE, QA Class 6 §A` |
| M11-05 | Promotion wizard | ⬜ **not run** | Needs a cohort worth promoting and the rollback guard, which only bites once attendance (M12) and marks (M15) exist. Sequenced with pass D/E rather than driven against an empty year |

**Closes the enrollment half of this module's owed click-through.** The promotion half
is deliberately deferred — see below.

See [`journeys/J1-admission-to-enrollment.md`](./journeys/J1-admission-to-enrollment.md)
for the full admission → enrollment chain this module terminates.

## Why promotion is deferred

The completion doc's own TODO says *"Start enforcing the promotion rollback guard once
M12/M15 tables exist."* The guard blocks a rollback once attendance or marks reference
the created enrollments — so promoting and rolling back today would exercise the
happy path only and prove nothing about the guard that matters. It is worth one
deliberate pass after M12 and M15 have data, alongside the year-rollover journey (J6).
