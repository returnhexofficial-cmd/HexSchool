# Module 24 — Inventory & Assets · Completion Document

| | |
|---|---|
| **Module** | 24 — Inventory & Assets |
| **Completion date** | 2026-08-02 |
| **Actual effort** | 1 dev-day (est. was 5) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 24 |

## Summary of Implemented Features

The school's store and the things it owns: what it stocks, what arrived,
what went out, who is holding it, and what it paid.

**The module turns on one distinction, and everything else falls out of
it.** A **CONSUMABLE is counted** — the ledger's balance is the truth, and
nothing tracks an individual biro. An **ASSET is identified** — every unit
gets a tag, a location and a custodian, and "how many do we have" is
answered by counting rows rather than by reading a balance. That is why
receiving ten chairs and receiving ten reams of paper are two different
events, why `canIssue` refuses an asset outright, and why the asset
register and the stock report are different screens.

- **The catalogue**: suppliers (with a blacklisting that carries a
  mandatory reason), a category **tree** that is also the accounting
  posting key, and items carrying a base unit, an optional pack size
  (roadmap §8's `box_size`) and an optional reorder level.
- **Purchases**: a line grid, gap-free `PO-{YY}-{SEQ5}` numbering, and a
  **RECEIVE** that in one transaction writes the stock in, records each
  item's last unit cost, generates one tagged asset unit per asset
  bought, and posts a DEBIT voucher through M20.
- **The issue desk**: consumables out to a department, a person or a
  room; a preview that reaches the *same* verdict the endpoint will; and
  returns that move a per-line `returned_qty` and re-derive the slip's
  status.
- **Adjustments**: roadmap §4's count correction and §8's bulk stock-take
  wizard are one endpoint — a list of counted quantities and one
  mandatory reason.
- **The asset lifecycle**: assign, transfer, send for repair, bring back,
  and write off with an approval permission the office does not hold.
- **Six reports** (stock & valuation, item ledger, purchases by supplier,
  asset register, warranties expiring, consumption by department), all
  XLSX and the register also PDF; a weekly low-stock and warranty sweep
  through M17.

### The decisions worth stating

**The ledger is the only place a balance exists.** There is deliberately
no `qty` column on `items`. A stored quantity is a second source of truth
that drifts from the movements beneath it and then has to be "corrected"
by the very screen that broke it. `balance_after` is a *running* total on
each `stock_ledger` row, written under a `SELECT … FOR UPDATE` on the
item, which is what lets an item ledger show a running balance beside
each row without an O(n²) scan — and what makes concurrent issues of one
item safe.

**Every movement is one-sided.** `qty_in` or `qty_out`, never both, never
a signed `qty` — the M20 `chk_voucher_entries_one_sided` shape applied to
things instead of money. A signed column reads fine until somebody writes
−5 with `txn = 'PURCHASE'` and the purchase report starts subtracting.

**`balance_after >= 0` is a CHECK, not a service rule.** A school cannot
issue what it does not have, and the database says so even when a future
write path forgets to ask. The service still checks first, only so it can
say *why* ("only 3 reams on hand") rather than surfacing a constraint
name to a clerk.

**An adjustment is expressed as the movement it implies, not as a new
balance.** A count that finds 8 where the ledger says 12 writes
`qty_out: 4`. That keeps every row a *movement*, so the column always
adds up — and it is what makes §8's count-sheet wizard a list of
differences rather than a list of overwrites. The remark records
`ledger 12 → counted 8`, because "corrected to 8" means nothing a year
later without knowing what it was corrected from.

**The unit conversion is a stored fact, not a multiplication somebody
repeats.** A purchase line carries `qty` as the clerk typed it (4 boxes),
a **snapshot** of the pack size, and `base_qty` — and
`chk_purchase_items_shape` pins `base_qty = qty × pack_size`, so the two
can never drift. The ledger only ever speaks base units.

**An asset tag is never reused; an item code is.** `uq_asset_units_tag`
ignores `deleted_at` (the M07 employee-ID / M09 student-UID / M23
accession rule) because it is a sticker on a projector — re-issuing it
would make every register printed since then lie. `uq_items_code` is
scoped to live rows, the M25 `uq_vehicles_reg_no` rule, because a
catalogue code is a label the school chooses and may re-file. The two
sitting one table apart is the clearest statement of that distinction the
codebase has.

**One shape for "who has it".** The issue recipient and the asset
custodian are the same `(kind, department | person | room)` triple, pinned
by a CHECK on each table. Answering "who is holding school property" two
different ways would give the issue desk and the asset register two
vocabularies for one fact. §8's shared-custody case is why DEPARTMENT
exists at all: a microscope belongs to the science department and to no
one person.

**A RECEIVED purchase is immutable; the correction is a cancellation that
writes reversing entries.** The M20 voucher rule, in a second ledger —
and it has the same consequence: a school that has already issued the
paper it is trying to un-receive genuinely cannot, and finding that out is
the point. The e2e suite asserts exactly that refusal.

**A written-off unit never comes back.** There is no transition out of
DISPOSED or LOST. A projector that turns up in a cupboard is registered
as a *new* unit with its own tag, because the disposal was an approved act
with a name on it and quietly reversing it would erase the approval.

**The valuation names its own method.** Roadmap §4 asks for "last price ×
qty" and calls it FIFO-simple. It is not FIFO, and the report says so on
its face — a valuation whose basis is not written beside it is read as
FIFO by whoever opens it next. See *Known Limitations*.

## Database Changes

**Migration:** `prisma/migrations/20260802120000_inventory_assets/`

**9 tables** — `suppliers`, `item_categories` (self-referential tree),
`items`, `purchases` →1:N→ `purchase_items`, `stock_ledger`,
`asset_units`, `stock_issues` →1:N→ `stock_issue_items`.

**10 new enums** — `item_type_enum`, `item_unit_enum`,
`supplier_status_enum`, `purchase_status_enum`, `stock_txn_enum`,
`asset_unit_status_enum`, `asset_condition_enum`,
`inventory_holder_type_enum`, `inventory_person_type_enum`,
`stock_issue_status_enum`.

**2 enums altered** — `settings_group_enum` += `inventory`;
`posting_map_kind_enum` += `INVENTORY_CATEGORY` (M20's append-only kind,
used for the first time). `voucher_source_enum` already carried
`INVENTORY` — M20 enumerated it when the enum was written, so no ALTER was
needed.

**9 unique indexes**, four of them expression- or partial-based and
therefore hand-written only:

| Index | Scope | Why |
|---|---|---|
| `uq_suppliers_name` | live rows, `lower(btrim(…))` | two live suppliers with one name means somebody picks the wrong one |
| `uq_item_categories_identity` | live rows, **COALESCE** over the optional parent | two ROOT categories called "Stationery" are the same collision, and `NULL <> NULL` would let both through (the M06 trick) |
| `uq_items_code` | live rows, `upper(btrim(…))` | a catalogue label — deleting frees it |
| `uq_asset_units_tag` | **all rows**, `upper(btrim(…))` | a sticker on an object — never reused |
| `uq_asset_units_serial` | live rows, non-null only | the manufacturer's number; two live rows sharing one means one machine entered twice |
| `uq_purchases_no` | all rows | printed on a document that went to a supplier |
| `uq_stock_issues_no` | all rows | somebody signed for it |
| `uq_purchase_items_identity` | all rows | one line per item per delivery |
| `uq_stock_issue_items_identity` | all rows | so a return has one row to move |

**13 CHECK constraints**, each individually probed in the e2e suite and
confirmed to reject a bad row:
`chk_suppliers_shape` (a blacklisting carries a reason),
`chk_item_categories_shape`, `chk_items_shape` (a pack size may not be
zero), `chk_purchases_status_evidence`, `chk_purchase_items_shape` (the
`base_qty = qty × pack_size` identity), **`chk_stock_ledger_one_sided`**
(one direction, non-negative balance), `chk_stock_ledger_reason` (an
ADJUST or DISPOSE carries one), `chk_asset_units_custodian` (exactly one
holder shape), `chk_asset_units_warranty` (§7: cover may not predate the
purchase), `chk_asset_units_disposal_evidence`, `chk_asset_units_shape`,
`chk_stock_issues_recipient`, `chk_stock_issue_items_returned` (§6:
returns ≤ issued).

`stock_ledger` is **append-only** — no `deleted_at`, no `updated_at`, no
update path in the repository (the `audit_logs` / M17 `sms_credits` / M21
`pf_ledger` shape).

**Verified:** the full 24-migration chain replays onto an empty Postgres
16 with **`No difference detected`** from `prisma migrate diff`, and the
migration is applied to the Neon dev database with the same result.

## API Endpoints Added

```
GET    /api/v1/inventory/suppliers            POST /api/v1/inventory/suppliers
GET    /api/v1/inventory/suppliers/:id        PATCH|DELETE /api/v1/inventory/suppliers/:id
GET    /api/v1/inventory/categories           POST /api/v1/inventory/categories
PATCH|DELETE /api/v1/inventory/categories/:id
GET    /api/v1/inventory/items                POST /api/v1/inventory/items
GET    /api/v1/inventory/items/:id            PATCH|DELETE /api/v1/inventory/items/:id
GET    /api/v1/inventory/items/:id/ledger

GET    /api/v1/inventory/purchases            POST /api/v1/inventory/purchases
GET    /api/v1/inventory/purchases/:id        PATCH|DELETE /api/v1/inventory/purchases/:id
POST   /api/v1/inventory/purchases/:id/receive
POST   /api/v1/inventory/purchases/:id/cancel

GET    /api/v1/inventory/issues               POST /api/v1/inventory/issues
GET    /api/v1/inventory/issues/:id           POST /api/v1/inventory/issues/preview
POST   /api/v1/inventory/issues/:id/return
GET    /api/v1/inventory/issuable-items

POST   /api/v1/inventory/adjustments

GET    /api/v1/inventory/assets               POST /api/v1/inventory/assets
GET    /api/v1/inventory/assets/:id           PATCH /api/v1/inventory/assets/:id
POST   /api/v1/inventory/assets/:id/assign|transfer|return|repair|repair-complete|dispose

GET    /api/v1/inventory/holders

GET    /api/v1/inventory/reports/stock|low-stock|purchases|assets|warranty|consumption
GET    /api/v1/inventory/reports/ledger/:itemId
GET    /api/v1/inventory/reports/{stock|purchases|assets|warranty|consumption}/export
GET    /api/v1/inventory/reports/ledger/:itemId/export
GET    /api/v1/inventory/reports/assets/export/pdf
```

## Frontend Pages Created

- `/admin/inventory` — five tabs (Catalogue, Purchases, Issue desk, Asset
  register, Reports) with the **low-stock count as a header badge**, the
  same list the weekly job sends. A store that has run out of exam paper
  is not a thing to discover by clicking through to a report.
- **Catalogue tab** — items with their live ledger balance (and, for a
  packed item, the same balance in packs), plus supplier and category
  dialogs.
- **Purchases tab** — the line grid, whose header **totals in the same
  arithmetic the server uses** (each line rounded to the paisa before the
  sum, not the sum rounded afterwards); the receive dialog showing the
  base quantities and how many tagged units it will create; the cancel
  dialog.
- **Issue desk** — a Check/Issue pair where **the Issue button is enabled
  by the server's verdict**, never by a client-side sum, and refusals go
  red per line.
- **Asset register** — the lifecycle actions gated per permission, and a
  "Print check sheet" PDF laid out with a blank right-hand column to tick.
- **Reports tab** — the six reports plus the stock-take wizard, with the
  valuation method printed beside the total.

## Components Created (new shared/reusable only)

None. The module reuses `DataTable` conventions, `Can`, `ConfirmDialog`,
`StatCard`, `EmptyState`, `ErrorState` and `LoadingBlock` as they stand.

## Business Rules Implemented

- The ledger is the source of truth; a balance is never edited directly
  (roadmap §6).
- Issue qty ≤ available; consumable returns ≤ issued (§6), both refused
  by the engine *and* by a CHECK.
- An **asset cannot be issued by quantity** — it is assigned one tagged
  unit at a time. Structural: no permission reaches it.
- DISPOSED/LOST units are excluded from register counts and kept in a
  separate written-off list (§6).
- Disposal requires `inventory.asset.dispose`, which the Office Staff
  baseline deliberately lacks (§6 "disposal needs approval permission").
- A RECEIVED purchase is immutable; cancel writes reversal entries (§6).
- Quantities are integers except for LITER and KG, and never carry more
  than three decimals (§7).
- Warranty ≥ purchase date (§7).
- An adjustment and a disposal each carry a mandatory reason (§4).
- A slip's status is **derived** (`deriveIssueStatus`), never assigned.
- An item whose type would change under an existing ledger is refused —
  ASSET and CONSUMABLE are two different shapes of history.

## Known Limitations

- **The valuation is `last price × qty`, not FIFO.** Roadmap §4 asks for
  exactly this and calls it "FIFO-simple"; it is a *replacement* value. A
  school that paid 300 for a ream in January and 380 in June values its
  whole remaining stock at 380. Real FIFO needs a cost layer per receipt
  and a consumption algorithm that walks them. The method is stored in
  `inventory.valuation_method` and printed on the report and the sheet.
- **Consumables are expensed at PURCHASE, not at issue.** This means the
  stock ledger and the ledger of accounts deliberately disagree about
  unissued stock — the store says 40 reams, the books say the paper was
  spent in March. Perpetual inventory accounting would reconcile them and
  needs a current-asset stock account plus the cost-flow method above. BD
  schools expense stores on purchase and roadmap §4 asks for an
  "expense/asset voucher" at RECEIVE.
- **A purchase posts Dr goods / Cr cash — there is no supplier payable.**
  A delivery taken on credit is the accountant's manual voucher; the
  seeded 61-account chart carries no creditors account, and inventing a
  subledger here would give the school two answers to "what do we owe".
- **M24 did not bring a room master**, which M13's and M14's debt entries
  had pointed at it for. Roadmap §24 §3 specifies free-text room/dept for
  an asset's location and asks for no `rooms` table; a room master is M06
  academic-structure work, and converting M13's `room_no` and M14's
  seat-plan rooms to FKs is a data migration on live data. Recorded as
  moved rather than closed — see *Remaining TODOs*.
- **Deleting a posted purchase's voucher is not automatic.** Cancelling a
  received delivery reverses the *stock* and leaves the M20 voucher
  standing, because `voucher.cancel` is a permission the store does not
  hold (the M25 precedent, verbatim). The response says so and the
  accountant is told.
- The catalogue, purchases and asset tables are **not virtualized** (the
  M12/M15/M22/M23/M25 caveat), and the asset-register PDF is plain pdfkit
  output whose default font cannot set Bangla (flagged since M09 ID
  cards) — `name_bn` is stored and never printed.
- `inventory.low_stock_alert_channel` is school-wide, so a school cannot
  put warranty alerts on the bell and low stock on SMS.
- The low-stock sweep has **no per-row `notified_at`**: it sends one
  summary per school per week, so the run itself is the unit of
  idempotency. A store keeper who wants per-item chasing needs it built.

## Future Improvements

- Perpetual inventory accounting (Dr Inventory at receipt, Cr at issue)
  with a real cost-flow method — the two limitations above are one piece
  of work.
- Barcode/QR labels for asset tags, reusing M23's hand-rolled Code 128-B
  encoder (`library/calc/barcode.util.ts`) — the tags are ASCII by
  construction, so it would drop straight in.
- A supplier payable subledger, or a link from a purchase to an M20
  manual voucher for credit purchases.
- Depreciation schedules on `asset_units` (M29 territory).
- A per-file media library so a purchase can carry a scanned invoice —
  the same gap M19/M20/M21/M23/M25 all carry.

## Breaking Changes

**None for existing callers.** Two internal shapes changed, both additive:

1. `PostingMapService.resolve()` now returns a fourth map,
   `inventoryCategories`. Existing consumers destructure the fields they
   use and are unaffected.
2. The same method's mapping loop was changed from a catch-all `else`
   into an **exhaustive switch**. Before this, any future
   `PostingMapKind` value would have been filed silently among the system
   slots, where nothing reads it and a refKey collision would be
   invisible. Nothing observable changes for `FEE_HEAD`,
   `PAYMENT_METHOD` or `SYSTEM`.

## Migration Steps

1. `npx prisma migrate deploy` — creates the nine tables, ten enums and
   the two enum extensions.
2. `npx prisma generate`.
3. Restart the API so the permission registry syncs the eleven new
   `inventory.*` codes and the role seeder extends the Principal, Office
   Staff and Accountant baselines.
4. Nothing else. The `inventory.*` settings have registry defaults, and
   the posting map falls back to the seeded chart by account code
   (`5500` for consumables, `1520` for assets), so a school that
   configures nothing still posts correctly.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. Every knob is a `inventory.*` school setting. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Migration replay onto an empty Postgres 16 | ✅ | 24 migrations, then `No difference detected` |
| Migration applied to Neon dev | ✅ | `No difference detected` |
| 9 tables / 13 CHECKs / 9 uniques / 10 enums present | ✅ | counted directly against the replayed DB |
| Backend `tsc --noEmit` | ✅ | clean |
| Backend `jest` | ✅ | **1844 tests / 126 suites** (was 1691 / 124 → **+153**) |
| Backend e2e | ✅ | **780 tests / 25 suites** (was 699 / 24 → **+81**, new suite) |
| Frontend `tsc --noEmit` | ✅ | clean |
| Frontend `vitest run` | ✅ | **480 tests / 38 files** (was 419 → **+61**) |
| `next build` | ✅ | emits `/admin/inventory` |
| `eslint` on every changed path | ✅ | clean (after the documented CRLF→LF re-save) |
| purchase → receive → issue → return chain | ✅ | e2e, including the 4-boxes-become-48-pens conversion |
| Disposal approval | ✅ | office 403, head 201, reason and approver recorded |
| Concurrent issues of one item | ✅ | e2e races three issues; the balance is exact |
| Ledger replay agrees with stored balances | ✅ | asserted row by row in the e2e report |

## What verification found

Three things, each recorded because the class of bug matters more than
the instance:

1. **`Number(null)` is `0`, and `Number.isFinite(0)` is `true`.** The
   settings service's `clamp()` helper rejected only `NaN`, so a **NULL**
   setting was read as zero and then clamped to the *minimum* rather than
   falling back to the registry default. For
   `inventory.max_asset_units_per_receipt` that means a school whose row
   is missing can receive exactly one chair per delivery. Caught by the
   settings spec on the first run. **M25's `TransportSettingsService`
   carries the identical helper and the identical defect** — a null
   `transport.expiry_alert_days` would silently become a one-day warning
   window on a bus's fitness certificate — and it is fixed there too.
   *A guard that tests for NaN has not tested for "no value".*

2. **`prisma migrate diff` caught four undeclared unique indexes.** The
   hand-written migration created `uq_purchases_no`,
   `uq_stock_issues_no`, `uq_purchase_items_identity` and
   `uq_stock_issue_items_identity` as **plain** uniques, which Prisma
   *can* express — so unlike the partial and expression-based ones, they
   showed as drift. Declaring them with `@@unique(…, map:)` took the
   replay to `No difference detected`. *The rule the codebase has been
   following implicitly, now stated: a partial or expression index is
   migration-only; a plain one must also be in the schema.*

3. **`eslint --fix` removed every `as StockUnit` / `as ItemKind` /
   `as StockTxn` assertion as unnecessary** — which is a *result*, not a
   nuisance. The `calc/types.ts` literal unions were written to mirror the
   PG enums by hand; the fixer proving the assertions redundant is proof
   that the two lists agree exactly, and `tsc` will now say so at the call
   site if a future migration adds a value to one and not the other.

The engines were also moved off `common/constants` mid-build: importing
the Prisma enums pulled the whole generated client into every engine and
every spec, and Jest's workers ran out of memory proving it. **No `calc/`
engine in this codebase imports `@prisma/client`** — M24 briefly broke
that rule and `types.ts` is what restores it.

## Remaining TODOs

- [ ] In-browser click-throughs: the purchase line grid with fifteen
      lines, the issue desk's Check→Issue path, the stock-take wizard
      against a full catalogue, the asset check sheet printed on A4, and
      the low-stock badge on a phone viewport.
- [ ] A **room master** — moved, not closed. M13 (`room_no` string
      matching) and M14 (free-text seat-plan rooms) both name M24 as
      where it would arrive; roadmap §24 does not ask for one, and the
      conversion is a data migration on live columns. It belongs with
      M06's masters, and M30 hardening is the honest home for the
      migration.
- [ ] Barcode labels for asset tags (M23's encoder is ready to reuse).
- [ ] Decide on perpetual inventory accounting before a school's first
      full fiscal year — the same decision M20's accrual-mode debt asks
      for, and they interact.

## Links to Related Modules

- **Depends on:** Module 07 (departments and the employees a gate pass is
  issued to — read through a narrow directory repository, *not* by
  importing StaffModule or TeacherModule), Module 04 (settings), Module 07
  (`SequenceService`), Module 17 (`NotificationService.send`), Module 20
  (`VoucherService.postAuto`).
- **Unlocks / hooks completed for:** nothing was left as a no-op. Every
  integration this module declares is bound to a real implementation on
  the day it ships. M23's informational note ("books as inventory assets
  — `1530 Books & Library Assets` is already seeded") is answered by the
  `INVENTORY_CATEGORY` posting map: a school maps its "Library Books"
  category to `1530` and book purchases capitalize there. The two
  registers stay separate — the accession register is M23's, and
  duplicating it here would give the librarian two places to look.
- **Leaves for 29:** consumption analytics and asset depreciation.
- **Leaves for 30:** the room master's data migration.
- `PROJECT_CONTEXT.md` sections updated: §5 (shared services), §8 (entity
  spine), §11 (global business rules), §16 (decisions), §18 (debt).
