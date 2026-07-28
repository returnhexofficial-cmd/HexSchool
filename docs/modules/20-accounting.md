# Module 20 — Accounting & Finance · Completion Document

| | |
|---|---|
| **Module** | 20 — Accounting & Finance |
| **Completion date** | 2026-07-28 |
| **Actual effort** | 1 dev-day (est. was 6) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 20 |

## Summary of Implemented Features

The school's books, in double entry — and the first module whose output an
outside auditor reads.

- **Chart of accounts** as a tree per school over five fixed groups
  (Asset / Liability / Equity / Income / Expense), seeded with a **61-account
  BD-school default** (Cash in Hand, bank and per-gateway clearing accounts,
  tuition / admission / exam / transport income, salary, utilities, gateway
  charges…). A node is either a **heading** (a subtotal, holds no money) or a
  **leaf** (postable). Five accounts are marked `is_system` — auto-posting
  resolves through them and they may be renamed but never deleted or
  deactivated.
- **Vouchers** in four kinds (`DEBIT` payment / `CREDIT` receipt / `JOURNAL` /
  `CONTRA`), numbered per type per year through the shared `SequenceService`
  (`DV/CV/JV/CN-{YY}-{SEQ5}`). A voucher is a `DRAFT` until posted;
  **a POSTED voucher is immutable** and is corrected only by `cancel()`,
  which writes a **mirror-image reversal** and leaves both documents standing.
- **Five dependency-free engines**, golden-tested (**103 tests**):
  `voucher.engine.ts` (Σdebit = Σcredit to the paisa, per-line shape,
  leaf-only posting, the voucher-type conventions, reversal construction,
  natural sides), `coa.engine.ts` (tree building, cycle detection, code
  suggestion), `ledger.engine.ts` (running balances that carry a **side**,
  cash/bank book shape), `reports.engine.ts` (trial balance, income
  statement, balance sheet, receipts & payments, budget variance),
  `posting.engine.ts` (the largest-remainder split, settlement and
  opening-balance entries).
- **Auto-posting from M16.** `payment.success` → `Dr` cash/bank/gateway
  clearing, `Cr` fee income **split per fee head**; `payment.refunded` →
  the mirror of the original voucher, scaled for a partial refund. Keyed on
  `source_ref` (`payment:<id>`) behind a partial unique, so a replayed event,
  a reconciliation sweep and a double-clicked callback all land **one**
  voucher.
- **Eight reports**, all date-range, all XLSX and four also PDF: cash book,
  bank book, general ledger (running balance + drill-down), trial balance,
  income & expenditure, balance sheet, receipts & payments, budget vs actual.
- **Period close.** A `CLOSED` fiscal period locks every voucher dated inside
  it; reopening is its own permission (`accounting.period.reopen`) and demands
  a reason. A backdated payment arriving after a close posts into the next
  **open** period **with a note** — roadmap §8's documented BD behaviour.
- **The two §8 tools**: the **gateway settlement** entry (`Dr` bank net,
  `Dr` gateway charges, `Cr` clearing gross) and the **opening-balance
  journal wizard**, which balances an honestly-incomplete opening set through
  the capital-fund account.
- **11 permission codes, 13 `accounting.*` settings**, Principal and
  Accountant baselines.

## Database Changes

Migration `prisma/migrations/20260728120000_accounting_finance/migration.sql`
— **6 tables, 8 enums, 6 unique indexes (5 partial), 10 CHECK constraints.**

| Table | Shape |
|---|---|
| `accounts` | the COA tree: `group`, `type`, `parent_id`, `code`, `opening_balance`, `is_group`, `is_system`, `is_active`, bank identity columns |
| `vouchers` | `voucher_no`, `type`, `source`, `status`, `date`, `narration`, `reference`, **`source_ref`**, `fiscal_period_id`, `posted_*`, `cancelled_*`, `reversal_of_voucher_id` |
| `voucher_entries` | one line: `account_id`, `debit`, `credit`, `narration`, `display_order` — **hard-deleted** with its voucher and replaced as a set while DRAFT |
| `budgets` | `session_id` × `account_id` × (`YEARLY` \| `MONTHLY` + `month`) |
| `fiscal_periods` | `name`, `start_date`, `end_date`, `OPEN`/`CLOSED`, closed/reopened evidence |
| `posting_maps` | `kind` (`FEE_HEAD`/`PAYMENT_METHOD`/`SYSTEM`) × `ref_key` → `account_id` |

New enums: `account_group_enum`, `account_type_enum`, `voucher_type_enum`,
`voucher_source_enum`, `voucher_status_enum`, `budget_period_enum`,
`fiscal_period_status_enum`, `posting_map_kind_enum`; `settings_group_enum`
gains `accounting`.

**Hand-written objects** (Prisma cannot express them):

- `uq_accounts_code` — live rows only; a code is a filing position, so
  deleting an account frees it (unlike a document number).
- **`uq_vouchers_source_ref`** — the auto-posting idempotency key, partial
  over `source_ref IS NOT NULL AND status <> 'CANCELLED'`. Without it a
  replayed event doubles a school's income and **no report would flag it**,
  because both vouchers balance perfectly.
- `uq_posting_maps_key`, `uq_fiscal_periods_name`, `uq_budgets_identity`
  (COALESCE over the nullable `month` — the M06 trick).
- `chk_voucher_entries_one_sided` — `debit >= 0 AND credit >= 0 AND
  (debit = 0 OR credit = 0) AND debit + credit > 0`. The sign guard is the
  part the roadmap's two CHECKs do not state: **a −100 debit is a +100 credit
  in disguise, and it would slip past the balance test.**
- `chk_vouchers_status_evidence`, `chk_vouchers_source_ref_shape`,
  `chk_accounts_group_node_empty`, `chk_accounts_parent_not_self`,
  `chk_budgets_period_month`, `chk_budgets_amount`,
  `chk_fiscal_periods_range`, `chk_fiscal_periods_closed_evidence`,
  plus the display-order guards.

**Deliberately NOT a DB trigger:** the roadmap asks for a "DB-level trigger
safety net" on Σdebit = Σcredit. A CHECK cannot see sibling rows, and a
per-row trigger would reject the first line of every legitimate two-line
voucher. The invariant lives in `voucher.engine.ts`, is asserted inside the
same transaction that writes the lines, and is **re-asserted by the trial
balance** — the report that would expose a violation. The migration says so
in a comment where a reader would look for the trigger.

## API Endpoints Added

```
GET    /api/v1/accounts                       ?group&type&search&postableOnly&activeOnly
GET    /api/v1/accounts/tree
GET    /api/v1/accounts/suggest-code          ?group&parentId
GET    /api/v1/accounts/:id
POST   /api/v1/accounts
PATCH  /api/v1/accounts/:id
DELETE /api/v1/accounts/:id

GET    /api/v1/vouchers                       ?type&status&source&from&to&accountId&search&page&limit
GET    /api/v1/vouchers/:id
POST   /api/v1/vouchers                       (`post: true` posts in one call)
PATCH  /api/v1/vouchers/:id                   (DRAFT only)
POST   /api/v1/vouchers/:id/post
POST   /api/v1/vouchers/:id/cancel
GET    /api/v1/vouchers/:id/print.pdf
POST   /api/v1/vouchers/tools/settlement
POST   /api/v1/vouchers/tools/opening-balances

GET    /api/v1/accounting/posting-map
PUT    /api/v1/accounting/posting-map
GET    /api/v1/accounting/reports/cash-book|bank-book|ledger|trial-balance
                                  |income-statement|balance-sheet
                                  |receipts-payments|budget-vs-actual
GET    /api/v1/accounting/reports/<name>.xlsx           (all eight)
GET    /api/v1/accounting/reports/trial-balance|income-statement
                                  |balance-sheet|receipts-payments .pdf

GET    /api/v1/budgets ?sessionId    POST /api/v1/budgets
PATCH  /api/v1/budgets/:id           DELETE /api/v1/budgets/:id

GET    /api/v1/fiscal-periods        POST /api/v1/fiscal-periods
PATCH  /api/v1/fiscal-periods/:id    DELETE /api/v1/fiscal-periods/:id
POST   /api/v1/fiscal-periods/:id/close
POST   /api/v1/fiscal-periods/:id/reopen
```

## Frontend Pages Created

- **`/admin/accounting`** — one workspace, five tabs in the order the books
  are actually kept:
  - **Vouchers** — the register (date range / type / status / search) and the
    entry screen: dynamic Dr/Cr rows with account autocomplete, typing in one
    column clearing the other, and the **live balance indicator** that keeps
    Post disabled until the difference is exactly zero, with a running
    "out by X (debit heavy)" readout.
  - **Chart of accounts** — a collapsible tree per group, headings visually
    distinct, system accounts badged and undeletable, create dialog with
    **code auto-suggest** under whichever node you add to.
  - **Reports** — parameter bar + tabular results for all eight, XLSX/PDF
    export, and the roadmap's **drill-down chain**: a trial-balance row (or
    any statement line) jumps to that account's ledger for the same window,
    and a ledger row names the voucher behind it.
  - **Budgets & periods** — the budget editor and the fiscal-period list with
    close/reopen.
  - **Posting map** — fee head → income account, payment method → cash / bank
    / **clearing** account, and the five system slots, each stating what a
    blank row falls back to.
- Sidebar entry gated on `accounting.view`.

## Components Created (new shared/reusable only)

None. The workspace is built from the existing `PageHeader` / `Can` /
`ConfirmDialog` / `EmptyState` / `ErrorState` / `LoadingBlock` set plus
shadcn primitives — the COA tree and the voucher grid are specific enough to
this module that promoting them would be premature (the `MasterCrud` rule).

## Business Rules Implemented

- **Σdebit = Σcredit exactly**, per voucher, checked before anything is
  written and again at post time (a draft's accounts may have been
  deactivated or turned into headings while it sat there — the M13
  publish-re-runs-the-engine rule).
- **Leaf-only posting.** A heading is a subtotal; posting to one would count
  the amount twice. `is_group` is a column, not "has no children", so a
  heading with no children yet already refuses.
- **A POSTED voucher is immutable.** Cancelling writes a reversal dated
  **today** — not on the original's date, which would silently restate a
  month the school has already signed off.
- **An auto-posted voucher may never be hand-edited** — it is the machine's
  record of a real payment, and editing it would make the ledger disagree
  with the receipt the payer holds.
- **A child account inherits its parent's group**, silently and always; and
  the group cannot change once anything has been posted, because it decides
  which statement the account appears on.
- **No posting into a CLOSED period** — except the roadmap §8 case: a
  backdated payment posts into the next open period **with a note**
  (`accounting.backdate_after_close`, default on; off makes it a refusal).
- **Closing refuses over a DRAFT** dated inside the range, naming the count.
- **Cash may not go negative** — `HARD` refuses, `SOFT` warns (default),
  `OFF` skips. A physical cash box cannot hold less than nothing, but a
  school mid-adoption often has exactly that on paper.
- **A voucher may not be dated into the future** beyond
  `accounting.future_voucher_days` (default 0) — a school records what
  happened.
- **Only income and expense accounts carry a budget**; the variance report
  compares a plan against a *flow*, so budgeting an asset would compare
  incomparable things. Over-earning income is favourable, over-spending an
  expense is not — the same signed number, read by group.
- **Separation of duties in the seeded roles**: the Accountant keeps the
  books (accounts, vouchers, posting map, budgets, close) but gets **neither
  `voucher.cancel`** (reversing a posted voucher is the head's call) **nor
  `accounting.period.reopen`** (the person who closed the books must not be
  able to quietly reopen them). Both sit with the Principal — the M16
  `fee.override.approve` precedent.

## Known Limitations

- Auto-posting is **income-on-receipt**, as roadmap §4 specifies — an
  invoice raised and unpaid does not touch the ledger, so `1410 Fees
  Receivable` is seeded but unused until a school opts into accrual.
- The **budget-vs-actual** report rolls monthly lines up to one row per
  account; there is no month-by-month variance grid yet.
- The **general ledger loads every posted entry in the window** to compute
  "particulars" (the other accounts on each voucher); push it into SQL when
  a school has a long history — the same caveat M13's conflict engine and
  M15's analytics carry.
- Voucher **attachments** are a URL column (`attachment_url`), not an upload
  — the same gap M19 has for content images.
- Accounting PDFs are plain pdfkit output: unbranded, and the default font
  cannot set Bangla (the limitation flagged since M09 ID cards). `name_bn` is
  stored and returned but only the English name prints.
- The COA tree has **no drag-to-nest** — re-parenting is a field in the edit
  dialog. The cycle check behind it is real; only the gesture is missing.
- Multi-currency is out of scope: every amount is `NUMERIC(12,2)` BDT.

## Future Improvements

- Accrual mode: post `Dr Receivable / Cr Income` at invoicing and
  `Dr Cash / Cr Receivable` at payment, behind a setting.
- Closing entries at period close (transfer income/expense to accumulated
  surplus) — roadmap §4 calls them optional and they are not built.
- A month-by-month budget variance grid, and budget import from last year.
- Cost centres / departments as a second dimension on `voucher_entries`.
- Bank reconciliation against an imported statement.

## Breaking Changes

**None for existing callers.** Two behavioural additions to Module 16 that a
deployment should know about:

1. `CollectionService.collect()` / `refund()` and
   `PaymentGatewayService.handleCallback()` / `reconcile()` now **emit**
   `payment.success` / `payment.refunded`. Both take `EventEmitter2` as a new
   constructor argument — any code constructing them directly (test doubles)
   must pass one.
2. With `accounting.auto_post_fees` on (the default), every successful fee
   payment now writes a voucher. A school that does not want a ledger turns
   `accounting.enabled` off; nothing else changes.

## Migration Steps

1. `npx prisma migrate deploy` — applies
   `20260728120000_accounting_finance` (6 tables, 8 enums, and the
   `accounting` value on `settings_group_enum`).
2. `npx prisma generate`.
3. `npm run seed` — syncs the 11 new permission codes, extends the Principal
   and Accountant role baselines, and inserts the **61-account default chart**
   for any school that has none. Idempotent: a school that already keeps
   accounts is left completely alone.
4. Open **Accounting → Posting map** and point each fee head at an income
   account and each payment method at a cash / bank / clearing account. Not
   strictly required — unmapped keys fall back to the seeded system accounts
   by **code**, so a fresh deployment posts correctly out of the box — but
   the gateway methods should be pointed at their **clearing** accounts
   rather than the bank, or settlement accounting will not reconcile.
5. Optionally create the first fiscal period. Periods are opt-in: a school
   with none still posts vouchers normally.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. Every knob is an `accounting.*` school setting. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` (both repos) | ✅ clean | |
| `npx jest` backend unit | ✅ **1144 passed / 93 suites** (**+113**) | 103 engine + 10 auto-posting |
| `npx vitest run` frontend | ✅ **280 passed / 30 files** (**+22**) | |
| `npm run test:e2e` | ✅ **474 tests / 20 suites** (**+54**) | new `accounting.e2e-spec.ts`. Getting there needed two budget raises the twentieth suite exposed — see below. |
| `npx eslint <new paths>` | ✅ clean | both repos |
| `npx next build` | ✅ compiles, `/admin/accounting` emitted | |
| Migration replay onto empty PG 16 | ✅ 19 migrations, **zero drift** | `migrate diff` → "No difference detected." |
| Hand-written objects asserted in SQL | ✅ 10 CHECKs + 6 uniques present **and rejecting** | bad rows tried individually |
| Migration + seed on Neon dev DB | ✅ applied | 180 permission codes, 61 accounts |
| Fee payment → voucher → cash book → income statement | ✅ end to end | the roadmap §9 e2e requirement |

## Remaining TODOs

- [ ] In-browser click-throughs: the voucher entry grid with fifteen lines,
      the COA tree at full depth on a laptop, a printed voucher on A5, and the
      report drill-down chain.
- [ ] Decide whether accrual mode is wanted before the first full fiscal year.
- [ ] Month-by-month budget variance grid.

## Two budgets, and a false alarm worth recording

Neither is an M20 defect. One is a genuine latent fragility in M15; the other
turned out to be a polluted local environment that looked exactly like a
regression. Both are recorded in `PROJECT_CONTEXT.md` §18.

1. **M15 result processing ran inside Prisma's 5-second transaction
   default.** It loops a whole exam — every candidate × every paper, writing
   a grade per mark — inside one interactive transaction. Crossing the
   default does not fail loudly: Prisma kills the transaction mid-flight and
   the run is recorded FAILED with a Prisma internal message, which reads
   like a data problem. `ResultsRepository.withTransaction` now takes an
   options argument and both bulk passes pass `{ timeout: 120_000,
   maxWait: 15_000 }`. The e2e helper's own 15-second poll was raised to 60
   for the same reason — it had been implicitly calibrated against the old
   5-second ceiling, where a run either finished fast or died.

2. **The e2e suite's heap and hook timeout were raised as a precaution.**
   A run in which `portal`, `communication` and `website` all timed out in
   `beforeAll` (48 of 49 failures) looked like the M19 starvation finding one
   rung further on, so the heap went 6144 → **8192** and `testTimeout`
   30 s → **60 s**. Chasing it properly showed the real cause was a
   **polluted queue environment**, not starvation: a bare
   `docker compose up -d` had also started the `backend` service, whose
   BullMQ worker competes with the test process for jobs, and a
   `redis-cli flushall` had broken live connections
   (`[ioredis] Stream isn't writeable`). On a clean stack
   `result.e2e-spec` runs **55/55 in ~10 s**; on the polluted one it took
   **130 s and failed 29 of 55**. The raised budgets are kept — they cost
   nothing and remove a class of misleading red — but they are *not*
   evidence that twenty suites no longer fit. `test/README.md` documents the
   trap and how to recognise it.

**A test budget calibrated against a *different* limit stops being a budget
once that limit moves — and when several unrelated suites go red at once,
suspect the environment before the code.**

## Links to Related Modules

- **Depends on:** Module 16 (Fees & Payments) — for the invoice reads a
  voucher needs and the payment events it posts from. Also Module 04
  (settings + school profile), Module 07 (`SequenceService`), Module 03
  (RBAC + audit).
- **Integration direction (recorded because it is the design decision that
  keeps the graph acyclic):** `FeeModule` **emits** `payment.success` /
  `payment.refunded`; `AccountingModule` **listens**. Fees never learns that
  accounting exists, so a school running without a ledger loses nothing —
  the M08 `teacher.leave.approved` → M12 pattern. That one-way event edge is
  what lets `AccountingModule` *import* `FeeModule` safely.
- **Unlocks / hooks completed for:**
  - **Module 21 (HR & Payroll)** — imports this module and posts salary
    disbursements through `VoucherService.postAuto` with source `PAYROLL`,
    exactly as fee receipts do today. `2110 Salary Payable`,
    `5100 Salary & Allowances`, `5110 Festival Bonus` and
    `2120 Provident Fund Payable` are already in the seeded chart.
  - **Modules 24 / 25 / 26 / 28** — the same `postAuto` path with sources
    `INVENTORY` etc.; `PostingMapKind` is append-only so each registers its
    own mappings without a migration.
  - **Module 29 (Reports v2)** — the eight reports are registered in the M18
    report registry and appear in the hub, permission-filtered.
  - Closed the M03/M16 note in the seeded **Accountant** role description
    ("Accounting vouchers arrive with Module 20").
- **`PROJECT_CONTEXT.md` sections updated:** §5 (shared services), §8 (entity
  spine), §11 (global business rules), §16 (decisions), §18 (debt).

## What the e2e suite found

Writing `accounting.e2e-spec.ts` exposed a defect that `tsc` and every unit
test structurally could not see, because it lived in a *query predicate*
rather than in arithmetic.

**Every report read `WHERE status = 'POSTED'`** — the obvious version, and
wrong. Cancelling a posted voucher sets it `CANCELLED` and writes a
mirror-image reversal. With that predicate the original **dropped out of the
ledger while the reversal stayed in**, so the books ended up wrong by the
original amount *in the opposite direction*: a cancelled 25,000 receipt read
as 25,000 of **negative** income and drove the cash account to a credit
balance. The unit tests could not see it (the engines never ask about
status), and each individual report still looked internally consistent —
which is exactly why the suite asserts that **the three statements agree with
each other** rather than that each one returns plausible numbers.

The fix is the predicate the domain actually means: **the ledger is every
voucher that was ever posted** — `posted_at IS NOT NULL`. A DRAFT never
carries one, and a cancelled DRAFT is soft-deleted outright, so it admits
exactly the documents that belong in a ledger. Cancelling is not un-posting;
the money moved, it was reported, and the correction is the reversal standing
beside it.

**When a status flag means "this was superseded" rather than "this never
happened", a report that filters on it is silently rewriting history.**
