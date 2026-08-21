# Browser QA

In-browser (real Chromium) QA of SMIS, driven through the **Playwright MCP server**
and locked in as a committed **Playwright suite**.

Jest/Vitest prove units and API contracts. This proves the app behaves in a browser —
and it is where the defects in [`FINDINGS.md`](./FINDINGS.md) came from.

## Where things live

| | |
|---|---|
| [`../../QA_RUNBOOK.md`](../../QA_RUNBOOK.md) | **Start here.** Cold-start the environment, seeded logins, gotchas, known non-bugs |
| [`FINDINGS.md`](./FINDINGS.md) | Every defect found, its diagnosis, and its state |
| [`HARNESS.md`](./HARNESS.md) | How to drive the browser: selectors, toasts, timing traps |
| `NN-*.md` | Per-module scenario results — one file per module, named to match [`docs/modules/`](../modules/) |
| [`screenshots/`](./screenshots/) | Curated evidence images, copied here deliberately and referenced from the module files |
| [`fixtures/`](./fixtures/) | Small inputs the upload scenarios need (`qa-logo.png`, `qa-staff-doc.pdf`) |

The `NN-*.md` names mirror `docs/modules/NN-*.md` exactly, so a module's QA results and
its completion doc are one filename apart.

## Coverage

| Module | Passed | Failed | Blocked | Not run |
|---|---|---|---|---|
| [01 — Project Setup & Core Infrastructure](./01-project-setup.md) | 9 | 0 | 0 | 1 |
| [02 — Authentication](./02-authentication.md) | 17 | 0 | 0 | 2 |
| [03 — Authorization, Roles & Audit](./03-authorization-audit.md) | 11 | 0 | 0 | 2 |
| [04 — School Setup & Settings](./04-school-setup.md) | 7 | 0 | 0 | 0 |
| [05 — Academic Session & Calendar](./05-academic-session.md) | 8 | 0 | 0 | 0 |
| [06 — Academic Structure](./06-academic-structure.md) | 5 | 0 | 0 | 0 |
| [07 — Staff & User Management](./07-staff-users.md) | 6 | 0 | 0 | 0 |
| [08 — Teacher Management](./08-teachers.md) | 8 | 0 | 0 | 1 |
| [09 — Student & Guardian Management](./09-students-guardians.md) | 14 | 0 | 0 | 0 |
| [12 — Attendance Management](./12-attendance.md) | 37 | 0 | 0 | 0 |
| [13 — Timetable & Routine](./13-timetable.md) | 24 | 0 | 0 | 0 |
| [10 — Admission Management](./10-admission.md) | 14 | 0 | 0 | 0 |
| [11 — Enrollment & Promotion](./11-enrollment-promotion.md) | 4 | 0 | 0 | 1 |

**M14–M29 not yet covered.** The order is the pass plan below.

### Cross-module journeys

| Journey | State |
|---|---|
| [**J1** — Admission → Enrollment](./journeys/J1-admission-to-enrollment.md) | ✅ done — the highest-risk seam; it holds |
| J2 session → attendance → exam → marks → publish → portal | ⬜ |
| J3 fee → payment → receipt → voucher → report | ⬜ |
| J6 year rollover (promotion + rollback) | ⬜ with pass D/E |

## Cross-cutting sweeps

Data-driven passes that are not tied to one module. These live in the committed suite
under `hexschool-frontend/e2e/sweeps/`.

| Sweep | State |
|---|---|
| **Permission matrix** — role × route, sidebar vs route vs API agreement | ✅ running (9 cases); guards **F8** |
| **Accessibility** — axe on the admin panel and the public site | ✅ running (13 cases); found **F13**, **F14** |
| **Localised dates** — no ISO date rendered on any admin page | ✅ running (9 cases); runtime guard for **F9/F18/F24** |
| **API contract fuzzing** — Schemathesis over the OpenAPI spec | ✅ run once read-only; found **F15**. Not yet a gate |
| Portal IDOR · multi-tenancy · session scoping · empty states · responsive · locale/print | ⬜ planned |

## The pass plan

Batches share fixtures, so they are QA'd together.

| Pass | Modules | State |
|---|---|---|
| A | 04 School Setup, 05 Session & Calendar, 06 Academic Structure | ✅ done |
| B | 07 Staff & Users, 08 Teachers | ✅ done |
| C | 09 Students & Guardians, 10 Admission, 11 Enrollment & Promotion | ✅ done — promotion deferred to pass D/E with journey J6 |
| D | 12 Attendance, 13 Timetable | ✅ done |
| E | 14 Examination, 15 Marks & Results | ⬜ next |
| F | 16 Fees, 20 Accounting | ⬜ |
| G | 17 Communication, 18 Portals & Dashboards | ⬜ |
| H | 19 Website CMS, 27 Documents & Certificates | ⬜ |
| I | 21 HR & Payroll, 22 Assignments | ⬜ |
| J | 23 Library, 24 Inventory, 25 Transport, 26 Hostel | ⬜ |
| K | 28 Complaint/Visitor/Alumni, 29 Reports & Analytics v2 | ⬜ |

After the per-module passes come the cross-module **journeys** (admission→enrollment,
marks→publish→portal, fee→voucher→report, year rollover) under `e2e/journeys/`.

## Running it

```bash
cd hexschool-frontend
npm run test:e2e                        # everything
npm run test:e2e -- --project=sweeps    # permission + a11y sweeps
npm run test:e2e:report                 # last HTML report
```

Prerequisites — the QA seed and both servers — are in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md). The suite will not pass without
`AUTH_THROTTLE_ENABLED=false` on the backend.
