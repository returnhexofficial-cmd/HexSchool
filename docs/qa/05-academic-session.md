# QA — Module 05: Academic Session & Calendar

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/05-academic-session.md`](../modules/05-academic-session.md).

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M05-01 | Sessions list, status badges, correct per-row actions | ✅ | Current session offers only Edit; the COMPLETED one offers Make current / Edit / Delete. Dates render `2026-01-01`, no raw ISO |
| M05-04 | Activate flow + confirm copy + single-current invariant | ✅ | Dialog carries the scoping warning the roadmap requires; after confirming, roles swap cleanly and exactly one session is ACTIVE. Reversed it again to restore |
| M05-06 | Calendar month grid, views, iCal | ✅ | Sun–Sat grid, Month/List toggle, Today, iCal, Add holiday/Add event |
| M05-07 | Event end < start refused | ✅ | **"End date must not be before the start date"**, dialog held open, nothing written |
| M05-08 | Event created with a Bangla title | ✅ | `QA বার্ষিক ক্রীড়া প্রতিযোগিতা` 2025-06-20→22 stored against QA 2025, Bangla intact in the DB |
| M05-09 | **Switcher persists across reload** *(owed click-through)* | ✅ | Explicitly selected the **non-current** session, reloaded: switcher still showed it rather than snapping back to current. Persisted as `hs_academic_session:<userId>` — written on explicit selection, not on the default |
| M05-10 | Switching session re-scopes a page immediately | ✅ | `/admin/enrollments` subtitle tracked the switcher ("…rolls for QA 2026" → "…for QA 2025") with no reload |
| M05-11 | Calendar opens on a month inside the selected session | ⚠️→✅ | **Failed as finding F11**, fixed and re-verified: QA 2025 → January 2025, QA 2026 → August 2026 |
