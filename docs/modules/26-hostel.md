# Module 26 — Hostel Management · Completion Document

| | |
|---|---|
| **Module** | 26 — Hostel Management |
| **Completion date** | 2026-08-03 |
| **Actual effort** | 1 dev-day (est. was 3) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 26 |

## Summary of Implemented Features

The school's boarding house: the buildings, the rooms and the beds in
them, who sleeps where and from when, what the kitchen charges, who is
away, and what a family gets back when their child moves out.

**The module turns on one distinction and almost everything else falls
out of it: a hostel is BOYS or GIRLS, and a bed is the unit a boarder is
actually given.** The first makes the gender check possible at all — and
makes it *structural*, a refusal no permission reaches, because no school
means to put a boy in the girls' house. The second is why "is there room"
can be answered without anybody counting, why the occupancy grid is a
grid rather than a number, and why the composite foreign keys exist: a
bed belongs to a room belongs to a building, and every layer of that
chain is checked by Postgres rather than remembered by a service.

- **Buildings, rooms and beds.** Hostels carry a type, an optional warden
  from M07 and a *declared* capacity kept beside the real bed count
  rather than instead of it. Rooms carry the **seat rent** (an AC double
  and a six-bed shared room are not the same product — M25's fare-on-the-
  stop reasoning applied to a room) and generate their beds on creation.
- **Allocation** with the single `canAllocate` verdict, the two-tier
  structural/policy split, transfer, suspend, resume and vacate.
- **The mess**: per-hostel plans, boarders enrolled on them for a window,
  and a meal-off inbox with an approve/refuse decision that fixes which
  month's invoice carries the credit.
- **The M16 handoff**: two already-prorated invoice lines per boarder
  (seat rent and mess), with the meal-off credit netted into the mess
  line.
- **The deposit**, taken at allocation and returned at vacate, posted to
  M20's ledger as a matched pair of vouchers.
- **Four reports** (occupancy, resident register, fee dues, meal-off
  summary), all XLSX and the register also PDF, plus a portal panel the
  student and parent share.

### The decisions worth stating

**A residency is a *window*, not a flag** — `[resumed_at ?? start_date,
end_date ?? suspended_at ?? ∞)`. Suspending, resuming and vacating each
write a **date**, and M16 reads those four columns rather than the
status. This is M21's `exit_date` lesson and M25's service window, third
time: a status change with no date cannot answer "how much of March does
this boarder owe", and the seat rent is a monthly charge that has to be
prorated against something.

**A suspended boarder still holds their bed.** That is what suspending is
*for* — the child has gone home for a term and the school is keeping
their place — so `uq_hostel_allocations_live_bed` excludes only
`VACATED`. Filling the seat meanwhile would mean the office has to
un-house somebody in three weeks.

**`hostel_beds.status` is a SHADOW, and the index is the truth.** The
partial unique on `bed_id` is what makes one bed hold one boarder no
matter what a service forgets; the status column is written in the same
transaction so the occupancy grid can be drawn from one table instead of
a join (the M23 copy-status-shadows-a-reservation precedent). `MAINTENANCE`
is the one value that is genuinely the bed's own fact, and it is why the
column exists at all. A form may not hand-set `OCCUPIED` or `VACANT` —
that is exactly how a shadow starts lying.

**The hostel travels down the chain as a pinned column.** `hostel_id` is
denormalized onto `hostel_beds`, `hostel_allocations` and
`mess_enrollments`, each pinned by a **composite foreign key** to its
parent — the M25 `(route_id, stop_id)` technique, four times. The one
that pays for the scheme is `(hostel_id, plan_id)` on `mess_enrollments`:
a boarder in the boys' house may only eat on a boys'-house plan. Get that
wrong and **the invoice still balances — it is simply the wrong number,
on the wrong family's bill, for a kitchen that never cooked for them.**

**`credit_month` is decided once, at approval, and stored.** Roadmap §4
puts the meal-off credit on the *next* invoice, so approving computes the
month after the later of the last day away and the day of the decision,
and billing then reads a plain equality. The obvious alternative — a
"credited" flag the invoice run consumes — breaks on the first invoice
**preview**: a preview would eat the credit without raising a bill, and
the real run a minute later would find nothing to apply. Deciding the
month once makes the credit deterministic (regenerating a month gives the
same number) and means a request approved late is credited late rather
than lost.

**Roadmap §8's proration precedence, obeyed everywhere: the allocation
window first, then everything inside it.** The mess window is intersected
with the residency before it is prorated, and meal-off days are counted
only where they overlap the residency. A boarder who left on the 10th
cannot be credited for being away on the 20th, because they were not
being charged for the 20th — and a mess enrolment nobody closed is
bounded by the vacate date rather than billing on for ever.

**Two invoice lines, not one.** A hostel bill is a room charge and a food
charge; they move independently, they are often set by different people,
and a parent querying a bill asks about one or the other. Merging them
would also make the credit impossible to show, because a credit that
silently reduces a combined figure is indistinguishable from a mistake.
The credit is netted **into the mess head** rather than becoming a head
of its own, so a "credit" line never shows up in the school's fee reports
as an income line that is always negative.

**The deposit is the only money in this module the school does not
earn**, and that produces every rule around it: a refund never exceeds
what was taken, a deduction has to say what it is for, and a deposit may
not be returned to somebody still asleep in the bed it secures — all
three pinned by `chk_hostel_allocations_deposit` rather than remembered
by a service.

**Five dependency-free engines**, golden-tested — **116 tests before a
single service existed**. `calc/types.ts` holds hand-written string
unions and **no `calc/` engine imports `@prisma/client`** (the M24
lesson, applied from the start rather than learned again).

**11 permission codes, 15 `hostel.*` settings, 2 notification codes, 4
reports.** The **Office Staff runs the hostel and may neither hand a
deposit back nor override the dues gate**; the **Accountant returns the
deposit and may not give anybody a bed**; the **head holds the two
overrides**. The M16/M20/M21/M23/M24/M25 separation of duties, continued
into the boarding house.

## Database Changes

Migration `prisma/migrations/20260803120000_hostel_management/migration.sql`.

**7 tables**

| Table | Notes |
|---|---|
| `hostels` | `type` BOYS/GIRLS (no `MIXED` — the gender check has no meaning without it), optional M07 warden, declared `capacity` printed beside the real bed count and never used in a decision |
| `hostel_rooms` | carries the **seat rent**; `bed_count` is intent, the bed rows are fact, and the mismatch is *reported* rather than silently repaired |
| `hostel_beds` | `hostel_id` denormalized and pinned to the room's hostel; `status` is a shadow (see above) |
| `hostel_allocations` | keyed on **`enrollment_id`**; the four window columns; the deposit and its refund with both M20 voucher ids |
| `mess_plans` | per hostel; a monthly figure, not a menu |
| `mess_enrollments` | a window; **both** FKs composite over `hostel_id` |
| `meal_offs` | `credit_month` pinned to the 1st by CHECK |

**7 enums created** — `hostel_type_enum`, `hostel_status_enum` (shared by
hostels and mess plans, deliberately: both are things a school switches
off without deleting), `hostel_room_type_enum`,
`hostel_room_status_enum`, `hostel_bed_status_enum`,
`hostel_allocation_status_enum`, `meal_off_status_enum` (with
`CANCELLED` — the M21 rule that a family which withdraws is not a school
that refused).

**2 enums altered** — `settings_group_enum += 'hostel'`,
`voucher_source_enum += 'HOSTEL'`.

**11 unique indexes** — 4 plain composite-FK targets (declared in
`schema.prisma` *and* written in the migration, per the M24 drift rule),
and 7 hand-written partial uniques (migration-only):
`uq_hostels_name`, `uq_hostel_rooms_no`, `uq_hostel_beds_no`,
`uq_hostel_allocations_live_enrollment`,
`uq_hostel_allocations_live_bed`, `uq_mess_plans_name`,
`uq_mess_enrollments_live`.

**4 composite foreign keys** —
`hostel_beds(hostel_id, room_id) → hostel_rooms(hostel_id, id)`,
`hostel_allocations(hostel_id, bed_id) → hostel_beds(hostel_id, id)`,
`mess_enrollments(hostel_id, allocation_id) → hostel_allocations(hostel_id, id)`,
`mess_enrollments(hostel_id, plan_id) → mess_plans(hostel_id, id)`.

**10 CHECK constraints** — `chk_hostels_shape`,
`chk_hostel_rooms_shape`, `chk_hostel_beds_shape`,
`chk_hostel_allocations_window`,
`chk_hostel_allocations_status_evidence`,
`chk_hostel_allocations_deposit`, `chk_mess_plans_shape`,
`chk_mess_enrollments_window`, `chk_meal_offs_window`,
`chk_meal_offs_status_evidence`.

## API Endpoints Added

```
GET    /api/v1/hostels                              hostel.view
GET    /api/v1/hostels/:id                          hostel.view
POST   /api/v1/hostels                              hostel.manage
PATCH  /api/v1/hostels/:id                          hostel.manage
DELETE /api/v1/hostels/:id                          hostel.manage
GET    /api/v1/hostels/:id/rooms                    hostel.view
POST   /api/v1/hostels/:id/rooms                    hostel.manage
GET    /api/v1/hostels/rooms/:roomId                hostel.view
PATCH  /api/v1/hostels/rooms/:roomId                hostel.manage
DELETE /api/v1/hostels/rooms/:roomId                hostel.manage
POST   /api/v1/hostels/rooms/:roomId/beds           hostel.manage
PATCH  /api/v1/hostels/beds/:bedId                  hostel.manage
DELETE /api/v1/hostels/beds/:bedId                  hostel.manage

GET    /api/v1/hostel-allocations                   hostel.view
GET    /api/v1/hostel-allocations/:id               hostel.view
POST   /api/v1/hostel-allocations                   hostel.allocate
POST   /api/v1/hostel-allocations/bulk              hostel.allocate
PATCH  /api/v1/hostel-allocations/:id               hostel.allocate
POST   /api/v1/hostel-allocations/:id/transfer      hostel.allocate
POST   /api/v1/hostel-allocations/:id/suspend       hostel.allocate
POST   /api/v1/hostel-allocations/:id/resume        hostel.allocate
POST   /api/v1/hostel-allocations/:id/vacate        hostel.vacate
POST   /api/v1/hostel-allocations/:id/refund-deposit  hostel.deposit.refund

GET    /api/v1/mess-plans                           hostel.view
POST   /api/v1/mess-plans                           hostel.mess.manage
PATCH  /api/v1/mess-plans/:id                       hostel.mess.manage
DELETE /api/v1/mess-plans/:id                       hostel.mess.manage
GET    /api/v1/mess-enrollments                     hostel.view
POST   /api/v1/mess-enrollments                     hostel.mess.manage
POST   /api/v1/mess-enrollments/:id/end             hostel.mess.manage
GET    /api/v1/meal-offs                            hostel.view
POST   /api/v1/meal-offs                            hostel.mess.manage
PATCH  /api/v1/meal-offs/:id                        hostel.mess.manage
POST   /api/v1/meal-offs/:id/approve                hostel.mealoff.approve
POST   /api/v1/meal-offs/:id/cancel                 hostel.mess.manage

GET    /api/v1/hostel/reports/occupancy             hostel.report
GET    /api/v1/hostel/reports/occupancy/export      hostel.export
GET    /api/v1/hostel/reports/residents             hostel.report
GET    /api/v1/hostel/reports/residents/export      hostel.export
GET    /api/v1/hostel/reports/residents/print       hostel.export
GET    /api/v1/hostel/reports/dues                  hostel.report
GET    /api/v1/hostel/reports/dues/export           hostel.export
GET    /api/v1/hostel/reports/meal-offs             hostel.report
GET    /api/v1/hostel/reports/meal-offs/export      hostel.export

GET    /api/v1/portal/hostel                        ownership
GET    /api/v1/portal/parent/child/:childId/hostel  ownership
```

## Frontend Pages Created

- `/admin/hostel` — five tabs: Hostels & rooms, Boarders, Mess plans,
  Meal-offs, Reports; the waiting-approvals count is a **header badge**
  because an undecided meal-off is a credit that will land on the wrong
  month and stops being fixable once that invoice is raised.
- `/admin/hostel/[id]` — roadmap §5's **occupancy heat grid**: rooms as
  cards, beds as chips, click a free chip to allocate. A chip's colour
  comes from the server's `held` flag, never the bed's own status column,
  so a greyed chip and a 409 are the same fact.
- `/portal` — a hostel panel the student and the parent share with **no
  prop difference at all** (there is nothing here a boarder can *do*),
  showing the building, the room, the bed, the mess plan and the child's
  **own** meal-off requests.
- `/admin/students/[id]` — a Hostel tab on the student profile.

## Components Created (new shared/reusable only)

None. The module reuses `PageHeader`, `StatCard`, `EmptyState`,
`ErrorState`, `LoadingBlock`, `ConfirmDialog`, `Can` and the shadcn
primitives. The occupancy grid is deliberately local to its one consumer
(the M06 `MasterCrud` convention — it moves to `components/shared` when a
second area needs it).

## Business Rules Implemented

- Student gender must match the hostel type — **structural**, no
  permission reaches it. A student recorded `OTHER` matches neither and
  is a **policy** refusal `hostel.allocate.override` may pass, because
  refusing to house that child is the school's call and not the system's.
- One live allocation per enrollment; **bed exclusivity** — both partial
  uniques, and both excluding only `VACATED`.
- A **SUSPENDED boarder keeps their bed**; only vacating frees it.
- A **transfer does not restart the residency** — restarting would
  re-bill the month — and a transfer **between buildings is refused**,
  because the mess plan is pinned to the building and the deposit belongs
  to the allocation.
- Roadmap §8: a room may not be taken out of service with occupants; the
  refusal names how many people have to move, which **is** the transfer
  wizard's trigger.
- What a building is **for** cannot be changed while anybody lives in it.
- Vacating runs the dues check through **`LedgerService.outstandingFor`**
  — the single dues source every gate in the system reads — warns by
  default (`hostel.vacate_block_dues` off, the M23
  `library.clearance_block_exit` reasoning) and refuses only when a
  school turns it on; `hostel.vacate.override` is what passes it.
  Vacating also closes the mess enrolment in the same transaction.
- A deposit is refunded only after vacating, never for more than was
  taken, and every deduction carries a reason.
- Roadmap §6's mess rules: the charge follows the allocation dates, and a
  meal-off must meet `hostel.meal_off_min_days` (default 3, because the
  kitchen buys ahead) and may not overlap a request already on file — the
  credit would otherwise be paid twice and the duplicate looks exactly
  like a legitimate request.
- Roadmap §7: `bed_count` = generated beds — reported, never silently
  repaired, because deleting a bed somebody is asleep in is not something
  a form field should be able to do.
- The mess credit is **capped at the month's mess charge**; the invoice
  total is floored at zero (M16 has no negative payable, and
  `chk_invoices_payable` would refuse the row).

## Known Limitations

- **A resumed boarder's residency window starts at the resume date**, so
  a meal-off covering days before the suspension cannot be claimed. This
  is symmetric rather than unfair — those days were not billed either,
  because M16 reads the same window — and it is M25's documented
  one-row-one-window simplification. Modelling it properly needs a
  history table for an edge case a school hits once a year. The e2e suite
  asserts the refusal explicitly rather than working around it.
- **A suspend and a resume inside one calendar month bills from the
  resume date only** — the M25 caveat verbatim, for a bed.
- The **room rent and the mess charge are read live** at billing time (no
  snapshot on the allocation), so editing a rent mid-month changes what
  that month bills; invoices already raised are untouched.
- A meal-off whose `credit_month` passed without the school running
  invoicing that month is **not carried forward** — it is simply not
  credited. A carry-forward needs a marker column and the preview problem
  solved a second way.
- **Transfers are within one building only.** Moving between hostels is
  vacate-then-allocate, which starts a new residency and a new deposit.
- `hostel.mess_day_rate` and every other knob is **school-wide**; a
  school cannot price one hostel's day differently from another's.
- The resident-register PDF is plain pdfkit output whose default font
  **cannot set Bangla** (the limitation flagged since M09 ID cards), so
  `name_bn` is stored and never printed. The boarders and meal-off tables
  are **not virtualized** (the M12/M15/M22/M23/M24/M25 caveat).
- No visitor log, no gate pass, no night roll-call and no room-inspection
  record — roadmap §26 does not ask for them.
- Bulk allocation fills beds in room-and-bed order and reports whoever it
  could not place; there is no per-student bed picker in the bulk flow.

## Future Improvements

- A **hostel-transfer flow** that moves the residency, the deposit and
  the mess plan together as one audited act.
- Meal-off **carry-forward** for a month the school never invoiced.
- Per-hostel settings (day rate, minimum meal-off, deposit) — the
  registry is school-wide today.
- Roadmap §32 territory: visitor/gate-pass logs, night roll-call,
  room-inspection records and a maintenance ticket per room.
- M29: occupancy-over-time analytics and cost-per-bed.

## Breaking Changes

**None.** Every change is additive:

- `InvoiceService` gained a second injected DI token
  (`HOSTEL_FEE_SOURCE`), **always bound** — a school with no hostel gets
  an empty map and invoice generation is byte-identical to before.
- `PostingMapService` gained one append-only system slot
  (`HOSTEL_DEPOSIT_LIABILITY` → the already-seeded `2140 Security
  Deposits`), so a fresh school posts correctly with nothing configured.
- `voucher_source_enum` and `settings_group_enum` each gained one value.
- The seeded **Principal**, **Accountant** and **Office Staff** roles
  gained hostel codes. Their existing sets are untouched.

## Migration Steps

1. `npx prisma migrate deploy` — applies
   `20260803120000_hostel_management`.
2. `npx prisma generate`.
3. `npm run seed` — syncs the 11 new permission codes (registry now 250),
   the extended role baselines and the two new notification templates.
   Idempotent.
4. Optional: create fee heads named **`Hostel`** and **`Mess`**, or set
   `hostel.fee_head_id` / `hostel.mess_fee_head_id`. Billing resolves the
   configured id first and falls back to the **name** (the M20
   posting-map shape), so a school that simply creates those two heads
   needs no configuration at all. With neither, a warning is logged and
   no hostel line is billed — invoicing is otherwise unaffected.
5. Review `hostel.meal_off_min_days` (3), `hostel.mess_day_rate` (0 =
   derive), `hostel.default_security_deposit` (0) and
   `hostel.vacate_block_dues` (off).

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. Every knob is an M04 school setting. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` (backend) | ✅ clean | |
| `npx tsc --noEmit` (frontend) | ✅ clean | stale `.next/types` cleared first |
| `npx jest` (backend unit) | ✅ **1960 / 1960** | +116; 131 suites |
| `npx vitest run` (frontend) | ✅ **524 / 524** | +44; 40 files |
| `npx next build` | ✅ compiled | `/admin/hostel` + `/admin/hostel/[id]` emitted |
| `npx eslint` (new paths, both repos) | ✅ clean | |
| e2e `hostel.e2e-spec.ts` | ✅ **64 / 64** | new suite |
| e2e full suite | ✅ **844 / 844, 26 suites** | from 780 / 25 |
| Migration replay onto empty PG 16 | ✅ 26 migrations applied | `smis_verify` database |
| `prisma migrate diff` (local) | ✅ **No difference detected** | |
| Constraint probes | ✅ **20 / 20 rejected** | each CHECK, unique and composite FK probed individually |
| Migration applied to Neon | ✅ | `migrate diff` → **No difference detected** |
| Neon seed | ✅ | 250 permission codes, 8 templates created |
| In-browser click-throughs | ⏳ pending | see Remaining TODOs |

### What the verification found

1. **The residency window starts at the resume date, and the first
   meal-off fixture did not know that.** Five e2e cases failed on a 400
   whose message was exactly right: dates before the suspension are
   outside the countable residency. The engine was correct throughout;
   the *test* was asking for a credit against days that were never
   billed. Fixed by moving the fixture inside the live window **and**
   adding an explicit case asserting the refusal — the behaviour is a
   documented consequence of the one-row-one-window design, so it should
   be pinned rather than papered over.

2. **The fee heads the billing handoff resolves are resolved BY NAME, so
   the fixture could not prefix them — and cleanup therefore could not
   match them on the prefix.** The suite passed on a clean database and
   failed on every re-run with a unique-constraint error at `beforeAll`,
   which surfaced as *fifty* unrelated failures. The fixture now
   find-or-creates and remembers which heads it made. **A fixture whose
   name is dictated by the code under test needs its own cleanup key**,
   and the tell is a suite that passes exactly once.

3. **`eslint --fix` removed every `as StudentGender` assertion as
   unnecessary** — which is proof the hand-written union in
   `calc/types.ts` matches `gender_enum` exactly rather than a nuisance.
   The M24 lesson, arriving as a confirmation this time instead of a
   defect.

4. `invoice_items` stores the line label in **`description`**, not
   `feeHeadName` — the engine renames it on the way through. An assertion
   on the wrong column read `"undefined"` and passed nothing useful; a
   reminder that `toMatch` against a stringified `undefined` is a
   silently weak assertion.

## Remaining TODOs

- [ ] In-browser click-throughs: the occupancy grid on a 40-bed building,
      click-to-allocate on a phone viewport, the transfer dialog against
      a full room, the deposit-refund dialog with two deductions, the
      resident register printed on A4, and the portal panel on a phone.
- [ ] Decide whether a school wants **per-hostel** settings before the
      first multi-building deployment.
- [ ] M27 will aggregate hostel clearance beside M16 dues and M23 library
      clearance — `HostelAllocationsService` is exported and the vacate
      gate's shape (`checkClearance`) is the piece to reuse.

## Links to Related Modules

- **Depends on:** Module 09 (students), Module 11 (the `enrollment_id`
  every allocation keys on), Module 16 (fees — both the invoice lines and
  `LedgerService.outstandingFor`).
- **Imports:** School (settings), Rbac (the two runtime override checks),
  Enrollment, Communication (M17 `NotificationService.send`), Accounting
  (M20 `VoucherService.postAuto`), **Fee** — the first module since M20 to
  import `FeeModule`, and for a stated reason: the vacate gate must read
  the *same* dues source every other gate reads.
- **Imported by:** only the leaf `PortalModule` (M18), which mounts
  `HostelPortalService` at `/portal/hostel`.
- **Hooks closed:** none were open for M26 — M24 left the
  `(kind, department | person | room)` holder shape as a *template* and
  M25 left `TRANSPORT_FEE_SOURCE` as the fee-handoff template; both were
  followed rather than bound.
- **Leaves no no-op hooks.**
- **For Module 27:** hostel clearance joins the M16/M23 aggregate;
  `checkClearance` in `deposit.engine.ts` is the shape.
- **For Module 29:** occupancy-over-time and cost-per-bed analytics.
- `PROJECT_CONTEXT.md` sections updated: §5 (shared services), §8 (entity
  spine), §11 (global business rules), §16 (decisions), §18 (debt).
