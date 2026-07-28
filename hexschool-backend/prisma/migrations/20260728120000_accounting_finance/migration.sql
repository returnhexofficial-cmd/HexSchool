-- ── Module 20: Accounting & Finance ──────────────────────────────────

-- CreateEnum
CREATE TYPE "account_group_enum" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "account_type_enum" AS ENUM ('CASH', 'BANK', 'RECEIVABLE', 'PAYABLE', 'INCOME', 'EXPENSE', 'EQUITY', 'OTHER');

-- CreateEnum
CREATE TYPE "voucher_type_enum" AS ENUM ('DEBIT', 'CREDIT', 'JOURNAL', 'CONTRA');

-- CreateEnum
CREATE TYPE "voucher_source_enum" AS ENUM ('MANUAL', 'FEES', 'PAYROLL', 'INVENTORY', 'ADMISSION');

-- CreateEnum
CREATE TYPE "voucher_status_enum" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "budget_period_enum" AS ENUM ('YEARLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "fiscal_period_status_enum" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "posting_map_kind_enum" AS ENUM ('FEE_HEAD', 'PAYMENT_METHOD', 'SYSTEM');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `accounting`
-- joins it so the new `accounting.*` keys validate. Safe inside the
-- migration transaction because no row written HERE uses the new value
-- (settings rows are written at runtime by the registry).
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'accounting';

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "parent_id" UUID,
    "group" "account_group_enum" NOT NULL,
    "type" "account_type_enum" NOT NULL DEFAULT 'OTHER',
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_bn" VARCHAR(150),
    "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bank_account_no" VARCHAR(60),
    "bank_name" VARCHAR(150),
    "branch_name" VARCHAR(150),
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "voucher_no" VARCHAR(30) NOT NULL,
    "type" "voucher_type_enum" NOT NULL,
    "source" "voucher_source_enum" NOT NULL DEFAULT 'MANUAL',
    "status" "voucher_status_enum" NOT NULL DEFAULT 'DRAFT',
    "date" DATE NOT NULL,
    "narration" VARCHAR(500) NOT NULL,
    "reference" VARCHAR(120),
    "source_ref" VARCHAR(120),
    "attachment_url" VARCHAR(500),
    "fiscal_period_id" UUID,
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "reversal_of_voucher_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "narration" VARCHAR(300),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "period" "budget_period_enum" NOT NULL DEFAULT 'YEARLY',
    "month" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "fiscal_period_status_enum" NOT NULL DEFAULT 'OPEN',
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "reopened_by" UUID,
    "reopened_at" TIMESTAMPTZ(6),
    "closing_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_maps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "kind" "posting_map_kind_enum" NOT NULL,
    "ref_key" VARCHAR(80) NOT NULL,
    "account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "posting_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_accounts_group_code" ON "accounts"("school_id", "group", "code");

-- CreateIndex
CREATE INDEX "idx_accounts_parent" ON "accounts"("parent_id");

-- CreateIndex
CREATE INDEX "idx_vouchers_school_date_status" ON "vouchers"("school_id", "date", "status");

-- CreateIndex
CREATE INDEX "idx_vouchers_source" ON "vouchers"("school_id", "source", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_vouchers_no" ON "vouchers"("school_id", "voucher_no");

-- CreateIndex
CREATE INDEX "idx_voucher_entries_voucher" ON "voucher_entries"("voucher_id", "display_order");

-- CreateIndex
CREATE INDEX "idx_voucher_entries_account" ON "voucher_entries"("account_id");

-- CreateIndex
CREATE INDEX "idx_budgets_scope" ON "budgets"("school_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_budgets_account" ON "budgets"("account_id");

-- CreateIndex
CREATE INDEX "idx_fiscal_periods_range" ON "fiscal_periods"("school_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "idx_posting_maps_kind" ON "posting_maps"("school_id", "kind");

-- CreateIndex
CREATE INDEX "idx_posting_maps_account" ON "posting_maps"("account_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts_parent" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "fk_vouchers_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "fk_vouchers_fiscal_period" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "fk_vouchers_reversal_of" FOREIGN KEY ("reversal_of_voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_entries" ADD CONSTRAINT "fk_voucher_entries_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_entries" ADD CONSTRAINT "fk_voucher_entries_voucher" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_entries" ADD CONSTRAINT "fk_voucher_entries_account" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "fk_budgets_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "fk_budgets_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "fk_budgets_account" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fk_fiscal_periods_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_maps" ADD CONSTRAINT "fk_posting_maps_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_maps" ADD CONSTRAINT "fk_posting_maps_account" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written constraints (Prisma cannot express these) ────────────

-- An account code is a filing position, not a receipt: deleting an
-- account frees its code for reuse, so this unique is scoped to LIVE rows
-- (unlike `uq_vouchers_no`, where a document number is burned forever —
-- the M07 employee-ID / M16 invoice rule).
CREATE UNIQUE INDEX "uq_accounts_code"
  ON "accounts" ("school_id", "code")
  WHERE "deleted_at" IS NULL;

-- One mapping per (kind, key) among live rows: a fee head has exactly one
-- income account, a payment method exactly one settlement account.
CREATE UNIQUE INDEX "uq_posting_maps_key"
  ON "posting_maps" ("school_id", "kind", "ref_key")
  WHERE "deleted_at" IS NULL;

-- The auto-posting idempotency key. A replayed `payment.success` event, a
-- reconciliation sweep that re-verifies the same payment, and a
-- double-clicked gateway callback must all land ONE voucher — otherwise
-- the school's income is silently doubled, which no report would flag
-- because both vouchers balance perfectly. A CANCELLED voucher releases
-- the key so a corrected re-post is possible.
CREATE UNIQUE INDEX "uq_vouchers_source_ref"
  ON "vouchers" ("school_id", "source_ref")
  WHERE "source_ref" IS NOT NULL
    AND "deleted_at" IS NULL
    AND "status" <> 'CANCELLED';

-- A fiscal period's name identifies it in every report header.
CREATE UNIQUE INDEX "uq_fiscal_periods_name"
  ON "fiscal_periods" ("school_id", "name")
  WHERE "deleted_at" IS NULL;

-- One budget line per account per session — and per month for a MONTHLY
-- row. `month` is nullable and Postgres treats NULLs as distinct, so the
-- YEARLY row needs COALESCE to 0 or two YEARLY budgets for one account
-- would both be accepted (the M06 section-identity trick).
CREATE UNIQUE INDEX "uq_budgets_identity"
  ON "budgets" ("school_id", "session_id", "account_id", COALESCE("month", 0))
  WHERE "deleted_at" IS NULL;

-- ── Row-level invariants ──────────────────────────────────────────────

-- A voucher line is ONE-sided and non-zero. This is the roadmap's
-- `chk(debit=0 OR credit=0)` + `chk(debit+credit>0)`, plus the sign
-- guard those two imply but do not state: a -100 debit is a +100 credit
-- wearing a disguise, and it would slip past the Σdebit = Σcredit test.
ALTER TABLE "voucher_entries"
  ADD CONSTRAINT "chk_voucher_entries_one_sided"
  CHECK (
    "debit" >= 0 AND "credit" >= 0
    AND ("debit" = 0 OR "credit" = 0)
    AND ("debit" + "credit") > 0
  );

-- That Σdebit = Σcredit ACROSS a voucher is the roadmap's "DB-level
-- trigger safety net", and it deliberately is NOT one here: a CHECK
-- cannot see sibling rows, and a trigger firing per row would reject the
-- first line of every legitimate two-line voucher. The invariant lives in
-- `calc/voucher.engine.ts` (`balanceError`), is asserted inside the same
-- transaction that writes the lines, and is re-asserted by the trial
-- balance — which is the report that would expose a violation.

-- A state that claims something happened must record WHEN (the M16
-- `chk_payments_success_evidence` / M17 / M19 rule). A POSTED voucher
-- without `posted_at` cannot be aged, and a CANCELLED one without a
-- reason is an unexplained hole in the ledger.
ALTER TABLE "vouchers"
  ADD CONSTRAINT "chk_vouchers_status_evidence"
  CHECK (
    ("status" <> 'POSTED' OR "posted_at" IS NOT NULL)
    AND (
      "status" <> 'CANCELLED'
      OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)
    )
  );

-- Auto-posted vouchers always carry the key that makes them idempotent;
-- a MANUAL one never does, so a hand-typed voucher can never collide with
-- (or be mistaken for) a machine-written one.
ALTER TABLE "vouchers"
  ADD CONSTRAINT "chk_vouchers_source_ref_shape"
  CHECK (
    ("source" = 'MANUAL' AND "source_ref" IS NULL)
    OR ("source" <> 'MANUAL' AND "source_ref" IS NOT NULL)
  );

-- A heading in the chart of accounts holds no money of its own: it is the
-- sum of its children. An opening balance parked on a heading would be
-- counted once as itself and once inside every subtotal.
ALTER TABLE "accounts"
  ADD CONSTRAINT "chk_accounts_group_node_empty"
  CHECK ("is_group" = false OR "opening_balance" = 0);

-- A node cannot be its own parent. Deeper cycles need a recursive walk
-- and are refused by `AccountsService.assertNoCycle` (the engine rule a
-- CHECK structurally cannot express — it needs a join).
ALTER TABLE "accounts"
  ADD CONSTRAINT "chk_accounts_parent_not_self"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "accounts"
  ADD CONSTRAINT "chk_accounts_display_order" CHECK ("display_order" >= 0);

-- A MONTHLY budget names its month; a YEARLY one must not, or the
-- COALESCE identity index above would let the same account hold a yearly
-- figure twice under different months.
ALTER TABLE "budgets"
  ADD CONSTRAINT "chk_budgets_period_month"
  CHECK (
    ("period" = 'MONTHLY' AND "month" BETWEEN 1 AND 12)
    OR ("period" = 'YEARLY' AND "month" IS NULL)
  );

-- A budget is a plan, not a correction: negatives belong in the ledger.
ALTER TABLE "budgets"
  ADD CONSTRAINT "chk_budgets_amount" CHECK ("amount" >= 0);

ALTER TABLE "fiscal_periods"
  ADD CONSTRAINT "chk_fiscal_periods_range" CHECK ("end_date" >= "start_date");

-- A CLOSED period records who closed it and when — the same evidence rule
-- as the voucher statuses above. Overlap between two periods needs a
-- range comparison against sibling rows and is service-enforced
-- (`FiscalPeriodService.assertNoOverlap`, the M05 session precedent).
ALTER TABLE "fiscal_periods"
  ADD CONSTRAINT "chk_fiscal_periods_closed_evidence"
  CHECK ("status" <> 'CLOSED' OR "closed_at" IS NOT NULL);
