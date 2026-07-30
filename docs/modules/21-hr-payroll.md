# Module 21 — HR & Payroll · Completion Document

| | |
|---|---|
| **Module** | 21 — HR & Payroll |
| **Completion date** | 2026-07-29 |
| **Actual effort** | 1 dev-day (est. was 7) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 21 |

## Summary of Implemented Features

**The unified employee view (§1).** M07 and M08 deliberately kept
`staff_profiles` and `teachers` as separate tables so the two lifecycles
could stay independent. M21 is the module that finally has to look at
both as one workforce, and it does so through one narrow union
repository (`EmployeesRepository`) rather than importing StaffModule and
TeacherModule and stitching two shapes together at every call site — the
M12 `EmployeeDirectoryRepository` idea, widened.

**Leave, properly (§3/§4).** `leave_applications` **supersedes M08's
interim `teacher_leaves`**, and the migration copies every existing row
across before dropping the table. Three things changed with it:

- **It counts working days**, not calendar days. A leave spanning a
  weekend must not burn quota for days nobody was expected to work, so
  `CalendarService.workingDays` decides what a request costs.
- **It moves a balance.** `leave_types` is a table now — a taxonomy that
  carries an annual quota, a carry-forward rule and a paid/unpaid flag is
  data, not an enum — and approving decrements `leave_balances.used`
  inside the same transaction that flips the status. Withdrawing an
  approved leave gives the days back, which is why `CANCELLED` joined
  `leave_status_enum`: a person who withdraws is not a school that
  refused.
- **It covers staff.** The approval event carries a `personType`, so an
  office assistant's approved leave marks their attendance the same way a
  teacher's always has — something the teacher-only event could not
  express, and the reason staff leave used to leave the register showing
  them absent.

Yearly allocation is idempotent, never lowers an existing entitlement,
and carries unused days forward up to each type's cap. It runs nightly
rather than on a date somebody has to remember, because what it reacts to
is the *current session changing*.

**Salary structures and assignment (§3/§5).** A structure is a basic
figure plus allowance/deduction lines computed from it (flat, or a
percentage of basic — 0–100 enforced by a CHECK, the engine and the
builder). Assigning one to a person writes a **new** `employee_salaries`
row with an `effective_from` date and never edits the old one, so
regenerating March reads March's salary and a 1 July increment does not
restate the six payslips before it. Re-saving for the *same* date
replaces that row — `uq_employee_salaries_identity` — because "the salary
in force on 1 March" must have exactly one answer.

**The payroll run (§4/§6).** A straight line: DRAFT → GENERATED →
APPROVED → DISBURSED, with CANCELLED reachable from anywhere before the
money moves. Generation reads the salary in force, the staff attendance
register, approved leave and the month's bonus rounds, and computes every
payslip through the engines. Each step narrows what may change:
regeneration wipes and rewrites while DRAFT/GENERATED, APPROVED freezes,
and DISBURSED writes the provident-fund contributions and posts the
salary voucher.

**Accounting integration (§4).** On disbursement the run posts through
M20's `VoucherService.postAuto` with source `PAYROLL`, idempotent on
`payroll:<runId>`. The voucher is derived from four stored payslip
columns and **balances by algebra**, not by splitting:

```
  Dr Salary & Allowances   net + pfEmployee + tax − bonus
  Dr Festival Bonus        bonus
  Dr PF Contribution       pfEmployer
     Cr Provident Fund Payable   pfEmployee + pfEmployer
     Cr Tax Payable              tax
     Cr Bank / Cash              net
```

Solve those for the debit side and `salaryExpenseFor` falls out exactly —
which is why it keeps balancing after a payslip is edited by hand (the
edit moves `net`, and this moves with it), and why M20's
largest-remainder machinery is not needed here.

**Provident fund and tax.** The PF passbook is append-only with a running
`balance_after`, one CONTRIBUTION row per payslip behind
`uq_pf_ledger_payslip` (a doubled contribution would be invisible — the
passbook would simply look like a generous month). Tax is the "simple
slab config" the roadmap asks for: marginal bands on annualized monthly
taxable income, configurable per school, with `normalizeSlabs` *adding*
the open-ended band a hand-edited config forgot.

**Five reports + the bank advice**: monthly register, PF, tax deduction
summary, salary-grade distribution, YTD per employee — plus the bank
advice XLSX, from which held payslips are absent by construction.

**Portal self-service (§5).** `/portal/employee/*` serves teachers **and**
non-teaching staff: my leave with balances, apply, my payslips (disbursed
months only) and my own payslip PDF. Authorized by ownership like every
other portal route — the person is resolved from the logged-in account,
never from a parameter.

## Database Changes

Migration: `prisma/migrations/20260729120000_hr_payroll/migration.sql`.

**10 new tables** — `leave_types`, `leave_balances`,
`leave_applications`, `salary_structures`, `salary_components`,
`employee_salaries`, `payroll_runs`, `payslips`, `bonus_runs`,
`pf_ledger`.

**1 table dropped** — `teacher_leaves` (M08), after copying every row
into `leave_applications`.

**9 new enums** — `leave_applicable_to_enum`,
`salary_component_type_enum`, `salary_calc_enum`, `payment_mode_enum`,
`payroll_run_status_enum`, `payslip_status_enum`, `bonus_type_enum`,
`bonus_basis_enum`, `pf_entry_type_enum`. **2 altered** —
`leave_status_enum` gained `CANCELLED`, `settings_group_enum` gained
`payroll`. **1 dropped** — `leave_type_enum`.

**2 new columns** — `teachers.exit_date` and `staff_profiles.exit_date`.
M07/M08 recorded a status *change* but never the date it took effect, so
payroll had no way to prorate a leaver's final month (roadmap §8). The
status flow now stamps it on an exit status and **clears it** on a return
to ACTIVE — a re-hire carrying a stale exit date would have every future
payslip prorated to nothing, silently.

**7 partial unique indexes** — `uq_leave_types_code`,
`uq_leave_balances_identity`, `uq_salary_structures_name`,
`uq_employee_salaries_identity`, `uq_payroll_runs_month` (excludes
CANCELLED, so a cancelled run frees the month — the M11 rule),
`uq_payslips_person`, `uq_pf_ledger_payslip`.

**16 CHECK constraints**, each asserted in the e2e suite to actually
reject its row. The ones worth naming:

| Constraint | What it prevents |
|---|---|
| `chk_payroll_runs_month_first` | `month` not on the 1st, which would make `uq_payroll_runs_month` compare something other than what it claims — 2027-03-01 and 2027-03-15 as two different Marches |
| `chk_leave_applications_range` | end before start; a "half day" spanning a fortnight consuming 0.5 of quota for two weeks off |
| `chk_payslips_status_evidence` | a HELD payslip with no reason, a PAID one with no timestamp (the M16/M17/M20 evidence rule) |
| `chk_pf_ledger_amounts` | a fund paying out more than it holds |
| `chk_salary_components_value` | a percentage of basic above 100 |
| `chk_teachers_exit_after_joining` | an exit before the joining date |

## API Endpoints Added

```
GET    /api/v1/employees
GET    /api/v1/employees/:personType/:personId/salary
PUT    /api/v1/employees/:personId/salary
DELETE /api/v1/employees/salary/:id
GET    /api/v1/employees/:personType/:personId/payslips

CRUD   /api/v1/leave-types
CRUD   /api/v1/leave-applications  (+ /:id/approve|reject|cancel)
GET    /api/v1/leave-balances/:personType/:personId
POST   /api/v1/leave-balances/allocate | /adjust

CRUD   /api/v1/salary-structures    POST /api/v1/salary-structures/preview

POST   /api/v1/payroll-runs         GET /api/v1/payroll-runs[/:id][/payslips]
POST   /api/v1/payroll-runs/:id/generate|approve|disburse|cancel
GET    /api/v1/payroll-runs/:id/bank-advice.xlsx
GET    /api/v1/payslips/:id         PATCH /api/v1/payslips/:id
POST   /api/v1/payslips/:id/hold|release      GET /api/v1/payslips/:id/pdf
CRUD   /api/v1/bonus-runs

GET    /api/v1/payroll/reports/register|pf|tax|grades|ytd  (+ .xlsx, register also .pdf)
GET    /api/v1/payroll/pf/:personType/:personId     POST /api/v1/payroll/pf

GET    /api/v1/portal/employee/me|leaves|leave-balances|payslips
POST   /api/v1/portal/employee/leaves
GET    /api/v1/portal/employee/payslips/:id/pdf
```

**Removed:** `CRUD /api/v1/teacher-leaves` (+ `/approve`, `/reject`) —
see *Breaking Changes*.

## Frontend Pages Created

- `/admin/hr` — five tabs: **Employees** (the unified list + the salary
  assignment drawer), **Leave** (the inbox over teachers and staff, the
  apply dialog with a live balance strip, yearly allocation), **Salary
  scales** (the builder with a live preview), **Payroll** (months +
  bonus rounds), **Reports** (register / PF / tax / grades, with exports).
- `/admin/hr/payroll/[id]` — the run wizard: a stepper that shows the
  four states as four decisions, the review grid with a per-person
  expandable breakdown, adjust-with-reason, hold/release, approve,
  disburse, bank advice.
- Rebuilt: the teacher-detail **Leaves** tab (now over the unified table,
  with a balance strip), and the portal **My leaves** panel; added the
  portal **My payslips** panel.
- Removed: `/admin/teachers/leaves` (the M08 teacher-only inbox).

## Components Created (new shared/reusable only)

None. The workspace is built from the existing shared kit (`DataTable`
was not needed — every grid here is a fixed-column review table),
`Can`, `ConfirmDialog`, `StatCard`, `PageHeader`, `EmptyState`.

## Business Rules Implemented

- **One live payroll run per month**; regeneration only while DRAFT or
  GENERATED, and it wipes and rewrites rather than diffing.
- **An approved payroll is frozen** — corrections go on next month's run
  as an adjustment line (§6), the same rule as a published result or a
  posted voucher.
- **HELD payslips** are excluded from the disbursement, the bank advice
  *and* the voucher until released.
- **Absent deduction** = base ÷ working days × absent days, where the
  base is BASIC or GROSS by setting — and the per-day rate always divides
  the **full** monthly figure, so one absence costs the same whether you
  joined on the 1st or the 15th.
- **A day covered by approved leave is never also an absence**, however
  the register marked it; and an **unmarked** working day is treated as
  present, because recording an absence is the register's job (the M15
  "a missing mark is never a zero" rule).
- **Paid leave costs nothing; unpaid leave deducts** at the same per-day
  rate. Where a date is covered by both a paid and an unpaid approval,
  paid wins.
- **Provident fund follows the pay scale, not the attendance register**:
  it is computed on the earned PF base before absence deductions, which
  is how a BD school administers a fund.
- **Festival bonus** eligibility is a minimum service length, with an
  optional prorated share for somebody short of it; a round is a *rule*
  resolved per person at generation, so hiring in March still gets the
  Eid bonus right.
- **Net pay is non-negative by construction**, not by a floor: the
  discretionary deductions absorb whatever room is left, so the payslip's
  own lines keep adding up to its total and the voucher keeps balancing.
- **Rounding is an explicit line.** The adjustment is recorded so the
  document still reconciles.

## Permissions & Settings

**20 new permission codes** in two groups. Leave and payroll are two
different desks, and the split encodes it:

- `hr.*` — `hr.view`, `leave.type.manage`, `leave.apply`,
  `leave.approve`, `leave.approve.override`, `leave.balance.manage`.
- `payroll.*` / `salary.*` — `salary.view`, `salary.structure.manage`,
  `salary.assign`, `payroll.view`, `payroll.generate`,
  `payroll.generate.force`, `payroll.approve`, `payroll.disburse`,
  `payroll.payslip.edit`, `payroll.payslip.hold`, `bonus.manage`,
  `pf.manage`, `payroll.report`, `payroll.export`.

**Separation of duties**, the M16/M20 encoding continued: the
**Accountant** computes the payroll (`payroll.generate`,
`payroll.payslip.edit`, `payroll.disburse`, `pf.manage`, the reports) but
holds **neither `payroll.approve`** — the person who computed a payroll
must not be the one who signs it off — **nor `salary.structure.manage` /
`salary.assign`**, because what a teacher is paid is set by the head, not
by whoever pays it. The **Principal** holds the whole set. The **Vice
Principal** works the leave inbox and nothing else; **Office Staff** may
file leave on somebody's behalf but not approve it.

**Retired:** `teacher.leave.manage` and `teacher.leave.approve` (the
seeder flags them orphaned, never deletes them — the M03 rule).

**23 new `payroll.*` settings**, including the tax slab table, both PF
percentages and their base, the absent-deduction base, the working-day
source, and the net-pay rounding unit.

## Known Limitations

- **Tax is a slab calculator, not a tax engine** (PROJECT_CONTEXT §17):
  no investment-rebate schedules, no separate slabs by gender or age, no
  minimum-tax floor. It also **annualizes the current month** rather than
  tracking year-to-date, which is exact for a steady salary and slightly
  out either side of a mid-year increment — the employee settles it on
  their own return.
- **The approver chain is one step.** `approver_chain` is a JSON array so
  a multi-step chain needs no migration, but the flow today records one
  decision.
- **No leave calendar view.** Roadmap §5 asks for a "team calendar"; the
  inbox and the per-person balance strip are shipped, the month grid is
  not.
- **Payslip/register PDFs are plain pdfkit output** — unbranded, and the
  default font cannot set Bangla (the limitation flagged since M09 ID
  cards). `name_bn` is stored and returned but never printed.
- **The leave attachment is a URL column, not an upload** (the same gap
  M19 has for content images and M20 for voucher attachments).
- **Ad-hoc payslip lines are added through the adjust dialog**, one at a
  time; there is no bulk "add this allowance to twelve people" tool.
- **`AttendanceReportsService` is not consumed** — payroll reads the
  `staff_attendances` rows directly, because it needs per-day statuses
  rather than the report's percentages.

## Future Improvements

- Year-to-date tax tracking, and the BD rebate schedule.
- A leave calendar (who is away this week) and a multi-step approver
  chain.
- Loan/advance management, so a recurring recovery is a schedule rather
  than an ad-hoc line every month.
- Increment/promotion workflow on top of the salary history the schema
  already keeps.
- Payslip email (SMS is live; the PDF is portal-only today).

## Breaking Changes

**The M08 leave surface is gone.** `teacher_leaves`, `/teacher-leaves`,
`TeacherLeavesService`, `LeaveType` (the enum) and the
`teacher.leave.approved` event no longer exist. This is the roadmap's own
instruction (§3: "supersedes Module 08 interim table (migration moves
data)"), and it is what makes leave cover non-teaching staff at all.

Who must react:

| Caller | What changed |
|---|---|
| Anything hitting `/teacher-leaves` | Use `/leave-applications` with `personType` + `personId` and a `leaveTypeId` (the type is a row, not an enum value) |
| `teacher.leave.approved` listeners | Listen to `hr.leave.approved` (`modules/hr/events/hr.events.ts`); the payload carries `personType`/`personId` and the leave type's name and paid flag |
| Roles carrying `teacher.leave.manage` / `teacher.leave.approve` | Grant `leave.apply` / `leave.approve`. The old codes are orphan-flagged and denied |
| `PortalLeaveDto` consumers | `type` (enum) → `leaveTypeId` (uuid); `reason` is now required |
| `GET /portal/teacher/leaves` | Still there, still an array — but of the new application shape. `/portal/employee/leaves` is the successor and serves staff too |

Every existing `teacher_leaves` row is copied into `leave_applications`
with its status, reason, approver and dates. Migrated rows keep a
**calendar-day** count, because the working-day calendar they were taken
against is not reconstructible after the fact and inventing a figure now
would silently restate how much quota a past leave consumed.

## Migration Steps

1. `npx prisma migrate deploy` — creates the ten tables, adds
   `exit_date` to both employee tables, seeds the six default leave types
   per school, **copies `teacher_leaves` across, then drops it**.
2. `npm run seed` — syncs the permission registry (198 codes; the two
   `teacher.leave.*` codes become orphaned) and inserts any missing
   default leave types.
3. Review `payroll.*` settings before the first run — in particular
   `payroll.pf_enabled`, `payroll.tax_enabled` (both **off** by default,
   so a school that does not operate a fund or deduct TDS needs no
   configuration) and `payroll.rounding`.
4. Build the salary scales, assign them, then open the first month.
5. Optional: `POST /leave-balances/allocate` for the current session, or
   wait for the nightly job.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. Every knob is a `payroll.*` school setting |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Migration replays onto an empty Postgres 16 | ✅ | Full 20-migration chain, then `migrate diff` reports **no difference** |
| Migration applied to the Neon dev DB | ✅ | Zero drift; seeder idempotent afterwards |
| `teacher_leaves` data copied then dropped | ✅ | Asserted in e2e: neither the table nor `leave_type_enum` exists |
| Leave: working-day counting, overlap, quota, override | ✅ | e2e, 8 cases |
| Approve → attendance marked LEAVE | ✅ | e2e polls for the fire-and-forget listener |
| Withdraw an approved leave → days returned | ✅ | e2e |
| Payroll: generate → adjust → approve → disburse | ✅ | e2e, full lifecycle |
| Salary voucher balances to the paisa | ✅ | e2e sums both sides of the posted voucher |
| Held payslip excluded from pay and voucher | ✅ | e2e |
| Trial balance still balances after the salary post | ✅ | e2e reads M20's report |
| 16 CHECK constraints each reject a bad row | ✅ | e2e, 8 representative cases |
| Portal: own payslips only, colleague's refused | ✅ | e2e 403 |
| Backend unit | ✅ | **1255 / 97 suites** (+111 net) |
| e2e | ✅ | **526 tests / 21 suites** (+52 net) |
| Frontend unit | ✅ | **302** (+22 net) |
| `tsc --noEmit`, `eslint`, `next build` | ✅ | Both repos clean; `/admin/hr` and `/admin/hr/payroll/[id]` emitted |
| In-browser click-throughs | ⬜ | Deferred — see *Remaining TODOs* |

### What verification found

**A DI gap `tsc` structurally cannot see.** `EmployeePortalService`
injects `HrSettingsService`, which `HrModule` provided but did not
**export**. The backend compiled cleanly and then *every* e2e suite
failed to boot. This is precisely the M18 `NotificationsRepository`
lesson repeating: **Nest DI is a runtime graph**, and the only thing that
catches a missing export is actually starting the application.

**A real design flaw in session resolution.** Leave was pinned to the
**current** session, carried over from M08. That was fine while leave was
a note on a teacher's record; it is wrong once leave consumes a
per-session balance, because it refuses a leave taken in the last weeks
of an outgoing session (before the head activates the new one) and would
silently charge a next-session leave against this session's quota.
`sessionCovering` now resolves **the session that covers the dates**,
preferring the current one when it qualifies.

**A response-shape mismatch.** `GET /portal/teacher/leaves` started
returning the paginated envelope object instead of an array, because the
service passed `LeaveService.list` straight through. Caught by the M18
portal suite, which asserts the shape — the same class of bug as the M18
double-unwrap.

## Remaining TODOs

- [ ] In-browser click-throughs: the structure builder with eight
      components, the payroll review grid at 80 employees, a payslip
      printed on A5, the bank advice opened in Excel, and the portal
      payslip list on a phone.
- [ ] Decide whether the leave **team calendar** (§5) is wanted before
      Phase 2 closes.
- [ ] Year-to-date tax tracking (see *Known Limitations*).
- [ ] Payslip email alongside the SMS.

## Links to Related Modules

- **Depends on:** Module 07 (staff), 08 (teachers), 12 (the attendance
  register + `StaffAttendancesRepository`, exported for exactly this),
  20 (`VoucherService.postAuto`), plus 05 (`CalendarService.workingDays`,
  the denominator of every proration) and 17 (the payslip SMS).
- **Supersedes:** Module 08's interim `teacher_leaves` — the roadmap's
  own plan, executed with a data migration.
- **Extends:** M07/M08 with `exit_date`; M12's attendance listener now
  marks **staff** leave too; M20's `SYSTEM_SLOTS` gained six payroll
  slots (all resolving to accounts the seeded 61-account chart already
  carries, so payroll posts correctly on a fresh school with nothing
  configured); M18's reports hub gained five entries and the portal
  gained the employee self-service panels.
- **Unlocks:** Module 29 (Reports & Analytics v2 lists 21 as a hard
  dependency — the payroll data is now there to analyse).
- **`PROJECT_CONTEXT.md` sections updated:** §5 (shared services), §8
  (entity spine), §11 (global business rules), §16 (decisions), §18
  (technical debt).
