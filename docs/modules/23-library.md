# Module 23 — Library Management · Completion Document

| | |
|---|---|
| **Module** | 23 — Library Management |
| **Completion date** | 2026-07-31 |
| **Actual effort** | 1 dev-day (est. was 4) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 23 |

## Summary of Implemented Features

The school's books: what it owns, who has them, and what is owed. Eleven
tables, five dependency-free engines, and a handful of decisions that the
rest falls out of.

**The catalogue separates the *title* from the *copy*, and everything
follows from that.** A `book` is the bibliographic record a reader
searches for; a `book_copy` is the physical volume on the shelf, with its
own accession number, its own condition and its own status. Roadmap §8's
*"same title, different editions → separate books"* is then not a
guideline in helper text but a consequence: the edition is a column on
the title, so two editions are two rows and their copies never mix on a
shelf list. Availability is `available / total` per title, and roadmap
§6's *"LOST copies excluded from stock counts"* is applied in the
counting query itself — a school's "we hold 40 copies" must not include
the twelve that went missing in 2019.

**`accession_no` is the one unique in this module that deliberately
ignores `deleted_at`.** It is a barcode label stuck inside a book — the
M07 employee-ID and M09 student-UID rule, for exactly the same reason.
Deleting a mis-entered copy frees the shelf, not the label; re-issuing
that number to a different volume would make every stock register printed
since then lie about what was counted. The same applies to `card_no`,
which is printed on a physical card.

**One verdict decides every "can this go out".** `canIssue` in
`circulation.engine.ts` is called by the desk's preview endpoint, by the
issue endpoint, and by the OPAC's blocked-reason line — so the greyed
button, the 409 and the portal message are three renderings of one
object and cannot disagree. That is the M16 `deriveStatus` lesson and the
M22 submission-window shape, applied to a circulation desk. The verdict
also carries its own **override tier**, reusing M13's routine-builder /
M14's exam-clash split: a copy that is physically in somebody else's
hands is a *structural* refusal and no permission changes it, while a
member over their limit or carrying an unpaid fine is a *policy* refusal
the librarian may push past with `library.issue.override` — recorded
against their name.

**The fine is arithmetic, and `fine_paid` is derived by CHECK.**
`fine_amount` is what was assessed; `fine_collected` and `fine_waived`
are the two ways it goes away; `fine_paid` is pinned by
`chk_book_issues_fine_paid` to `collected + waived >= amount`. It is the
one invariant a "mark as paid" button would otherwise be able to break,
so it is enforced at the database rather than by convention — the M16
"a status is derived, never assigned" rule, made structural. A waiver
without a name and a reason on it is refused by
`chk_book_issues_waiver_evidence`, because a write-off nobody signed is
indistinguishable from a fine that was never charged.

**Lateness is counted in whole elapsed days, not calendar dates.** A
book due at 14:00 Monday and returned at 09:00 Tuesday is *not* one day
late — the member had it for less than a full extra day, and counting
dates would charge them for a morning. Grace comes off the lateness,
holidays come off the chargeable days, and the cap is applied last; that
order is what makes grace visible on a long overdue and stops a school's
grace days being spent on days it was never going to charge for. The
holiday set is **passed into the engine, never fetched by it** (the
M12/M21 rule), which is what makes "was Friday a holiday last March?" a
fixture rather than a database.

**A library card belongs to a person, not to a role.** `library_members`
is polymorphic over `students`, `teachers` and `staff_profiles` with no
FK — the M12 `staff_attendances` / M21 `leave_applications` precedent —
so a teacher and an office assistant borrow through the same desk, the
same reports and the same portal panel a student does. `max_books` is
**stored on the card** rather than read from settings at issue time: a
librarian raising one student's limit for a project should not have to
raise everybody's, and a school editing `library.max_books_student` later
must not silently re-limit the exceptions it already granted.

**Holds are on a title, and roadmap §3 implied them.** §3 put `RESERVED`
in the copy-status enum and §4 asks the renew path to make a
"no-reservation check" — a check that is only decidable against a queue.
So `book_reservations` is that queue, and the copy status is its shadow:
a copy is RESERVED exactly while a READY hold points at it. When a copy
comes back and somebody is waiting, it is **held rather than shelved** —
otherwise the queue would mean nothing and the book would go to whoever
happened to be standing at the desk. Reserving a title that is on the
shelf is refused, not queued: the book is *there*.

**Renewing an overdue loan is refused, and the reason is arithmetic
rather than discipline.** A renewal moves `due_at` forward, which would
erase lateness that has already been earned and make the fine disappear.
A member who is late returns the book, settles what is owed and borrows
it again — leaving two honest loan records instead of one that quietly
forgave itself.

**Five dependency-free engines**, golden-tested (105 tests before a
service existed):

| Engine | What it owns |
|---|---|
| `fine.engine.ts` | overdue days (whole elapsed days, grace, holiday-aware, capped), lost/damaged replacement charge with the default-price fallback, and `isFineSettled` — the same predicate the DB CHECK computes |
| `circulation.engine.ts` | the single `canIssue` / `canRenew` verdict, the structural-vs-policy override split, and the due-date arithmetic |
| `isbn.util.ts` | ISBN-10/13 checksums, normalisation, 10→13 conversion; blank is legal |
| `barcode.util.ts` | a hand-rolled **Code 128-B** encoder emitting module widths, plus `normalizeScannedCode` for roadmap §8's Enter suffix |
| `stock-check.engine.ts` | the shelf diff — missing / unexpected / misplaced, with "on loan is legitimately absent" as its governing rule |

The Code 128 encoder is dependency-free for the reason `ics.util.ts`
(M05), `feed.util.ts` (M19) and `zip.util.ts` (M22) are: the spec is
small, completely specified and golden-testable against a check digit
worked by hand, and pulling a barcode library into a printing path that
must not break would add a transitive dependency for ~90 rectangles.

**12 permission codes, 30 `library.*` settings.** The separation of
duties is the one every library actually has: the **Librarian holds
`library.fine.collect` and deliberately not `library.fine.waive`** —
the person who takes the money is not the person who decides it is not
owed — and not `library.issue.override` either, because the limits and
the fine block are the school's policy rather than the desk's. The head
holds both. This is the M16 `fee.override.approve` / M20 `voucher.cancel`
/ M21 `payroll.approve` encoding, continued into the reading room.

**Roadmap §4's "optional voucher via posting map" ships as a real
posting**, through M20's `VoucherService.postAuto` — the same door M21's
payroll uses, with the same three properties inherited: idempotent on
`source_ref` (`library-fine:<issueId>`), a posting failure logged and
never rethrown (the money has already been taken), and money-in as a
CREDIT voucher. A new `LIBRARY` value joins `voucher_source_enum` and a
`LIBRARY_FINE_INCOME` slot joins M20's append-only `SYSTEM_SLOTS`,
falling back to the seeded chart's `4150 Library Fee Income` so a fresh
school posts correctly with nothing configured.

**Roadmap §6's clearance hook into M09 is live**, and its shape is the
interesting part — see *Links to related modules*.

Frontend: `/admin/library` with five tabs, a dedicated **scanner-first
circulation desk** at `/admin/library/circulation` (both boxes commit on
Enter; nothing needs a mouse), a book detail page with copy generation
and Code 128 label sheets, and a portal OPAC panel the student, the
teacher and the parent share — the parent's read-only, one prop apart.

## Database Changes

Migration `20260730210000_library_management`.

**11 tables:** `book_categories`, `authors`, `publishers`, `books`,
`book_authors` (join, hard-deleted and replaced as a set),
`book_copies`, `library_members`, `book_issues` (no soft delete — a loan
is history), `book_reservations`, `stock_verifications`,
`stock_verification_scans` (hard-deleted with its parent).

**7 new enums:** `book_copy_status_enum`, `book_condition_enum`,
`library_member_type_enum`, `library_member_status_enum`,
`library_fine_reason_enum`, `book_reservation_status_enum`,
`stock_verification_status_enum`. **2 altered:** `settings_group_enum`
gains `library`, `voucher_source_enum` gains `LIBRARY` (both safe inside
the migration transaction — nothing written *here* uses the new value,
the M20/M21/M22 precedent).

**11 unique indexes**, nine of them partial or expression-based and
therefore hand-written:

| Index | Predicate | Why |
|---|---|---|
| `uq_book_categories_name` / `uq_authors_name` / `uq_publishers_name` | `lower(name)` `WHERE deleted_at IS NULL` | a deleted master frees its name |
| `uq_book_copies_accession` | **none** | the label is never reused (M07/M09 rule) |
| `uq_library_members_card` | **none** | printed on a physical card |
| `uq_library_members_person` | `WHERE deleted_at IS NULL` | one live card per person |
| `uq_book_issues_open_copy` | `WHERE returned_at IS NULL` | **one physical book, one pair of hands** |
| `uq_book_reservations_live` | `WHERE status IN ('ACTIVE','READY')` | one hold per member per title |
| `uq_book_reservations_held_copy` | `WHERE held_copy_id IS NOT NULL AND status='READY'` | a copy is held for at most one hold |
| `uq_stock_verification_scans_copy` | `WHERE copy_id IS NOT NULL` | scanning a shelf twice must not double the count |
| `uq_stock_verifications_open` | `WHERE status='IN_PROGRESS' AND deleted_at IS NULL` | two concurrent counts would each report the other's shelves missing |

**11 CHECK constraints:** `chk_books_shape`, `chk_book_copies_shape`,
`chk_library_members_shape`, `chk_book_issues_window`,
`chk_book_issues_fine_amounts`, `chk_book_issues_fine_paid`,
`chk_book_issues_waiver_evidence`, `chk_book_issues_fine_evidence`,
`chk_book_reservations_evidence`, `chk_stock_verifications_shape`,
`chk_stock_verification_scans_accession`.

**19 indexes**, all school-scoped.

Every CHECK and every unique above was **individually probed on the
freshly-replayed database and confirmed to reject a bad row** — a
constraint nobody has seen refuse anything is a constraint that might not
be there.

## API Endpoints Added

```
# catalogue + masters
CRUD  /api/v1/library/categories|authors|publishers
GET   /api/v1/library/books                POST /api/v1/library/books
GET   /api/v1/library/books/:id            PATCH|DELETE /api/v1/library/books/:id
POST  /api/v1/library/books/:id/copies         { count }

# copies
GET   /api/v1/library/copies               GET /api/v1/library/copies/:id
GET   /api/v1/library/copies/status-totals
GET   /api/v1/library/copies/by-accession/:accessionNo
PATCH /api/v1/library/copies/:id           DELETE /api/v1/library/copies/:id
POST  /api/v1/library/copies/:id/mark          { status, reason, fineAmount? }
POST  /api/v1/library/copies/labels            → A4 Code 128 sheet (PDF)

# members
GET   /api/v1/library/members              POST /api/v1/library/members
GET   /api/v1/library/members/:id          PATCH /api/v1/library/members/:id
GET   /api/v1/library/members/:id/history
GET   /api/v1/library/members/by-card/:cardNo
GET   /api/v1/library/members/search-people?q=

# the desk
POST  /api/v1/library/issue/preview        POST /api/v1/library/issue
POST  /api/v1/library/return
POST  /api/v1/library/issues/:id/renew
GET   /api/v1/library/issues               GET /api/v1/library/issues/:id

# fines
GET   /api/v1/library/fines/outstanding
POST  /api/v1/library/fines/:issueId/collect|waive

# holds
GET   /api/v1/library/reservations          POST /api/v1/library/reservations
DELETE /api/v1/library/reservations/:id

# stock verification
GET   /api/v1/library/stock-checks          POST /api/v1/library/stock-checks
POST  /api/v1/library/stock-checks/:id/scan|close|cancel
GET   /api/v1/library/stock-checks/:id/diff

# reports + clearance
GET   /api/v1/library/reports/summary|issued|overdue|popular|stock
GET   /api/v1/library/reports/member/:id
GET   /api/v1/library/reports/overdue.xlsx|stock.xlsx|popular.xlsx
GET   /api/v1/library/reports/member/:id.xlsx
GET   /api/v1/library/clearance/:personType/:personId

# portal OPAC (mounted by M18's PortalModule)
GET   /api/v1/portal/library/catalogue
GET   /api/v1/portal/library/me
POST  /api/v1/portal/library/reservations
DELETE /api/v1/portal/library/reservations/:id
GET   /api/v1/portal/parent/child/:childId/library
```

## Frontend Pages Created

- `/admin/library` — five tabs: **Loans & fines** (stat row, on-loan /
  overdue / unpaid-fine lists with collect and waive dialogs),
  **Catalogue**, **Members**, **Categories / authors / publishers**,
  **Reports** (overdue, popular titles, category stock, stock
  verification).
- `/admin/library/circulation` — the scanner-first desk. Two boxes, both
  commit on Enter; the book card, the member card and the **engine's own
  verdict sentence** render beside them, and the Issue button is enabled
  by that verdict rather than by anything computed here.
- `/admin/library/[id]` — one title: stat row, copies table with
  selection, bulk copy generation, Code 128 label printing, write-off
  and delete dialogs.
- Portal: `LibraryPanels` (`(portal)/portal/library-panels.tsx`) mounted
  in the student, parent and teacher views — my loans with a due
  countdown, my holds, the catalogue search with an availability badge
  and a Reserve button.

## Components Created (new shared/reusable only)

None promoted to `components/shared` — the module reuses `StatCard`,
`DataTable` primitives, `Can`, `ConfirmDialog`, `EmptyState`,
`ErrorState` and `LoadingBlock` as they are. `FieldError` is re-exported
from `catalog-tab.tsx` for the other library tabs, mirroring how M22's
`assignments-tab.tsx` exports it.

## Business Rules Implemented

- A copy must be AVAILABLE (or held **for this member**) to be issued;
  ISSUED / LOST / DAMAGED / WITHDRAWN are **structural** refusals no
  override reaches.
- A member over `max_books`, carrying an unpaid fine at or above
  `library.fine_block_threshold`, holding an overdue book, suspended, or
  already holding that title is refused — all **overridable** with
  `library.issue.override`.
- The unpaid-fine total spans **every** loan, returned or not. A member
  who returned a book late three months ago and never paid still carries
  that debt — counting only open loans would let a habitual defaulter
  clear the check by handing everything back.
- Loan length and borrowing cap are per member type (student 7 days / 2
  books, teacher 14 / 5, staff 14 / 3 by default); the cap is copied onto
  the card at enrolment, not read live.
- A renewal is refused when the loan is overdue, at the renewal limit, or
  another member is waiting for the title; the new due date runs from
  **today**, so renewing on the last day gives the full new period.
- Overdue fine = chargeable days × rate, capped per loan; grace first,
  holidays second, cap last. `overdue_days` and `holiday_days` are
  **stored** (the M21 stored-`days` rule) so editing the calendar later
  cannot make a settled fine disagree with the receipt the member was
  handed.
- A lost or damaged copy is charged at the title's price × the
  multiplier, falling back to `library.default_book_price` when the title
  has none — charging nothing for an unpriced book is how the unpriced
  half of a catalogue becomes the half that goes missing. Writing off a
  copy that is on loan **closes that loan**, so the member's slot is
  freed rather than occupied forever by a book that no longer exists.
- `fine_paid` is derived, never assigned; a collection may not exceed
  what is outstanding; a waiver carries a name and a reason.
- Returning a copy somebody is waiting for **holds it** rather than
  shelving it; a lapsed hold passes the copy to the next in the queue.
- Only AVAILABLE and RESERVED copies are expected on the shelf during a
  stock-take, and the expected set is resolved **at close**, so a book
  issued during a week-long count is not reported missing. The diff is
  frozen into the row at close (the M14/M15 snapshot rule).
- A closed library card cannot be closed with books still out.
- A student exit status warns about books out and fines unpaid, and
  blocks only when `library.clearance_block_exit` is on — the same
  opt-in shape as M16's `fees.dues_block_exit_status`, for the same
  reason: a school transferring a student mid-dispute still has to be
  able to record it.

## Known Limitations

- The M20 fine voucher's `source_ref` is per **loan**, not per payment,
  so a fine settled in two instalments raises one voucher for the whole
  assessed amount at the first collection. A per-instalment voucher would
  need a payments table this module does not have; recorded rather than
  built.
- Library fines are **not** M16 invoices. Roadmap §2 called that link
  optional and it stays optional — a fine is settled at the desk and
  posted to the ledger, it does not appear on a student's fee ledger or
  in the portal's Pay Now.
- Barcode label sheets and every library PDF are plain pdfkit output —
  unbranded, and the default font cannot set Bangla (the limitation
  flagged since M09 ID cards). Accession numbers are ASCII by
  construction, so the barcodes themselves are unaffected.
- The catalogue and copies tables are not virtualized (the same 100+ row
  caveat M12's attendance grid, M15's mark grid and M22's submissions
  grid carry).
- No cover-image upload — `cover_url` takes a pasted URL, the same gap
  M19 has for content images, M20 for voucher attachments and M21 for
  leave attachments.
- The overdue chase runs **daily and decides for itself** whether today
  is the configured weekday, because one cron expression cannot be
  per-school. A school that changes the weekday sees it take effect the
  next day rather than immediately.
- `LibraryClearanceService` is instantiated twice (once in LibraryModule,
  once bound to `LIBRARY_CLEARANCE` inside StudentModule). Both are
  stateless — the same cost M15's `ResultReadinessGate` pays to keep the
  module graph acyclic.
- Bulk copy generation is capped at 200 per call: an unbounded loop
  claiming sequence numbers inside one transaction is how a request times
  out holding a row lock (the M20 transaction-budget lesson).

## Future Improvements

- Per-instalment fine vouchers, if a school starts taking library fines
  in parts routinely.
- Optional posting of a fine as an M16 invoice line, for schools that
  want everything a family owes on one statement.
- An acquisitions/purchase-order flow, and books as M24 inventory assets
  (roadmap §2 calls that link informational).
- Reading history analytics for M29 — most-borrowed by class, by
  category, per-member reading counts.
- A reservation queue view with drag-to-reorder for the desk.

## Breaking Changes

None to existing behaviour. Two additive changes other modules must know
about:

- **`voucher_source_enum` gains `LIBRARY`** and `SYSTEM_SLOTS` gains
  `LIBRARY_FINE_INCOME`. Both are append-only extensions of M20's
  contracts; nothing existing changes, and a school with
  `library.auto_post_accounting` off posts nothing.
- **`StudentsService.updateStatus` now consults the library** on an exit
  status and may add warnings, or throw a 409 when
  `library.clearance_block_exit` is on (default **off**, so behaviour is
  unchanged out of the box). Any caller constructing `StudentsService`
  by hand — the unit spec did — must now supply the `LIBRARY_CLEARANCE`
  dependency.

## Migration Steps

1. `npx prisma migrate deploy` — applies
   `20260730210000_library_management`.
2. `npx prisma generate`.
3. `npm run seed` — syncs the 12 new permission codes onto the seeded
   roles (the **Librarian role, empty since M03, is populated here**) and
   adds the two `LIBRARY_*` notification templates.
4. Review `/admin/settings/library`: loan periods, borrowing caps, the
   daily fine rate and cap, the lost/damaged multipliers, and the
   accession/card number patterns. The defaults are BD-school shaped
   (student 7 days / 2 books, 2 BDT/day, 500 BDT cap, 1.5× for a lost
   book).
5. Optionally turn on `library.clearance_block_exit` if the office should
   be *blocked* rather than warned when a leaving student still has
   books out.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Backend typecheck (`tsc --noEmit`, src + test) | ✅ | clean |
| Backend unit suite (`jest`) | ✅ | **1546 tests / 112 suites** (+152) |
| Library engines alone | ✅ | 105 golden tests, written before any service |
| Backend e2e (`npm run test:e2e`) | ✅ | **644 tests / 23 suites** (+57), incl. new `library.e2e-spec.ts` |
| `eslint` on new backend paths | ✅ | 0 errors |
| Frontend typecheck | ✅ | clean |
| Frontend tests (`vitest run`) | ✅ | **374 tests / 34 files** (+25) |
| `next build` | ✅ | emits `/admin/library`, `/admin/library/[id]`, `/admin/library/circulation` |
| `eslint` on new frontend paths | ✅ | 0 errors (1 pre-existing-style `watch()` advisory, same as M22's pages) |
| Migration replay onto an empty PG 16 | ✅ | full 22-migration chain, then `migrate diff` → **"No difference detected."** |
| Constraint probes on the replayed DB | ✅ | all 11 CHECKs and all 11 uniques confirmed to reject a bad row |
| Seed on the replayed DB | ✅ | 31 notification templates, 61 accounts, roles synced |
| Migration + seed on the Neon dev DB | ✅ | applied; `migrate diff` → **"No difference detected."** |
| Real barcode scanner at the desk (roadmap §9) | ⏳ | pending — the Enter/CR/Tab handling is unit- and e2e-tested, a physical scanner is not |

### What the e2e suite found

**One real defect in the fixtures, which is the constraint working.**
`chk_book_issues_window` refused a test row that set
`returnedAt: new Date()` while letting `issued_at` default to
`CURRENT_TIMESTAMP` — the server's clock, microseconds *after* the
client's — so the harness was asking the database to record a book
returned before it was issued. This is the M22 lesson repeating almost
word for word: the first input that tried to go round the constraint was
the test.

**One property of the settings cache, worth writing down.** A first draft
of the clearance test wrote `library.clearance_block_exit` straight into
`school_settings` with Prisma and then expected the exit to be blocked.
It was not: `SettingsService` caches every value in Redis for 60 s and
busts that cache **on write through the service**, so a row written
behind its back is invisible to the running app for a minute. That is by
design (M04) — the test now goes through `PUT /settings/library`, and the
behaviour is recorded here so the next person does not rediscover it.

**A queue-pollution scare, self-inflicted and diagnosed by the book.**
The first full e2e run failed 12 cases across exactly `communication` and
`result` — the two queue-dependent suites, which is the signature
PROJECT_CONTEXT §18 documents. The cause was not the documented `backend`
container this time but an **orphaned jest process** from an earlier run
that had been killed: its Nest apps' BullMQ workers were still connected
to the same Redis and eating jobs. Killing the orphan took the suite to
**644/644 on the next run, with no code change**. The tell is unchanged —
only those two suites, a different subset each time — and it now has a
second cause worth checking: `Get-Process node` / `ps` before blaming
the code.

## Remaining TODOs

- [ ] Real barcode-scanner desk test (roadmap §9's manual item) —
      accession scan, card scan, Enter-suffix handling on physical
      hardware.
- [ ] In-browser click-throughs: the circulation desk on a laptop with a
      scanner, a printed A4 label sheet held against a real spine, the
      stock-take scan box with a full shelf, and the portal OPAC on a
      phone.
- [ ] Decide whether library fines should optionally become M16 invoice
      lines (roadmap §2's "optional link").
- [ ] Cover-image upload, alongside the media library M19 wants.

## Links to Related Modules

- **Depends on:** Module 08 (teachers), Module 09 (students) — but
  through a **narrow directory repository, not their modules**. A library
  card is polymorphic over students, teachers and staff, and resolving
  one to a name needs a single column from each, so
  `LibraryDirectoryRepository` reads all three over PrismaService — the
  M12 `EmployeeDirectoryRepository` / M17 `AudienceRepository` / M18
  `DashboardRepository` / M19 `PublicSiteRepository` / M22 policy-query
  precedent. That keeps the graph honest about the dependency: the
  library needs to know *who people are*, not how they are managed.
- **Imports:** `SchoolModule` (settings), `RbacModule` (the two runtime
  permission checks), `SequenceModule` (gap-free accession and card
  numbers), `AcademicModule` (`CalendarService.workingDays`, which is
  what makes the fine holiday-aware), `CommunicationModule`
  (`NotificationService.send` — M17's single entry point),
  `AccountingModule` (`VoucherService.postAuto` — M20).
- **Imported by:** only the leaf `PortalModule` (M18), which composes
  `OpacService` into `/portal/library`. Same shape as the M22 edge:
  LibraryModule decides what a member may see and do, PortalModule
  answers only "whose card is this?".
- **Hook closed for Module 09 — and the shape is the point.** Roadmap §6
  asks for a library clearance check on a student status change.
  `LibraryClearanceService` depends on **PrismaService alone** and is
  provided a second time *inside StudentModule*, bound to the
  `LIBRARY_CLEARANCE` token — the M13 `RoutineConflictChecker` pattern,
  where the checker's code lives in the module that owns the domain but
  is instantiated inside the module that consults it. StudentModule
  importing LibraryModule would have closed a cycle: Library →
  Accounting → Fee → Student. The token is **always bound**, never
  conditional, because the M08/M14 lesson is that the call site is the
  part that is easy to forget.
- **Hook closed for Module 03:** the seeded **Librarian** role, empty
  since M03 with the note "Permissions arrive with Module 23", is
  populated.
- **Extends Module 20:** `VoucherSource.LIBRARY` and the
  `LIBRARY_FINE_INCOME` system slot, both append-only, resolving to the
  seeded chart's `4150 Library Fee Income`.
- **Extends Module 17:** two templates, `LIBRARY_OVERDUE` and
  `LIBRARY_RESERVATION_READY`, both defaulting to IN_APP for the M22
  reason — a library chases the same members week after week and an SMS
  default would spend real credit on a message the portal bell carries
  for free.
- **Extends Module 18:** four library reports registered in the reports
  hub, and a sixth import edge into `PortalModule`.
- **Leaves for Module 27:** `LibraryClearanceService` is exported so the
  certificate flow can aggregate it beside M16's dues and M26's hostel —
  the roadmap's "clearance aggregates 16/23/26".
- **Leaves for Module 24:** books as inventory assets stays
  informational, as roadmap §2 says. The seeded chart already carries
  `1530 Books & Library Assets` for it.
- **Leaves for Module 29:** reading-history analytics.
- `PROJECT_CONTEXT.md` sections updated: §5 (shared services), §8 (entity
  spine), §11 (global business rules), §16 (decisions), §18 (debt).
