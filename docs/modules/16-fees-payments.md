# Module 16 — Fees & Payments · Completion Document

| | |
|---|---|
| **Module** | 16 — Fees & Payments |
| **Completion date** | 2026-07-23 |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 16 |

## Summary of Implemented Features

- **Fee heads and the structure matrix** — chargeable items (`RECURRING_MONTHLY`, `ONE_TIME`, `ON_DEMAND`), each flagged refundable or not, priced per class × head for a session. A non-refundable head (admission) refuses refunds outright.
- **Per-student overrides** — discounts (percent or flat), full waivers and scholarships, each with a mandatory audited reason and an optional validity window. Percentages are capped at 100 by a DB CHECK, the engine, and the client.
- **Invoice generation** — the monthly batch bills every recurring head, **prorated** for a mid-month joiner, **idempotent** per `(enrollment, month)`; an ad-hoc run bills explicit lines (the roadmap's "exam fee for class 8"). `dryRun` previews the batch without writing.
- **Five dependency-free engines**, golden-tested: money math (`money.util.ts`), proration and discount stacking (`invoice.engine.ts`), oldest-due-first allocation (`payment.engine.ts`), late-fine assessment and the invoice status machine (`fine.engine.ts`).
- **The collection desk** — one sum against several invoices, allocated oldest-due-date-first across siblings, offline methods recorded directly (cash / bank / cheque / adjustment). Overpayment is refused unless the collector holds `fee.overpay`.
- **Refunds** — whole or partial, blocked against a non-refundable head and never exceeding what was paid; the invoice status is re-derived afterward.
- **Late fines** — a nightly job charges a flat and/or percent fine per overdue month, **once per calendar month** however many times it runs (`fined_for_month` guard), recomputing `payable` and status through the same `deriveStatus` every other money path uses.
- **Online payments** — SSLCommerz / bKash / Nagad behind an adapter interface. A checkout parks the money as `PENDING`; the callback trusts nothing in its body and **asks the gateway's own API** (`verify()`) for the verdict; the gateway's figure must match what we asked for or the payment is refused. An hourly **reconciliation job** re-verifies payments left `PENDING` (the payer closed the app before the callback fired).
- **Ledger and reports** — a running per-student ledger (the dues source every other module reads), dues with aging buckets + defaulter list, daily collection by method/day, and head-wise income. Receipts (A5 and 80 mm thermal) and invoices as PDF; dues / daily / head-wise as XLSX.

## Database Changes

Migration `prisma/migrations/20260723090000_fees_payments/migration.sql`.

**Enums**
- `fee_head_type_enum` — `RECURRING_MONTHLY | ONE_TIME | ON_DEMAND`
- `fee_override_type_enum` — `DISCOUNT_PERCENT | DISCOUNT_FLAT | WAIVER | SCHOLARSHIP`
- `invoice_status_enum` — `UNPAID | PARTIAL | PAID | OVERDUE | CANCELLED | REFUNDED`
- `payment_method_enum` — `CASH | BANK | SSLCOMMERZ | BKASH | NAGAD | ROCKET | CHEQUE | ADJUSTMENT`
- `payment_status_enum` — `PENDING | SUCCESS | FAILED | REFUNDED | CANCELLED`

**Tables** — `fee_heads`, `fee_structures`, `student_fee_overrides`, `invoices`, `invoice_items`, `payments`, `payment_refunds`.

**Hand-written constraints** (Prisma cannot express them)
- `chk_fee_overrides_value` — a `DISCOUNT_PERCENT` value is 0–100; a `WAIVER` is 0.
- `chk_invoices_amounts` / `chk_invoices_payable` — `payable = subtotal − discount + fine`, all non-negative; the fine job moves `payable` in step with the fine because the CHECK would refuse the write otherwise.
- `chk_invoices_dates` (due ≥ issue), `chk_invoices_cancellation` (a cancelled invoice states its reason), `chk_invoice_items_amounts`, `chk_fee_structures_amount`, `chk_payments_amount`.
- `chk_payments_success_evidence` — a `SUCCESS` payment must carry `paid_at`, and an online method must also carry `verified_at`. **This is what makes a forged callback insufficient to credit money.**
- `chk_payment_refunds_amount` — a refund is positive.
- Unique indexes: `uq_fee_heads_name`, `uq_fee_heads_code`, `uq_fee_structures_identity`, `uq_invoices_no`, `uq_invoices_enrollment_month` (one monthly bill per candidate per month — ad-hoc invoices carry no month and never collide), `uq_payments_no`, `uq_payments_gateway_txn`.

Objects created: **7 tables, 5 enums, 11 CHECKs, 7 unique indexes** — asserted on both a clean local Postgres 16 and on Neon.

## API Endpoints Added

```
GET/POST/PUT/DELETE /api/v1/fee-heads            (+ list in display order)
GET/PUT/DELETE      /api/v1/fee-structures        PUT bulk-saves the matrix; POST /clone
GET/POST/PUT/DELETE /api/v1/fee-overrides         (per enrollment)

GET  /api/v1/invoices            /invoices/summary   /invoices/:id   /invoices/:id/pdf
POST /api/v1/invoices/generate   (dryRun previews)   /invoices/:id/cancel
GET/POST /api/v1/invoices/:id/payments

POST /api/v1/payments/collect                    GET /api/v1/payments/:id
GET  /api/v1/payments/:id/receipt.pdf  (?layout=thermal)
POST /api/v1/payments/:id/refund
POST /api/v1/payments/online/init                POST /api/v1/payments/:id/reconcile
POST /api/v1/payments/callback/:gateway          (@Public — server-side verified)

GET  /api/v1/fee-reports/daily | monthly | dues | defaulters | head-wise
GET  /api/v1/fee-reports/daily.xlsx | dues.xlsx | head-wise.xlsx
GET  /api/v1/students/:id/dues | ledger
```

**11 permission codes**: `fee.view`, `fee.setup`, `fee.override.manage`, `fee.override.approve`, `fee.invoice.generate`, `fee.invoice.cancel`, `fee.collect`, `fee.refund`, `fee.overpay`, `fee.report`, `fee.export`. The seeded **Accountant** role deliberately lacks `fee.override.approve` and `fee.overpay` — separation of duties: the person taking money at the desk is not the one authorising waivers or overpayments.

**14 `fees.*` settings**: `prorate_enabled`, `prorate_include_join_day`, `fine_flat_per_month`, `late_fee_percent`, `fine_grace_days`, `fine_cap`, `due_day_of_month`, `invoice_no_pattern`, `payment_no_pattern`, `allow_overpayment`, `receipt_footer`, `receipt_sms_enabled`, `receipt_sms_template`, `dues_sms_template`.

## Frontend Pages Created

- **`/admin/fees`** — a four-tab workspace, session-scoped to the header switcher:
  - **Setup** — fee-head CRUD, and the class × head **structure matrix** (an editable grid seeded from the saved matrix with a dirty-aware bulk save).
  - **Invoices** — filters (class / status / month / search), the **generate dialog** with a dry-run preview table before committing, and an invoice detail dialog with its lines, payments (receipt download + refund), PDF and cancel.
  - **Collection desk** — search a student's outstanding invoices, tick several, and **take one sum** allocated oldest-first, with A5 and thermal receipts and a collapsible running **ledger**.
  - **Reports** — dues with aging buckets and a defaulter list, daily collection by method/day, head-wise income, each with an XLSX export.
- **`/admin/students/[id]` → Fees tab** — the student's dues summary (billed / paid / outstanding), the **per-student concessions** (list / add / remove, gated `fee.override.manage`, the roadmap's "overrides on the student profile Fees tab"), and a running ledger. The concession attaches to the student's enrollment for the selected session, which the ledger resolves.
- Sidebar entry added (`fee.view`), between Final Results and Teachers.

## Components Created (new shared/reusable only)

None — built entirely on the existing shared set (`PageHeader`, `Can`, `EmptyState`, `ErrorState`, `LoadingBlock`, `Spinner`, `ConfirmDialog`) and vendored shadcn primitives. A `formatBDT` money helper lives with the fee API client (`lib/api/fee.ts`) rather than in the shared UI layer, since it is fee-specific.

## Business Rules Implemented

- `payable = subtotal − discount + fine`, never negative (CHECK + engine + client); a payment can never leave `paid_total` above `payable` unless the collector holds `fee.overpay`.
- **A fully-waived invoice (payable 0) is `PAID` from birth** — its status is derived, so the nightly fine job never touches it (see the bug below).
- The monthly batch is **idempotent** per `(enrollment, month)`; a re-run bills nobody twice. An ad-hoc invoice carries no `billing_month` and so never collides with that unique.
- **Proration** bills a mid-month joiner for the fraction of the month they were enrolled, controlled by `fees.prorate_enabled` / `prorate_include_join_day`.
- A payment is allocated **oldest-due-date-first** across the selected invoices.
- **A refund is refused against a non-refundable head, and never exceeds what was actually paid**; the invoice status is re-derived after.
- A late fine is charged **at most once per calendar month** (`fined_for_month`), even though the job runs nightly, and only on `UNPAID | PARTIAL | OVERDUE` invoices.
- **Only a server-side `verify()` may conclude `SUCCESS`** for online money; `parseCallback` returns which payment a callback concerns, never a verdict, and the gateway's reported amount must equal what we asked for.
- Invoices are read-only once the session is `COMPLETED`/`ARCHIVED` (the M05 rule).

## Design Decisions

### The invoice status is derived, never assigned
A fully-waived invoice (payable 0) is `PAID` from birth, so the nightly fine job never picks it up. Generation now calls the same `deriveStatus` every other money path uses instead of hard-coding `UNPAID` — see the bug below. Because `dueDate ≥ issueDate` is enforced, a payable-bearing invoice is still `UNPAID` at creation, unchanged.

### `verify()` is the only thing that may conclude SUCCESS
A gateway's redirect carries parameters anyone can forge, so `parseCallback` returns only *which payment this is about*; the outcome comes from the gateway's own API, and the amount it reports must match what we asked for. The reconciliation job uses the same `verify()`, so a payment settled by the hourly sweep took exactly the path a successful callback would have — and `chk_payments_success_evidence` makes the `verified_at` stamp a database-level requirement, not a convention.

### Collection counts from `payments`, dues from `invoices`
They answer different questions — money received in July against a June bill is July's collection and was June's due — so the reports never conflate the two tables.

### The Accountant role omits two permissions on purpose
`fee.override.approve` and `fee.overpay` are withheld from the desk role so that authorising a waiver or accepting an overpayment is a different person's decision — separation of duties encoded in the RBAC seed, not left to policy.

## Known Limitations

- **Rocket** is enumerated in `payment_method_enum` but has no adapter; SSLCommerz / bKash / Nagad do.
- Receipts and invoices use pdfkit's default font, so a Bangla name renders in transliteration only — the same limitation flagged for M09 ID cards, M13 routines and M15 report cards; the EN/BN report engine is an M18 concern.
- The public callback resolves `DEFAULT_SCHOOL_ID`, like the M10 public admission endpoints — multi-tenant public routing is an M31 concern.
- The fee structure grid and the invoice list are not virtualized — the same large-class caveat M12's attendance grid and M15's mark grid carry.
- The daily-collection report loads each matching payment to aggregate; a very wide date range will want that pushed into SQL.

## Future Improvements

- A guardian/student **portal payment view** (M18): a child's outstanding invoices and an online-pay button through the existing `PaymentGatewayService`.
- The Rocket adapter, when a merchant account exists.
- Automatic **result-withhold on dues** — `ResultsService.setWithheld` is the hook M15 left; `LedgerService.outstandingFor` is now live to drive it.
- SMS on receipt and on dues (`fees.receipt_sms_*` / `dues_sms_template` are wired for it) once M17 makes delivery real.
- A cheque-clearing state between `PENDING` and `SUCCESS` for post-dated cheques.

## Breaking Changes

**None to existing callers.** All changes are additive: seven new tables, 11 new permission codes, 14 new `fees.*` settings, and the two cross-module gates below, which were previously documented no-ops (M14 `EXAM_DUES_GATE`) or stub text (M09 status-change warning). Placeholder assertions in `student.e2e-spec.ts` and the stub text in `fee.e2e-spec.ts` were updated to the real behaviour.

Additive changes other modules should know about:
- `LedgerService.outstandingFor(enrollmentIds, schoolId)` is exported for dues gates.
- `PaymentGatewayService.openSession(...)` is exported so M10's admission fee can pay through the same adapters.
- `StudentsService` status-change now returns a `warnings` array.

## Migration Steps

1. `npm run migrate:deploy` (applies `20260723090000_fees_payments`).
2. **`npx prisma generate`** — the client must be regenerated after this schema change; skipping it crashes at load on the new `InvoiceStatus` enum (the bug below).
3. `npm run seed` — syncs the 11 new permission codes and seeds the Accountant baseline (deliberately without `fee.override.approve` / `fee.overpay`). Idempotent.
4. New `fees.*` settings appear in Settings → Fees with defaults. Review before the first invoice run: `fees.due_day_of_month`, `fees.fine_flat_per_month` / `late_fee_percent` / `fine_grace_days`, `fees.prorate_enabled`.
5. Per-school gateway credentials (`payment.sslcommerz_*`, `payment.bkash_*`, `payment.nagad_*`) are set in Settings → Payment and stored encrypted (M04); online payment is inert until they are present.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. Gateway credentials are per-school settings, encrypted at rest (M04), not env vars. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Backend unit suite | ✅ 883 passed | Was 808 — **75 new** (M16 golden/engine tests) |
| **Backend e2e suite** | ✅ **323 passed (16 suites)** | Was 280/15 — includes the **43-case `fee.e2e-spec.ts`** |
| `fee.e2e-spec.ts` | ✅ 43 passed | Permission guards, setup, generation (proration/idempotency/ad-hoc), collection, refunds, fines, **online payments through a stubbed gateway**, ledger/reports, cross-module guards, raw DB-constraint checks |
| Migration onto a clean Postgres 16 | ✅ full 15-migration chain applied in order | |
| `prisma migrate status` / `diff` on **Neon** | ✅ up to date · **No difference detected** | Zero drift, 15 migrations applied |
| Objects created | ✅ 7 tables, 5 enums, 11 CHECKs, 7 unique indexes | |
| Frontend test suite (`vitest run`) | ✅ 205 passed (24 files) | Was 195/23 — **10 new** (`fee.test.ts`) |
| Frontend typecheck (`tsc --noEmit`) | ✅ clean | |
| Frontend lint (`eslint` on the fee tree) | ✅ 0 errors | Caught a `setState`-in-effect in the structure grid; rewritten to a render-time reset |
| Frontend production build (`next build`) | ✅ compiled | `/admin/fees` emitted |

## Bugs found during verification

### The Prisma client was stale (found by the e2e suite)
The generated client was missing the runtime `InvoiceStatus` enum export, so `invoices.repository.ts` building a top-level `OUTSTANDING` array crashed the whole fee e2e suite at load: `Cannot read properties of undefined (reading 'UNPAID')`. The unit suite never saw it because it mocks the repository. **Lesson:** `prisma generate` must follow any schema change, and an enum used as a *value* (not just a type) fails only at runtime — added to the migration steps.

### A fully-waived invoice was being late-fined (found by the e2e suite)
Invoice generation hard-coded `status: UNPAID`, so a payable-0 waived invoice landed in `OUTSTANDING`, was picked up by `findFinable`, and the nightly fine job charged it a 100 flat fine — turning a waived bill into a due, which the `EXAM_DUES_GATE` test then surfaced as a spurious outstanding balance. The engines were all correct (`deriveStatus` maps `payable ≤ 0 ⇒ PAID`); only the write path bypassed them by assigning the status by hand. Fixed by deriving it. **Lesson:** the module's own rule — "status is derived, never assigned" — has to hold at *creation* too, not only on the update paths; a single hand-assigned status silently defeats a downstream guard three describe-blocks away.

## Cross-module debts closed

| Debt | Where | Status |
|---|---|---|
| `EXAM_DUES_GATE` is a no-op (M14) | `LedgerService.outstandingFor` | **Live** — real outstanding dues to the admit-card flow |
| M09 student status-change dues warning was stub text | `StudentsService` status change | **Live** — returns a `warnings` array naming the BDT outstanding on exit/transfer |
| M10 admission fee gateway wiring ("= M16") | `PaymentGatewayService.openSession` | **Live** — the adapters M10 deferred |

Still inert: `exam.admit_card_block_dues` *blocking* (as opposed to warning) is a UI/policy toggle left for the admit-card print flow to honour.

## Remaining TODOs

- [ ] In-browser click-throughs: the structure-matrix grid saved for a full class, the generate dry-run → commit path, a receipt printed on an 80 mm thermal roll, and a refund against a non-refundable head refused in the UI.
- [ ] The **Rocket** adapter (enumerated, unimplemented).
- [ ] Module 17 makes the receipt/dues SMS real (the templates are wired here).
- [ ] Module 18 renders a guardian/student payment view over the live ledger and `PaymentGatewayService`.
- [ ] Repo-level: still no `.gitattributes` (`* text=auto eol=lf`) — the CRLF/LF split continues to produce phantom prettier warnings.

## Links to Related Modules

- **Depends on:** Module 04 (settings + encrypted gateway credentials), Module 05 (session read-only rule + scoping), Module 06 (classes/sections for the structure matrix), Module 07 (`SequenceService` for invoice/payment numbers), Module 11 (the canonical roster — every invoice keys on `enrollment_id`).
- **Unlocks / hooks completed for:**
  - **Module 10** — `PaymentGatewayService.openSession` is the admission-fee online path M10 reserved its `payment_ref`/`payment_method`/`paid_at` columns for.
  - **Module 14** — `EXAM_DUES_GATE` is now live via `LedgerService.outstandingFor`.
  - **Module 17** — receipt and dues SMS are queued through the existing `notifications` contract and become real when delivery lands.
  - **Module 18** — `LedgerService`, `InvoiceService`, `CollectionService` and `PaymentGatewayService` are exported for a portal payment view.
- **`PROJECT_CONTEXT.md` sections updated:** §5 (shared services), §8 (entity spine), §11 (global business rules), §16 (technical decisions), §18 (technical debt).
