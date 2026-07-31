# Module 25 — Transport Management · Completion Document

| | |
|---|---|
| **Module** | 25 — Transport Management |
| **Completion date** | 2026-07-31 |
| **Actual effort** | 1 dev-day (est. was 3) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 25 |

> **Build-order note.** M25 was built before M24 (Inventory). That is not a
> shortcut: `MODULE_DEPENDENCIES.md` makes M25's hard dependencies **09 and
> 16**, both long complete, and records that "24–28 are mutually
> independent and can run in any order". Nothing in this module reads or
> writes anything M24 will own.

## Summary of Implemented Features

**The fleet.** `vehicles` and `drivers`, each carrying the papers that
decide whether they may legally be on the road — fitness, tax token and
insurance for a bus, a licence for a driver. Their state is computed on
every read (`EXPIRED` / `DUE_SOON` / `UNKNOWN` / `OK`) and shown **in the
list**, not only in a nightly job, because an office that has to open a
row to discover its insurance lapsed last month will find out from the
police instead.

**Routes and stops.** A route is a named run with a vehicle, a driver, an
optional substitute (roadmap §8's temporary replacement) and a helper.
Its stops carry the pickup and drop times **and the monthly fare** —
distance is what a BD school charges for, so the fee lives on the stop,
never on the route. The stop sequence is drag-reorderable through a
two-pass update that cannot collide with its own unique index.

**Riders.** A student is put on a stop, keyed on **`enrollment_id`** like
every other academic record since M11. Over-capacity **warns**; a school
that means it turns on `transport.capacity_hard_block`, and
`transport.assign.override` is what gets past that. Suspending, resuming
and ending all write a **date**, not just a status — which is the whole
contract with M16.

**Fees.** The transport line reaches the monthly invoice through
`TRANSPORT_FEE_SOURCE`, a DI token bound **inside FeeModule**, prorated
against the rider's service window.

**Expenses.** Fuel, maintenance, repairs and tolls, posted to the M20
ledger as the system's **first auto-posted DEBIT voucher** (money going
out), with a cost-per-kilometre figure derived from odometer readings.

**Four reports** (roster / expenses / utilization / fee collection), the
daily document-expiry alert, and a portal panel that tells a parent which
bus, which stop, what time and whom to ring.

## Database Changes

Migration `20260731120000_transport_management`.

| Object | Count | Notes |
|---|---|---|
| Tables | 6 | `vehicles`, `drivers`, `routes`, `route_stops`, `transport_assignments`, `vehicle_expenses` |
| Enums created | 6 | `vehicle_type_enum`, `vehicle_status_enum`, `driver_status_enum`, `route_status_enum`, `transport_assignment_status_enum`, `vehicle_expense_type_enum` |
| Enums altered | 2 | `settings_group_enum` += `transport`; `voucher_source_enum` += `TRANSPORT` |
| Unique indexes | 8 | 7 hand-written partials + `uq_route_stops_route_stop` (the composite FK's target) |
| CHECK constraints | 7 | each individually probed — see *Verification* |
| Foreign keys | 15 | including one **composite** FK |
| Plain indexes | 10 | |

### The constraints worth explaining

| Object | What it makes true |
|---|---|
| `fk_transport_assignments_route_stop` `(route_id, stop_id) → route_stops(route_id, id)` | **A stop belongs to its route as a database fact.** A single-column FK on `stop_id` would happily accept a stop from a different route, and the office would find out when the driver's sheet printed a child waiting at a corner the bus never passes. Composite FKs are the one way to say "these two columns agree" without a trigger. |
| `uq_vehicles_reg_no` (`WHERE deleted_at IS NULL`) | Unique among **live** rows — the *opposite* of the M07 employee-ID / M09 student-UID / M23 accession rule, deliberately. Those numbers are issued **by the school** and printed on something; a plate is issued by the BRTA and belongs to the vehicle. Deleting a mis-typed row must free the plate to be entered correctly. |
| `uq_route_stops_order` (`route_id, display_order` among live rows) | The stop sequence **is** the route: it decides the order the sheet prints and the order the bus drives. Two stops at position 3 have no defined order — which is why reordering has to be a two-pass write (M11's renumber lesson). |
| `uq_transport_assignments_live` (`WHERE status IN ('ACTIVE','SUSPENDED')`) | One live assignment per enrollment. **SUSPENDED is included** because a suspended rider is still holding their place on the route; only ENDED frees the slot, so a family that comes back is never blocked by history. |
| `chk_transport_assignments_window` | Every way the billing window could come out backwards: `end_date < start_date`, `suspended_at < start_date`, `resumed_at < suspended_at`. The M22 `chk_assignments_window` situation, for money. |
| `chk_transport_assignments_status_evidence` | ENDED carries an end date, SUSPENDED carries a suspension date, and **ACTIVE may not carry a suspension date** — the M21 `exit_date` lesson pinned at the database: a status change with no date cannot answer "how much of March does this rider owe". |
| `chk_vehicle_expenses_shape` | `amount > 0`. An expense of zero is a receipt nobody keeps; a negative one is income entered in the wrong place, which would understate what the fleet costs in exactly the report this module exists to produce. |
| `chk_routes_shape` | A route may not list one person as both driver and substitute — the substitute exists *because* the driver is away, so the pair being equal means the route has nobody. |

`route_stops` is **soft-deleted** rather than hard-deleted like an M13
timetable cell, because an assignment points at it and a deleted stop
still has to be able to say what a rider was paying.

## API Endpoints Added

```
GET    /api/v1/transport/vehicles            transport.view
GET    /api/v1/transport/vehicles/:id        transport.view
POST   /api/v1/transport/vehicles            transport.vehicle.manage
PATCH  /api/v1/transport/vehicles/:id        transport.vehicle.manage
DELETE /api/v1/transport/vehicles/:id        transport.vehicle.manage
GET    /api/v1/transport/drivers[/:id]       transport.view
POST   /api/v1/transport/drivers             transport.driver.manage
PATCH  /api/v1/transport/drivers/:id         transport.driver.manage
DELETE /api/v1/transport/drivers/:id         transport.driver.manage
GET    /api/v1/transport/alerts              transport.view

GET    /api/v1/transport/routes[/:id]        transport.view
POST   /api/v1/transport/routes              transport.route.manage
PATCH  /api/v1/transport/routes/:id          transport.route.manage
DELETE /api/v1/transport/routes/:id          transport.route.manage
POST   /api/v1/transport/routes/:id/stops               transport.route.manage
PATCH  /api/v1/transport/routes/:id/stops/:stopId       transport.route.manage
DELETE /api/v1/transport/routes/:id/stops/:stopId       transport.route.manage
PUT    /api/v1/transport/routes/:id/stops/order         transport.route.manage

GET    /api/v1/transport/assignments[/:id]   transport.view
POST   /api/v1/transport/assignments         transport.assign
POST   /api/v1/transport/assignments/bulk    transport.assign
POST   /api/v1/transport/assignments/reassign            transport.assign
PATCH  /api/v1/transport/assignments/:id     transport.assign
POST   /api/v1/transport/assignments/:id/suspend|resume|end   transport.assign
GET    /api/v1/transport/students/:studentId transport.view

GET    /api/v1/transport/expenses[/:id]      transport.view
POST   /api/v1/transport/expenses            transport.expense.manage
PATCH  /api/v1/transport/expenses/:id        transport.expense.manage
DELETE /api/v1/transport/expenses/:id        transport.expense.manage

GET    /api/v1/transport/reports/roster/:routeId          transport.report
GET    /api/v1/transport/reports/roster/:routeId/export   transport.export  (xlsx)
GET    /api/v1/transport/reports/roster/:routeId/print    transport.export  (pdf)
GET    /api/v1/transport/reports/expenses[/export]        transport.report / .export
GET    /api/v1/transport/reports/utilization[/export]     transport.report / .export
GET    /api/v1/transport/reports/collection[/export]      transport.report / .export

GET    /api/v1/portal/transport                    ownership (no permission code)
GET    /api/v1/portal/parent/child/:childId/transport   ownership
```

## Frontend Pages Created

- `/admin/transport` — five tabs (**Routes & stops**, **Riders**,
  **Vehicles & drivers**, **Expenses**, **Reports**) with the expiry count
  as a clickable badge **in the page header**, because an expired fitness
  certificate is the one thing here that must not wait to be clicked on.
- `/admin/transport/[id]` — route detail: vehicle/crew cards, the capacity
  bar, timing warnings, and the stop list with ↑/↓ reordering and fare
  editing.
- **Transport tab on the student profile** (`/admin/students/[id]`,
  gated on `transport.view`) — the route, stop, fare and status, plus
  roadmap §5's assignment flow with the **fare-showing route→stop
  picker**. The picker shows the price beside every stop because *picking
  the stop is picking the price*, and it assigns the student's
  **enrollment**, resolved from the session switcher (the M11 rule).
- Portal: `transport-panels.tsx`, mounted on the student's own dashboard
  and under the parent's child switcher.

## Components Created (new shared/reusable only)

None. The module reuses `PageHeader`, `StatCard`, `EmptyState`,
`ErrorState`, `ConfirmDialog`, `Can` and the shadcn primitives; the
capacity bar and the monthly-spend bars are two `div`s each and did not
earn a shared component.

## Business Rules Implemented

1. **A rider's assignment is a service *window*, not a flag.**
   `[resumedAt ?? startDate, endDate ?? suspendedAt ?? ∞)`. M16 reads
   those four columns; the status is a label on top of them.
2. **The transport line is already prorated when M16 receives it**, and is
   therefore added with `prorated: false`. Enrollment proration and
   service-window proration answer different questions, and multiplying
   them would bill a mid-month joiner (21/31)² of the fare — an error
   nobody spots, because the number still looks plausible.
3. **Over capacity warns; it never structurally refuses** (roadmap §6). A
   40-seat bus carrying 41 children is a real thing that happens in
   Bangladesh, and a system that made it impossible to record would simply
   be lied to. `transport.capacity_hard_block` turns it into a *policy*
   refusal, and `transport.assign.override` is what gets past it — the
   M13/M14/M23 structural-vs-policy split.
4. **A SUSPENDED rider still holds their seat.** That is the point of
   suspending rather than ending: filling the seat means un-assigning
   somebody in three weeks.
5. **A route needs ACTIVE status and a vehicle before children go on it**
   — but a vehicle in **MAINTENANCE passes**, because the bus is back on
   Monday and the route still needs its riders on the list (roadmap §6).
6. **A stop with riders on it cannot be deleted**, and neither can a route
   — refused with a count. Deleting a stop would stop those families being
   billed *silently*, which is worse than an error message.
7. **A route split matches stops by NAME** (roadmap §8's "preserving fee
   continuity"): the family that boarded at Kazipara keeps paying the
   Kazipara fare. A rider whose stop has no counterpart on the destination
   is **reported, not moved** — dropping them on the first stop of the new
   route would change what they pay without anybody deciding to.
8. **A lapsed document is a warning, never a refusal** (roadmap §7). A bus
   whose tax token expired last month is a true fact; refusing to record
   it would leave the vehicle off the system entirely.
9. **A missing expiry date is not a valid one.** It reports `UNKNOWN` and
   appears in the alert list — the vehicle with no fitness date recorded
   is the single most likely one to be unfit.
10. **Distance comes from the gaps between odometer readings**, and a
    reading that goes backwards **breaks the chain** rather than producing
    a negative distance. `max − min` would silently include kilometres
    covered before the first receipt was entered, which is the direction
    that makes a school keep an expensive bus.
11. **A posted expense is not editable in place** — it is the source
    document behind a ledger entry (the M15/M16/M20 immutability rule).
12. **Separation of duties:** the **Office Staff** puts children on buses
    and may *not* overfill one (`transport.assign.override` is the head's);
    the **Accountant** records fuel and may *not* assign riders. The
    M16/M20/M21/M23 rule, continued into the fleet.

## Design Decisions

| Decision | Why, and what was rejected |
|---|---|
| `TransportFeeService` is bound to `TRANSPORT_FEE_SOURCE` **inside FeeModule** | The direction is forced, not chosen: TransportModule imports AccountingModule (the fuel voucher) and AccountingModule imports FeeModule, so FeeModule importing TransportModule would close a cycle. The service depends on `PrismaService` + `SettingsService` alone, so binding it in the consumer is free — the M13 `RoutineConflictChecker` / M23 `LIBRARY_CLEARANCE` shape. The token is **always bound**; a school with no routes gets an empty map. |
| Nothing in the fee source ever throws | A misconfigured fee head, transport switched off, a dropped connection — all return an empty map and log. The alternative is a school's entire monthly invoice run failing over a module it may not even use (M20's "an auto-post failure is logged, never rethrown", one level up). |
| The transport fee head resolves by **id, then by name** | The M20 posting-map fallback shape: a school that simply created a fee head called "Transport" bills correctly with nothing configured, and `transport.fee_head_id` pins it for a school that renamed theirs. |
| Suspension stores dates rather than a status alone | M21's `exit_date` lesson: M07/M08 recorded a status *change* but never its date, and payroll could not prorate a leaver's final month. Here the same gap would mean "how much of March does this rider owe" has no answer. |
| A suspend **and** resume inside one month bills from the resume date | One row cannot describe two windows, and this rounds in the rider's favour. Recorded as a limitation rather than modelled, because the alternative is a history table for an edge case a school hits once a year. |
| The stop, not the route, carries the fare | Two children on one bus pay different amounts depending on how far they travel — which is also why the "expected revenue" figure is per rider rather than route × price. |
| Reordering stops is a **two-pass** update | `uq_route_stops_order` is a live-rows unique, so writing 0…N over the top of the current order collides mid-way — M11's roll renumber exactly. `reorderPlan` parks every row above the route's range first. The park positions are **positive**, because `chk_route_stops_shape` requires `display_order >= 0` (M11 could use negatives; this table cannot). |
| Timing checks are **warnings**, never errors | A pickup sequence that goes 07:10, 06:50, 07:30 is usually a typo — but a route can genuinely double back, and refusing it would be wrong. |
| Deleting a posted expense does **not** cancel its voucher | `voucher.cancel` is a permission the transport desk does not hold (M20). Silently reversing a posted entry from a fleet screen is exactly the quiet restatement M20 exists to stop; the expense is soft-deleted and the accountant is told. |
| The portal projection is deliberately thin | Route, stop, two times, driver/helper phone, fare. No other rider's name, no capacity, no licence or fitness dates — the M19 rule that a read's SELECT list *is* the privacy policy. The driver's phone **is** included: a parent standing at a stop with a bus that has not come needs it, and it is printed on every roster the school hands out. |
| Document-expiry alerts go to the **office**, never to a parent | A family cannot renew a tax token. IN_APP by default (the M22/M23 channel rule); `transport.expiry_alert_channel` opts a school into SMS. |
| Driver `staff_id` is optional | A BD school's driver is as often on a contract with the transport contractor as on the payroll. Requiring the link would make the module unusable for the schools that do not employ their drivers. |

## Engines (dependency-free, golden-tested)

All five were written and passing (**111 tests**) before a service
existed, the M15/M22/M23 order.

| Engine | What it owns |
|---|---|
| `calc/transport-fee.engine.ts` | The service window, the days it covers in a month, and the prorated charge; `chargeDescription` (so a parent can see *why* one month is smaller) and `expectedMonthlyRevenue`. Reuses M16's `money.util`. |
| `calc/capacity.engine.ts` | The single seat verdict every "is there room" question funnels through — the route card's bar, the assignment endpoint's refusal and the utilization report all read it, so a greyed button, a 409 and a red bar cannot disagree (the M16 `deriveStatus` / M23 `canIssue` rule). A route with no vehicle reports `UNKNOWN`, never a capacity of zero. |
| `calc/expiry.engine.ts` | Document states, sorting (expired → due-soon → **unknown** → ok), the alert sentence and roadmap §7's past-date warnings. |
| `calc/expense.engine.ts` | Totals by type, gap-based distance with broken-chain detection, fuel and total cost per km, and the monthly series (which emits a **zero** row for a month nothing was spent — the inverse of the M18 attendance rule, because that zero is a fact rather than a gap). |
| `calc/route-plan.util.ts` | Plate normalisation, `HH:MM` parsing, the two-pass `reorderPlan`, stop-sequence warnings and the route's time window. |

## Known Limitations

- **A suspend-and-resume inside one calendar month bills only from the
  resume date.** The days before the suspension in that month are not
  charged. One assignment row describes one window; a second cycle in a
  different month is exact.
- **Transport fee collection is attributed pro rata.** Money is collected
  against an *invoice*, never against one line of it, so a family paying
  ৳3,000 of a ৳5,000 bill has not said which part was the bus. The figure
  is exact whenever an invoice is fully paid or fully unpaid — nearly
  every row.
- **The stop's fare is read live at billing time**; there is no snapshot
  on the assignment. Invoices already raised are unaffected (an invoice
  line is history, M16), but a fare edited mid-month changes what that
  month bills.
- **No GPS, no live tracking, no per-trip attendance.** Roadmap §25 does
  not ask for them; they are M32 territory.
- **`receipt_url` is a pasted URL, not an upload** — the media-library gap
  M19 (content images), M20 (voucher attachments), M21 (leave attachments)
  and M23 (`cover_url`) all carry.
- **The roster PDF is plain pdfkit output** and its default font cannot
  set Bangla — the limitation flagged since M09 ID cards. `name_bn` is
  stored and returned but never printed.
- **Deleting a posted expense leaves its voucher standing** (by design,
  above), so the accountant must reverse it deliberately.
- **The riders table is not virtualized** (the same 100+ row caveat
  M12/M15/M22/M23 carry), and the reassignment tool moves a whole route or
  a passed list of ids — there is no per-rider checkbox grid.
- **`transport.expiry_alert_channel` is school-wide**, so a school cannot
  yet have insurance alerts on SMS and licence alerts on the bell.

## Future Improvements

- Per-trip attendance (child boarded / did not board), which is what a
  parent actually wants an SMS about.
- A fare snapshot on the assignment, if a school ever needs "what this
  rider was promised" to survive a fare revision.
- Route optimisation / map drawing — the stops carry landmarks and could
  carry coordinates.
- A per-instalment view of transport dues on the family statement, once
  M27's clearance aggregates fees, library and hostel in one place.

## Breaking Changes

**None.** Every change is additive:

- `InvoiceService` gained a constructor dependency (`TRANSPORT_FEE_SOURCE`).
  It is bound in `FeeModule` itself, so no caller changes — but a test that
  constructs `InvoiceService` by hand must now pass a source (an object with
  `monthlyCharges()` returning an empty map is enough).
- `SYSTEM_SLOTS` gained `TRANSPORT_EXPENSE` (append-only, resolves to the
  already-seeded `5800 Transport Expense`).
- `voucher_source_enum` gained `TRANSPORT`; `settings_group_enum` gained
  `transport`. Both `ADD VALUE IF NOT EXISTS`.
- Two notification codes were appended (`TRANSPORT_DOCUMENT_EXPIRY`,
  `TRANSPORT_ASSIGNED`); the seeder created 4 template rows on the dev DB.

## Migration Steps

1. `npx prisma migrate deploy` — applies
   `20260731120000_transport_management`.
2. `npx prisma generate`.
3. `npm run seed` — syncs the 9 new permission codes into `permissions`,
   extends the Principal / Office Staff / Accountant baselines, and seeds
   the two notification templates. Idempotent.
4. Optional, per school: create a **Transport** fee head under Fees →
   Setup (or set `transport.fee_head_id`) before the first monthly
   invoice run. Without it the module works and simply bills nothing for
   transport — the run logs a warning naming the missing head.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. Everything configurable is a `transport.*` school setting. |

## Registries Extended

| Registry | Added |
|---|---|
| Permissions (9) | `transport.view`, `transport.vehicle.manage`, `transport.driver.manage`, `transport.route.manage`, `transport.assign`, `transport.assign.override`, `transport.expense.manage`, `transport.report`, `transport.export` |
| Role baselines | **Principal**: view, assign, **assign.override**, report, export · **Office Staff**: view, vehicle/driver/route manage, assign, report, export (deliberately *not* the override, *not* expenses) · **Accountant**: view, expense.manage, report, export (deliberately *not* assign) |
| Settings (12, group `transport`) | `enabled`, `fee_head_id`, `fee_head_name`, `auto_invoice`, `prorate_enabled`, `capacity_hard_block`, `expiry_alert_enabled`, `expiry_alert_days`, `expiry_alert_channel`, `expiry_repeat_days`, `notify_guardian_on_assign`, `auto_post_accounting` |
| Notification codes (2) | `TRANSPORT_DOCUMENT_EXPIRY`, `TRANSPORT_ASSIGNED` |
| M18 reports hub (4) | `transport.roster`, `transport.expenses`, `transport.utilization`, `transport.collection` |
| M20 `SYSTEM_SLOTS` (1) | `TRANSPORT_EXPENSE` → seeded account `5800` |

## Test Results

| Suite | Before | After | Delta |
|---|---|---|---|
| Backend unit | 1546 / 117 suites | **1691 / 119 suites** | **+145** (111 engine + 34 service) |
| Backend e2e | 644 / 23 suites | **699 / 24 suites** | **+55** (`test/transport.e2e-spec.ts`) |
| Frontend (vitest) | 374 / 34 files | **419 / 36 files** | **+45** |
| `tsc --noEmit` | — | clean, both repos | |
| `eslint` (new paths) | — | clean, both repos | |
| `next build` | — | compiles; emits `/admin/transport` and `ƒ /admin/transport/[id]` | |

## Verification

**Migration.** The full 22-migration chain replays onto an **empty**
Postgres 16 database and `migrate diff --from-config-datasource` reports
**"No difference detected."** The migration is applied to the local dev DB
and to the **Neon** dev DB (`migrate status` → "Database schema is up to
date!"), and both are seeded.

**Constraint probes.** Prisma's `migrate diff` cannot introspect partial
indexes, expression indexes or CHECKs, so each was asked to refuse a bad
row directly in SQL. Every one did:

| # | Probe | Refused by |
|---|---|---|
| 1 | the same plate twice, differently spaced and cased | `uq_vehicles_reg_no` |
| 2 | a bus with 0 seats | `chk_vehicles_shape` |
| 3 | the same licence number twice | `uq_drivers_license_no` |
| 4 | driver = substitute on one route | `chk_routes_shape` |
| 5 | two live routes with the same name | `uq_routes_name` |
| 6 | a negative fare | `chk_route_stops_shape` |
| 7 | two stops at position 0 | `uq_route_stops_order` |
| 8 | the same stop name twice on one route | `uq_route_stops_name` |
| 9 | a second live assignment for one enrollment | `uq_transport_assignments_live` |
| 10 | a stop from another route | `fk_transport_assignments_route_stop` |
| 11 | an end date before the start date | `chk_transport_assignments_window` |
| 12–14 | ENDED with no end date · SUSPENDED with no date · ACTIVE still carrying a suspension | `chk_transport_assignments_status_evidence` |
| 15–16 | an expense of zero · a negative odometer | `chk_vehicle_expenses_shape` |

The legal rows then went in unchanged.

## Bugs and lessons found during verification

**1. A test harness that ended every rider in the school.** The e2e suite
created its fourth rider *inside* the hard-block test, after a settings
call that was failing for an unrelated reason. When that call threw, the
fixture id was never set — and a later
`updateMany({ where: { enrollmentId: undefined } })` **matched every
transport assignment in the database** and ENDED them all. Prisma treats
an `undefined` filter as "no filter", so the delete guards then passed
(nobody was riding), the route was deleted, and eleven downstream
assertions failed in ways that pointed everywhere except the cause. The
fixture now lives in `beforeAll` and the `updateMany` asserts its id is
defined first. **The generalisable rule: an `undefined` in a Prisma
`where` is not a narrow filter, it is no filter — and in a test that means
the blast radius is the whole table.**

**2. The odometer warning compared a row with itself.** `create` wrote the
expense and *then* asked for the vehicle's history to compare against —
which by then included the row just written, so the "reading went
backwards" warning never fired. Found by the e2e case that asserts the
warning text. The history read now excludes the new row's id. The unit
tests could not see it: the engine is correct and was never wrong; the
defect was in what the service handed it.

**3. The suite would have failed every night between 18:00 and 24:00
UTC.** Its `day(offset)` helper built fixture dates from **UTC**, while
the server dates everything through `dhakaToday()` (UTC+6). For six hours
of every day the two disagree by one, and the run that crossed midnight
Dhaka proved it three ways at once: a "40 days ago" expiry read as 41, an
assignment created *today* was ended *yesterday* and
`chk_transport_assignments_window` refused it, and a rider who therefore
never ended still held a seat. `day()` now shifts into Dhaka before
slicing. This is the M23 `chk_book_issues_window` lesson in a new costume
— **never mix a client-side clock with a server-side one inside a single
row** — and the M18 attendance-on-Friday lesson's sibling: a suite that
passes at 14:00 and fails at 19:00 is not flaky, it is wrong.

**4. Two harness mistakes worth noting for the next module's suite.** The
settings endpoint takes the raw key/value map (`{ 'transport.x': true }`),
not a `{ values: … }` wrapper; and invoice generation is
`POST /invoices/generate`, not `/fee-invoices/generate`. Both produced
400/404s that read like module bugs.

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Full rider lifecycle through the API (assign → suspend → resume → end → re-assign) | ✅ | e2e, `the service window` block |
| Assign → monthly invoice carries a transport line at the stop's fare | ✅ | e2e; the line reads `Transport — … (Kazipara)` |
| Mid-month start → prorated line naming the served days | ✅ | e2e computes the expected paisa independently |
| Ended rider → next run bills nothing | ✅ | e2e |
| Over capacity warns; hard block refuses; override allowed for the head only | ✅ | e2e, three cases |
| Fuel receipt → DEBIT voucher, Dr transport expense / Cr cash, balanced | ✅ | e2e reads the voucher entries |
| Cost per km with a broken odometer chain | ✅ | e2e: 10,000 → 9,000 → 10,500 gives 1,500 km, 1 broken chain |
| Roster PDF downloads with guardian phones | ✅ | e2e asserts `application/pdf` and the phone column |
| Document-expiry job alerts once per window | ✅ | e2e runs it twice |
| Portal shows the child's route/stop/times and nothing else | ✅ | e2e asserts the absence of capacity and fitness data |
| In-browser click-through of `/admin/transport` | ⏳ | Not done — see Remaining TODOs |

## Remaining TODOs

- [ ] **In-browser click-throughs**: the route detail page's ↑/↓ reorder
      against a ten-stop route, the bulk "assign a section" dialog with a
      real roster, the monthly-spend bars, the driver's sheet printed on
      A4, and the portal panel on a phone viewport.
- [ ] Decide whether a school wants `transport.notify_guardian_on_assign`
      on by default once SMS credit behaviour is understood in production
      (it ships **off**).
- [ ] Per-trip boarding attendance, if a pilot school asks for it (M32).

## Links to Related Modules

- **Depends on:** Module 09 (students/guardians — the roster's phone
  column), Module 11 (`enrollment_id`, the key every rider hangs off),
  Module 16 (the fee head and the monthly batch), Module 20 (optional
  expense posting), Module 17 (alerts), Module 03 (permissions), Module 04
  (settings).
- **Hooks bound / consumed:** M20's `VoucherService.postAuto` (new
  `VoucherSource.TRANSPORT`, idempotent on `transport-expense:<id>`);
  M17's `NotificationService.send`; M18's reports hub and portal.
- **Hooks left for later:** none — this module leaves no no-op tokens.
- **Unlocks:** M26 (Hostel) reuses the `TRANSPORT_FEE_SOURCE` shape for
  hostel charges and the same `expiry.engine.ts` for its own documents;
  M27's clearance may aggregate transport dues beside fees, library and
  hostel; M29 gets route-level cost analytics.
- **`PROJECT_CONTEXT.md` sections updated:** §5, §8, §11, §16, §18.
