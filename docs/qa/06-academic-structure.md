# QA — Module 06: Academic Structure

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/06-academic-structure.md`](../modules/06-academic-structure.md).

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M06-01 | Structure masters render; classes carry `name_bn` | ✅ | Classes/Subjects/Departments/Shifts/Groups tabs; `QA Class 6` with Bangla name |
| M06-02 | Class detail tabs, session-scoped sections | ✅ | Sections + Subjects tabs; sections listed for the *selected* session |
| M06-05 | Duplicate section refused with a precise message | ✅ | Toast **"Section "A" already exists for this class/session/shift"**; dialog held open, no row created |
| M06-06 | Section name length validated client-side | ✅ | 7 chars → "Max 5 characters", no request sent |
| M06-04 | **Clone-to-session preview + idempotency** *(owed click-through)* | ✅ | Preview counted **"1 section to create · 6 already present"** — exactly right; after cloning, re-preview read **"0 to create · 7 already present"**, proving "cloning twice is safe" |

### A false positive worth recording

Creating a second section named "A" **succeeded**, which looked like a missing
uniqueness constraint. It is not. The index is

```sql
uq_sections_identity ON sections
  (school_id, session_id, class_id, name, COALESCE(shift_id, '000…'))
  WHERE deleted_at IS NULL
```

— **shift is part of section identity**, so "6-A morning" and "6-A evening" are
legitimately different sections, which is exactly how a two-shift Bangladeshi school
works. Re-running the test with the same shift produced the correct 409. *Check the
constraint before filing a uniqueness bug.*

---
