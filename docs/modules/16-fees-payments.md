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
- `chk_payments_success_evidence` — a `SUCCESS` payment must carry `paid_at`, and an online method must also carry `verified_at`. This is what makes a forged callback insufficient to credit money.
- `chk_payment_refunds_amount` — a refund is positive.
- Unique indexes: `uq_invoices_no`, `uq_invoices_enrollment_month` (one monthly bill per candidate per month — ad-hoc invoices carry no month and so never collide), `uq_payments_no`, `uq_payments_gateway_txn`.

Migration verified on a clean local Postgres 16 **and** on the Neon dev database (`migrate status` up to date, `migrate diff` reports no difference — zero drift).

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

**14 `fees.*` settings**, including proration toggles, fine flat/percent/grace/cap, due day, invoice/payment number patterns, receipt footer and the dues/receipt SMS templates.

## Frontend Pages Created

- **`/admin/fees`** — a four-tab workspace, session-scoped to the header switcher:
  - **Setup** — fee-head CRUD, and the class × head **structure matrix** (an editable grid; a dirty-aware bulk save).
  - **Invoices** — filters (class / status / month / search), the **generate dialog** with a dry-run preview table before committing, and an invoice detail dialog with its lines, payments (receipt download + refund), PDF and cancel.
  - **Collection desk** — search a student's outstanding invoices, tick several, and **take one sum** allocated oldest-first, with A5 and thermal receipts and a collapsible running **ledger**.
  - **Reports** — dues with aging buckets and a defaulter list, daily collection by method/day, head-wise income, each with an XLSX export.
- Menu entry added to the admin sidebar (`fee.view`).

## Design Decisions

### The invoice status is derived, never assigned
A fully-waived invoice (payable 0) is `PAID` from birth, so the nightly fine job never picks it up. Generation now calls the same `deriveStatus` every other money path uses instead of hard-coding `UNPAID` — see the bug below.

### `verify()` is the only thing that may conclude SUCCESS
A gateway's redirect carries parameters anyone can forge, so `parseCallback` returns only *which payment this is about*; the outcome comes from the gateway's own API, and the amount it reports must match what we asked for. The reconciliation job uses the same `verify()`, so a payment settled by the hourly sweep took exactly the path a successful callback would have.

### Collection counts from `payments`, dues from `invoices`
They answer different questions — money received in July against a June bill is July's collection and was June's due — so the reports never conflate the two tables.

## Cross-module debts closed

- **`EXAM_DUES_GATE`** (M14's documented no-op) is now live: `LedgerService.outstandingFor()` reports real outstanding dues to the exam admit-card flow.
- **M09 student status change** now returns a `warnings` array mentioning the BDT outstanding when a student is exited/transferred with dues.

## Bugs found during verification

### The Prisma client was stale (found by the e2e suite)
The generated client was missing the runtime `InvoiceStatus` enum export, crashing the whole fee e2e suite at load (`Cannot read properties of undefined (reading 'UNPAID')`). Regenerating the client fixed it; a reminder that `prisma generate` must follow a schema change.

### A fully-waived invoice was being late-fined (found by the e2e suite)
Invoice generation hard-coded `status: UNPAID`, so a payable-0 waived invoice was swept up by the nightly fine job and charged a 100 fine — turning a waived bill into a due. Fixed by deriving the status (`payable ≤ 0 ⇒ PAID`), which excludes it from `findFinable`. Because `dueDate ≥ issueDate` is enforced, payable-bearing invoices still start `UNPAID`, unchanged.

## Manual Testing Results

- Backend unit suite green; `fee.e2e-spec.ts` at **43 cases** (permission guards, fee setup, invoice generation with proration/idempotency/ad-hoc, collection desk, refunds, late fines, **online payments through a stubbed gateway** — init → server-verified callback → SUCCESS with `verified_at`, amount-mismatch refusal, reconciliation of a stale PENDING — ledger/reports, cross-module guards, and raw DB-constraint checks driven past the service layer).
- Full backend e2e suite green with the whole dev stack (Postgres + Redis + MinIO + Mailpit) up.
- Frontend `tsc`, ESLint and `next build` clean.

## Remaining TODOs

- Rocket adapter is enumerated but not implemented (SSLCommerz / bKash / Nagad are).
- A guardian/student-portal payment view is deferred to Module 18 (Portals).

## Links to Related Modules

- **M05** session scoping and `CalendarService`; **M06** classes/sections; **M11** the enrollment roster (`getSectionStudents`); **M07** `SequenceService` for invoice/payment numbers; **M04** encrypted per-school gateway credentials; **M14** `EXAM_DUES_GATE`; **M09** the student status-change dues warning; **M10** reuses `PaymentGatewayService.openSession` for the admission fee.
