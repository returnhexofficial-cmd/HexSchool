# QA — Module 03: Authorization, Roles & Audit Logging

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/03-authorization-audit.md`](../modules/03-authorization-audit.md).

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M03-01 | `/auth/me` returns real permission codes | ✅ | `userType: SUPER_ADMIN`, **292** codes incl. `role.create/update/delete/view/permission.assign` |
| M03-02 | Admin shell renders permission-gated sidebar | ✅ | 37 `<Can>`-gated items; header "Signed in as admin@hexschool.local (SUPER_ADMIN)" + Devices / Password / Sign out |
| M03-03 | Roles list shows all 11 system roles + counts | ✅ | Super Admin 294/1 user, Admin 294, Principal 246, Vice Principal 78, Office Staff 68, Accountant 53, Teacher 27, Admission Officer 21, Librarian 15, Student 0, Parent 0 — all badged **System** |
| M03-04 | Roles table search / sort / paging / export | ✅ | Sortable headers, `20 / page`, Previous/Next, "Page 1 of 1", Export CSV |
| M03-05 | System roles expose **no** delete control | ✅ | Action cell empty for every `isSystem` row |
| M03-06 | Slug must be kebab-case (client-side) | ✅ | `QA Not Kebab Case` → **"Slug must be kebab-case, e.g. \"exam-controller\""**, dialog stays open |
| M03-07 | Create custom role | ✅ | `qa-playwright-probe` created → listed as **Custom**, 0 grants, 0 users, Delete action present |
| M03-08 | Delete custom role (soft) with confirm | ✅ | Dialog: *"Delete role \"QA Playwright Probe\"? This soft-deletes the role. Its slug becomes available again."* → toast **"Role deleted"**, list back to 11 |
| M03-09 | Audit log viewer renders + filters exposed | ✅ | Columns When/Action/Entity/Entity ID/User/IP; 20 rows/page; actions seen `LOGIN, LOGOUT, CREATE, UPDATE, DELETE`; Action + Entity-type + date filters present |
| M03-10 | Mutations produce audit rows | ✅ | `CREATE · Role · b79a5e02…` and `DELETE · Role · b79a5e02…` for the probe role, same entity id |
| M03-11 | JSON diff dialog + secret redaction | ✅ | `LOGIN · Auth` dialog, Field/Old/New table, **`password — "[REDACTED]"`** |
| M03-12 | **Role editor / permission matrix** (locked core codes, matrix search) | ✅ *(round 2)* | `/admin/roles/<super-admin-uuid>` renders "Super Admin · System", "Permissions 294 granted", **335 checkboxes** (292 permission rows + 43 module check-all headers) of which **292 are locked** on this system role — the documented extend-only behaviour — plus a "Filter permissions…" search. Unblocked by **F1** being cleared. |
| M03-13 | 403 for a user lacking a permission | ⚠️ **pass with defect** *(round 2)* | First run in the project's history — unblocked by the QA seed. Signed in as `librarian@qa.hexschool.local`: sidebar correctly narrows to **8 items** (super admin sees 37), the "New role" control is correctly absent, and `GET /roles` refuses with **"Insufficient permissions"**. But the *route* is not gated — see finding **F8**. |
| M03-14 | Optimistic-concurrency 409 on stale role save | ⬜ not run | No longer blocked — the editor is reachable. Needs two concurrent sessions to drive `expectedUpdatedAt`. |

---
