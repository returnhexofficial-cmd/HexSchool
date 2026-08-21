# QA — Module 07: Staff & User Management

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/07-staff-users.md`](../modules/07-staff-users.md).

Run 2026-08-18 as `admin@qa.hexschool.local`.

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M07-01 | Staff list renders with the documented filters and export | ✅ | 6 seeded staff; designation / department / status filters and Export all present; no raw ISO dates |
| M07-02 | Staff detail page: all four tabs | ✅ | Profile · Documents · Roles · Activity |
| M07-03 | **Photo upload → MinIO** *(owed click-through)* | ✅ | Stored at `staff/<school>/<staff>/<uuid>.png`, **resized to 512×512**, signed URL 200 `image/png`, renders on the profile. Only the target staff row gained a `photo_url` |
| M07-04 | **Document upload → MinIO** *(owed click-through)* | ✅ | PDF stored at `staff/<school>/<staff>/documents/<uuid>.pdf`; signed URL (`X-Amz-…`) returns 200 `application/pdf`, **555 bytes — byte-exact**. Title kept Bangla: `QA NID Copy — জাতীয় পরিচয়পত্র` |
| M07-05 | Documents empty state | ✅ | "No documents uploaded yet (NID copy, certificates, CV, contract…)" |
| M07-06 | **RESIGNED cascades to the user account** | ✅ | The dialog warns up front ("RESIGNED and TERMINATED immediately deactivate the user account and sign out every device"). After applying, with a **live session deliberately created first**: `staff_status ACTIVE→RESIGNED`, `user_status ACTIVE→INACTIVE`, `live refresh tokens 1→0`, and a fresh login attempt returns **401 Invalid credentials**. Toast: "Status set to RESIGNED — the user account was deactivated." |

**Closes this module's owed click-through** — photo *and* document, both against MinIO.

## Observations, not defects

- The staff list has filters, pagination, sorting and export but **no free-text
  search**. The roadmap's M07 §5 asks only for "filters: designation, department,
  status; export", so this matches the module spec — but the Global Conventions say
  *every* list page ships search. Same gap as the sessions list (M05). Worth one
  decision for all list pages rather than a per-module finding.
- Document upload is a two-step flow: the button opens the OS file chooser **first**,
  then a dialog with Title and Type. Not obvious to automate — see `HARNESS.md`.
