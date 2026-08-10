# Module 28 — Complaint, Visitor & Alumni Management · Completion Document

| | |
|---|---|
| **Module** | 28 — Complaint, Visitor & Alumni Management |
| **Completion date** | 2026-08-10 |
| **Actual effort** | 1 dev-day (est. was 5) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 28 |

## Summary of Implemented Features

Three light workflows in one module: what people tell the school, who walks
through its gate, and the students who left it.

**The module turns on one promise, and almost everything in the complaints
third follows from it: an anonymous complaint must be genuinely anonymous.**
A school that offers an anonymous box and then stores the sender's phone
number beside the complaint has not offered one — it has built a trap, and
the person who trusted it finds out too late. So anonymity is **structural**:
`chk_tickets_raiser` refuses an ANONYMOUS ticket that carries a raiser id, a
contact block **or an IP address**, and the service refuses before it. That
last one is the part that is easy to get wrong — an IP is a contact detail,
so the per-IP hourly cap that protects the public form is deliberately *not*
applied to an anonymous submission. The captcha and the route throttle carry
that load instead, which is the price of the promise and is paid knowingly.
`isAnonymous` is a single predicate in the engine rather than five inline
comparisons, because there are five notification paths and the one that gets
it wrong is the one that texts a whistle-blower.

**Its second rule is that a restricted complaint is invisible, not
forbidden.** Roadmap §8 asks that a complaint naming a member of staff be
kept from general staff, and there are two ways to do that. A 403 tells a
member of staff that a complaint about them exists — which is precisely the
disclosure being prevented. So a caller without `ticket.sensitive.view` gets
the **same 404 an unknown id gets**, the row never appears in their listing,
and the filter is a WHERE clause rather than a trimmed result (the M19 rule
that the SELECT list is the policy). Sensitivity is decided once at creation
from the category and then **stored**: a school that later drops TEACHER from
its sensitive list must not thereby expose the complaints already filed under
it, because the people who wrote those were told they would be handled
discreetly and a settings edit is not their consent.

**The visitor third answers one question at any moment — who is in the
building right now** — and everything serves that. A visit is a row with an
open `check_out`; the in-building list is that predicate and there is
deliberately no status column that could fall out of step with it. The
day-end sweep exists because the answer must not still read "forty people" at
two in the morning, and it writes **both** a check-out time and a flag saying
a machine wrote it: "left at 16:40" and "was still signed in when we locked
up" are different facts, and a register that cannot tell them apart cannot
answer the question it would ever be pulled out for.

**The alumni third is a privacy surface with two locks.** The public
directory query filters on `is_public_profile` AND APPROVED, and
`alumni.engine`'s `publicProfile` decides the shape that leaves the building —
which carries a name, a batch, a class, a profession and a note, and **never
a phone number, an email or an address**. Roadmap §8's conflict queue needed
no queue table: a second person claiming a student record may register and
sits PENDING — that *is* the queue — and what is refused is the **approval**,
by a readable service message and by `uq_alumni_student` underneath it. The
match hints rank and never link, because "Md. Rahman, batch 2015" describes
several real people at any BD school of size.

**Donations are the fifth immutable ledger in this codebase.** Roadmap §6
says "donations receipts immutable" in four words; there is no update method
and no PUT route, and a mistake is CANCELLED with a reason and stays visible
in the register — the M15 re-issue / M20 reversal / M24 purchase-cancellation
/ M27 certificate rule arriving again. Cancelling the donation deliberately
does **not** cancel its M20 voucher: reversing a posted entry is the
accountant's act (`voucher.cancel` is not this module's code — the M24/M25
precedent verbatim). A gift **in kind** is receipted and reported but never
debits cash, because twenty donated benches are not twenty thousand taka in
the cash box.

**Closed M18's contact-school stub.** The portal form used to drop a message
in the M19 office inbox and go quiet — no reference, no status, no way to
know anybody had read it. It now opens a real ticket the family can follow,
reply on and rate, exactly as M18's own module doc predicted. The one thing
that did not change is that the sender comes from the resolved account and
never from the request body.

**Leaves no no-op hooks.**

## Database Changes

Migration `20260809120000_complaint_visitor_alumni`.

**8 tables** — `tickets`, `ticket_comments`, `visitors`, `appointments`,
`alumni`, `alumni_events`, `alumni_event_registrations`, `donations`.

**11 enums** — `ticket_type_enum`, `ticket_category_enum`,
`ticket_raiser_type_enum`, `ticket_priority_enum`, `ticket_status_enum`,
`visitor_purpose_enum`, `visitor_host_type_enum`, `appointment_status_enum`,
`alumni_status_enum`, `alumni_registration_status_enum`,
`donation_method_enum`; plus two **altered**: `settings_group_enum` gains
`community` and `voucher_source_enum` gains `DONATION` (M20's append-only
door, sixth consumer).

**6 hand-written unique indexes.** `uq_tickets_no` and `uq_donations_receipt`
are **plain** uniques that ignore `deleted_at` (a ticket number was quoted to
a parent; a receipt number may be presented to the revenue board — neither is
ever reused) and are therefore declared **in `schema.prisma` as well**, the
M24 rule. `uq_visitors_gate_pass` is partial only because the column is
nullable. `uq_alumni_student` is the conflict queue: partial on
`status = 'APPROVED'` and live rows. `uq_alumni_event_registrations_identity`
excludes CANCELLED so a withdrawal frees the seat (the M11/M21 rule).
`uq_alumni_events_identity` is expression-based over `lower(btrim(title))`.

**11 CHECK constraints.** The load-bearing one is `chk_tickets_raiser`;
`chk_tickets_status_evidence` carries the status-evidence rule, and
`chk_visitors_window` pins `auto_checked_out` to a row that actually has a
check-out behind it.

`ticket_comments` is **append-only** — no `updated_at`, no `deleted_at`, no
update path (the M03 audit / M17 notifications / M20 ledger / M24
stock-ledger precedent, and exactly the columns roadmap §3 gives it).

Verified on a clean Postgres 16 and on Neon with **zero drift**, and every
hand-written object individually probed: **35 of 35 illegal rows rejected, 6
of 6 legal cases accepted.**

## API Endpoints Added

```
CRUD  /api/v1/tickets            (+ /:id/assign | /:id/status | /:id/comments)
GET   /api/v1/tickets/reports/summary | register  (+ /export)
CRUD  /api/v1/visitors           (+ /:id/checkout, /:id/gate-pass, /inside, /hosts)
GET   /api/v1/visitors/reports/register           (+ /export, /pdf)
CRUD  /api/v1/appointments       (+ /:id/decision)
CRUD  /api/v1/alumni             (+ /:id/decision, /:id/match-hints)
GET   /api/v1/alumni/reports/directory            (+ /export)
CRUD  /api/v1/alumni-events      (+ /:id/registrations, /registrations/:id)
GET   /api/v1/donations          (+ /:id/receipt)   POST /api/v1/donations
POST  /api/v1/donations/:id/cancel                  ← there is no PUT, by design
GET   /api/v1/donations/reports/summary | register  (+ /export)

POST  /api/v1/public/tickets            POST /api/v1/public/alumni/register
GET   /api/v1/public/alumni             GET  /api/v1/public/alumni/batches
GET   /api/v1/public/alumni/events

GET   /api/v1/portal/tickets            POST /api/v1/portal/tickets/:id/reply
POST  /api/v1/portal/tickets/:id/rating
POST  /api/v1/portal/contact-school     ← now opens a ticket (see Breaking Changes)
```

## Frontend Pages Created

- `/admin/complaints` — inbox (kanban by status + table view, priority chips,
  thread drawer) and reports. **The board is read-only and the drawer does
  the work**: a drag to RESOLVED cannot carry a resolution, and the DB CHECK
  refuses the row without one, so the status changes where the words are.
- `/admin/visitors` — desk (fast form + live in-building list + checkout on
  every row), appointments, register.
- `/admin/alumni` — directory, approval queue with match hints, events with
  guest lists, donations with the summary dashboard.
- `/complaint` — the public form. **Ticking "anonymous" removes the contact
  fields rather than ignoring them**, because a form that still shows a phone
  box while promising anonymity is contradicting itself on screen.
- `/alumni` — public directory (search, batch chips) + self-registration.
- Portal: `my-tickets.tsx` replaces the old contact card with the thread.

## Components Created (new shared/reusable only)

None. The module reuses `DataTable`-adjacent patterns, `Can`, `StatCard`,
`EmptyState`, `ErrorState`, `LoadingBlock` and the shadcn primitives.

## Business Rules Implemented

- **Anonymous complaints allowed (setting), with no requester notifications** —
  and no stored name, contact or IP. Enforced by CHECK, by the engine and by
  the notification service, which refuses twice.
- **Only the assignee or an inbox manager changes a ticket status** (§6). The
  permission code is checked at the route; the *relationship* is checked in
  `ticket.engine`, because "your own ticket" is not something a permission can
  express.
- **REOPENED allowed within 7 days of CLOSED**, measured from `closed_at` so
  the office's decision becomes final on a date a parent can be told. A
  reopen clears the resolution and the SLA stamp and **keeps the rating**.
- **A visitor must check out the same day, auto-flagged otherwise.** A
  multi-day pass is OFFICIAL-only (§8's external invigilator) and bounded by
  `community.visitor_max_pass_days`.
- **Gate pass required is a per-school setting**, and when it is on it applies
  to everybody — including the vendor the office knows by name, who is
  exactly the person a "trusted visitor" exemption would be invented for.
- **The alumni directory exposes only opted-in fields**; the opt-in defaults
  to false at the database.
- **Donation receipts are immutable**; amount > 0; subject ≤ 200; rating 1–5;
  batch year 1950–current (the exact bound in the DTO, a wide sanity range in
  the CHECK — a constraint over `CURRENT_DATE` is not IMMUTABLE and would
  make a January restore reject rows that were legal when written).
- **Over capacity warns, it does not refuse** (the M25 bus rule, seventh
  application): a reunion seating a hundred with a hundred and two wanting to
  come is a real thing, and a system that made it unrecordable would be lied to.
- **Separation of duties.** The Office Staff runs all three desks and holds
  neither `ticket.sensitive.view` (a complaint about a colleague is not read
  by their colleagues), `ticket.delete`, nor `alumni.donation.cancel` (the
  accountant's) — the M16/M20/M21/M23/M24/M25/M26/M27 rule, continued.

**24 permission codes, 24 `community.*` settings, 6 notification codes,
6 reports** registered in M18's hub.

## Known Limitations

- The **SLA is priority-weighted rather than the roadmap's flat 72 hours**.
  MEDIUM keeps 72, so a school that touches nothing gets the specified
  behaviour — but a school wanting one number for everything sets four.
- **The escalation is one summary per school per sweep**, naming ticket
  numbers and not subjects. There is no per-ticket chase and no reminder
  ladder (the M24 low-stock reasoning).
- **An anonymous submission is not IP-rate-limited** — deliberately, see the
  Summary. The captcha and the route throttle are what stand behind it.
- **Ticket attachments are pasted URLs**, and a visitor photo is a URL rather
  than a webcam capture — roadmap §4 offers the camera as optional and there
  is nowhere to put the captured frame (the media-library gap M19/M20/M21/
  M23/M25/M26/M27 all carry).
- **The kanban does not drag.** See the Frontend note: the gesture cannot
  carry a resolution.
- **The gate pass and donation receipt PDFs cannot set Bangla** (the M09
  pdfkit-font limitation, carried by every PDF in the system), so a Bangla
  donor name renders transliterated.
- **`community.*` knobs are school-wide.** One gate cannot require passes
  while another does not.
- The inbox, visitor and donation tables are **not virtualized** (the
  M12/M15/M22/M23/M24/M25/M26/M27 caveat).
- **Event fees are recorded, not collected** — `amount_paid` is typed in at
  the desk; there is no M16 invoice and no gateway behind a reunion ticket.
- **Cancelling a donation leaves its ledger voucher standing.** By design;
  the accountant reverses it.
- The reCAPTCHA on both public forms **fails OPEN on a network error** (the
  M10 `RecaptchaService` behaviour, inherited).

## Future Improvements

- A per-ticket escalation ladder and a per-item `notified_at`.
- Collecting an event fee through M16 rather than recording it.
- A media library, which would turn the attachment and photo URLs into real
  uploads and let the visitor desk capture a webcam frame (M29/M30).
- Alumni analytics — giving over time, batch engagement — for M29.
- A "contact this alumnus" relay, so the directory can be useful without
  publishing anybody's number.

## Breaking Changes

**`POST /api/v1/portal/contact-school` now opens a ticket instead of writing
to the M19 office inbox.**

- The **request shape is unchanged** — `type` and `category` are optional
  additions, so an existing caller sending `{subject, body}` still works.
- The **response gained `ticketNo` and `id`** (previously `{message}` only).
  Additive.
- **The destination changed.** Messages no longer appear under
  Website → Contact inbox; they appear in Complaints. Anyone who watched the
  M19 inbox for portal messages must look at `/admin/complaints`.
- **A teacher using the portal is now refused** (400) — they have no guardian
  or student row to file against, and staff raise complaints through the
  office inbox. Previously any portal user could write to the inbox.
- `test/portal.e2e-spec.ts` was updated; `PortalMessagesService` now injects
  `TicketsService` instead of `ContactService`.

## Migration Steps

1. `npx prisma migrate deploy` — applies
   `20260809120000_complaint_visitor_alumni` (8 tables, 11 new enums, 2
   altered).
2. `npm run seed` — syncs the 24 new permission codes, grants the role
   baselines, and seeds the 6 notification templates.
3. Nothing else. `community.*` settings all carry working defaults, and the
   `DONATION_INCOME` posting slot resolves to the seeded `4300 Donation
   Income` with nothing configured.
4. Optional: switch on `community.visitor_gate_pass_required` and set
   `community.visitor_auto_checkout_time` to when the school actually locks up.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. The public forms reuse M10's existing `RECAPTCHA_SECRET_KEY`. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Clean migration replay onto empty Postgres 16 | ✅ | 26 migrations, zero drift |
| `migrate diff` against clean replay | ✅ | "No difference detected" |
| Every CHECK / unique probed individually | ✅ | **35 of 35 rejected, 6 of 6 legal accepted** |
| Seed onto the replayed database | ✅ | 286 codes, 55 templates, 61 accounts |
| Migration + seed on Neon | ✅ | zero drift; 8 templates created |
| Nest DI graph boots | ✅ | the M18/M21 lesson — checked before the suites |
| Backend `tsc --noEmit` | ✅ | clean |
| Backend unit suite | ✅ | **2257 tests / 147 suites (+141)** |
| e2e `community.e2e-spec.ts` | ✅ | **76 cases** |
| Full e2e suite | ✅ | **989 tests / 28 suites** |
| `eslint` on all new paths | ✅ | clean, both repos |
| Frontend `tsc --noEmit` | ✅ | clean |
| Frontend Vitest | ✅ | **592 tests / 43 files (+32)** |
| `next build` | ✅ | emits `/admin/complaints`, `/admin/visitors`, `/admin/alumni`, `/complaint`, `/alumni` |
| In-browser click-throughs | ⏳ | see Remaining TODOs |

### What verification found

**1. Reopening a *rated* ticket violated `chk_tickets_status_evidence`** (the
e2e run, 500 on a real request). The ratings clause originally allowed a
score only on RESOLVED or CLOSED — and REOPENED is neither, so the reopen
died at the database. The fix was the **constraint, not the patch**: REOPENED
is precisely the state that means "there *was* a resolution and it did not
hold", so a rating belongs on it. Clearing the score instead would have let a
school lift its average satisfaction by reopening the tickets people scored
badly, which is exactly backwards. Pinned by an engine test and an explicit
e2e assertion.

**2. A cross-suite isolation bug that passed alone and failed in the full
run.** The community suite reset the shared `ticket:` document-sequence
counter in its cleanup so its number assertions would "stay exact" — but
`uq_tickets_no` ignores `deleted_at`, and the *portal* suite now raises
tickets of its own through Contact School. Rewinding the counter re-issued a
number those rows still held, and every write in the suite died on a unique
violation. **A counter shared with another suite is not one suite's to
reset** — the M26 "a fixture whose key is dictated by the code under test
needs its own cleanup key" lesson, inverted. The reset was removed (nothing
asserted the numbers started at 00001) and the portal suite now cleans up the
tickets it creates.

**3. A pre-existing, date-dependent failure in M26's hostel e2e**, surfaced by
this module's full-suite run and fixed here. `M16 billing handoff` asserted a
full month's rent of 3100 while the fixture suspended at `day(-10)` and
resumed at `day(-5)`. Run on the 10th, the resume lands on the 5th of the
*current* month, M26's documented "a resumed boarder's window starts at the
resume date" rule applies, and the rent prorates to 27/31 = 2700. The suite
passed only in the first few days of a month. The engine was correct
throughout; the fixture now places the suspend/resume pair in the previous
month via a `beforeThisMonth()` helper. **A suite that passes on the 3rd and
fails on the 10th is not flaky, it is wrong** — the M18 attendance-on-Friday
/ M25 Dhaka-midnight lesson, third occurrence.

**4. `eslint --fix` removed every `as TicketStatusCode` / `as
VisitorPurposeCode` / `as DonationMethodCode` assertion as unnecessary** —
which is *proof the hand-written `calc/types.ts` unions agree exactly with
the generated Prisma enums*, not a nuisance. The M24/M26/M27 lesson arriving
as confirmation for the fourth time.

## Remaining TODOs

- [ ] In-browser click-throughs: the kanban with a full inbox, the visitor
      desk on a tablet at a real gate, a gate pass printed on A6, the
      donation receipt on A5, the approval queue's match panel, and the
      public complaint form with live reCAPTCHA keys.
- [ ] Roadmap §9's "camera capture fallback" — deferred with the media
      library; the field takes a URL today.

## Links to Related Modules

- **Depends on:** 07 (the people a visitor asks for), 09 (guardians,
  students, graduates), 17 (`NotificationService.send`), 19 (the public-form
  pattern and `htmlToText`).
- **Imports:** School, Rbac, Sequence, Storage, Communication, Accounting.
  Deliberately imports **neither Student, Teacher, Staff nor Enrollment** —
  `CommunityDirectoryRepository` reads the handful of columns it needs over
  PrismaService, the M12/M17/M18/M19/M22/M23/M24 precedent, **eighth use**.
- **Imported by:** only the leaf `PortalModule`, which is what makes
  CommunityModule a near-leaf like Portal (M18), Website (M19) and Document
  (M27) and keeps the graph acyclic.
- **Hooks completed for:** **M18** — the contact-school stub is now a real
  ticket thread (see Breaking Changes). This was the last open item in
  PROJECT_CONTEXT §18's M18 entry.
- **Uses from M20:** `VoucherService.postAuto` with new
  `VoucherSource.DONATION` and the new `DONATION_INCOME` system slot →
  seeded `4300`. Sixth module through that door.
- **Leaves for 29:** complaint-volume trends, visitor-footfall analytics,
  alumni giving over time and batch engagement.
- `PROJECT_CONTEXT.md` sections updated: §5, §8, §11, §16, §18.
