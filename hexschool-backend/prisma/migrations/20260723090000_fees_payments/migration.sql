-- CreateEnum
CREATE TYPE "fee_head_type_enum" AS ENUM ('RECURRING_MONTHLY', 'ONE_TIME', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "fee_override_type_enum" AS ENUM ('DISCOUNT_PERCENT', 'DISCOUNT_FLAT', 'WAIVER', 'SCHOLARSHIP');

-- CreateEnum
CREATE TYPE "invoice_status_enum" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_method_enum" AS ENUM ('CASH', 'BANK', 'SSLCOMMERZ', 'BKASH', 'NAGAD', 'ROCKET', 'CHEQUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "payment_status_enum" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "fee_heads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20),
    "type" "fee_head_type_enum" NOT NULL DEFAULT 'RECURRING_MONTHLY',
    "is_refundable" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fee_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "group_id" UUID,
    "fee_head_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_day" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_fee_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "fee_head_id" UUID NOT NULL,
    "type" "fee_override_type_enum" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "student_fee_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "invoice_no" VARCHAR(30) NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "billing_month" DATE,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fine_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paid_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payable" DECIMAL(12,2) NOT NULL,
    "status" "invoice_status_enum" NOT NULL DEFAULT 'UNPAID',
    "fined_for_month" DATE,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "remarks" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "fee_head_id" UUID,
    "description" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "payment_no" VARCHAR(30) NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "payment_method_enum" NOT NULL,
    "status" "payment_status_enum" NOT NULL DEFAULT 'PENDING',
    "gateway_txn_id" VARCHAR(120),
    "gateway_ref" VARCHAR(120),
    "gateway_payload" JSONB,
    "reference" VARCHAR(100),
    "remarks" VARCHAR(500),
    "received_by" UUID,
    "paid_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "approved_by" UUID NOT NULL,
    "refunded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gateway_refund_id" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_fee_heads_school" ON "fee_heads"("school_id");

-- CreateIndex
CREATE INDEX "idx_fee_structures_scope" ON "fee_structures"("school_id", "session_id", "class_id");

-- CreateIndex
CREATE INDEX "idx_fee_structures_head" ON "fee_structures"("fee_head_id");

-- CreateIndex
CREATE INDEX "idx_fee_overrides_enrollment" ON "student_fee_overrides"("enrollment_id");

-- CreateIndex
CREATE INDEX "idx_fee_overrides_head" ON "student_fee_overrides"("fee_head_id");

-- CreateIndex
CREATE INDEX "idx_invoices_school_session_status" ON "invoices"("school_id", "session_id", "status");

-- CreateIndex
CREATE INDEX "idx_invoices_enrollment_month" ON "invoices"("enrollment_id", "billing_month");

-- CreateIndex
CREATE INDEX "idx_invoices_due_date" ON "invoices"("due_date");

-- CreateIndex
CREATE INDEX "idx_invoice_items_invoice" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_payments_invoice" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_payments_school_status_paid" ON "payments"("school_id", "status", "paid_at");

-- CreateIndex
CREATE INDEX "idx_payment_refunds_payment" ON "payment_refunds"("payment_id");

-- AddForeignKey
ALTER TABLE "fee_heads" ADD CONSTRAINT "fk_fee_heads_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fk_fee_structures_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fk_fee_structures_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fk_fee_structures_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fk_fee_structures_group" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fk_fee_structures_head" FOREIGN KEY ("fee_head_id") REFERENCES "fee_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_overrides" ADD CONSTRAINT "fk_fee_overrides_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_overrides" ADD CONSTRAINT "fk_fee_overrides_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_overrides" ADD CONSTRAINT "fk_fee_overrides_head" FOREIGN KEY ("fee_head_id") REFERENCES "fee_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "fk_invoice_items_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "fk_invoice_items_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "fk_invoice_items_head" FOREIGN KEY ("fee_head_id") REFERENCES "fee_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "fk_payment_refunds_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "fk_payment_refunds_payment" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written constraints (Prisma cannot express these) ────────────

-- Fee head names are unique per school, case-insensitively, among live
-- rows (the M06/M14 master-name pattern).
CREATE UNIQUE INDEX "uq_fee_heads_name"
  ON "fee_heads" ("school_id", lower("name"))
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_fee_heads_code"
  ON "fee_heads" ("school_id", lower("code"))
  WHERE "deleted_at" IS NULL AND "code" IS NOT NULL;

-- Structure identity: one amount per (session, class, group, head).
-- group_id is nullable and Postgres treats NULLs as distinct, so
-- COALESCE maps it to the nil UUID inside the index — the same trick as
-- uq_sections_identity (M06).
CREATE UNIQUE INDEX "uq_fee_structures_identity" ON "fee_structures"
  ("session_id", "class_id", "fee_head_id",
   COALESCE("group_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "deleted_at" IS NULL;

-- Document numbers are never reused, so these uniques deliberately
-- IGNORE deleted_at (the M07 employee-ID precedent).
CREATE UNIQUE INDEX "uq_invoices_no" ON "invoices" ("school_id", "invoice_no");
CREATE UNIQUE INDEX "uq_payments_no" ON "payments" ("school_id", "payment_no");

-- **The IPN idempotency guarantee.** A gateway that retries its callback
-- (or fires it twice) must never create a second credit; the unique
-- index is what makes "insert and catch the conflict" a safe pattern
-- rather than a race (roadmap M16 §8).
CREATE UNIQUE INDEX "uq_payments_gateway_txn"
  ON "payments" ("gateway_txn_id")
  WHERE "gateway_txn_id" IS NOT NULL;

-- **Monthly invoice idempotency** (roadmap M16 §6): one invoice per
-- enrollment per billed month. Ad-hoc invoices carry a NULL
-- billing_month and are excluded, so a class can be billed an exam fee
-- as often as it needs. CANCELLED rows are excluded too — a cancelled
-- bill must be re-issuable.
CREATE UNIQUE INDEX "uq_invoices_enrollment_month"
  ON "invoices" ("enrollment_id", "billing_month")
  WHERE "deleted_at" IS NULL
    AND "billing_month" IS NOT NULL
    AND "status" <> 'CANCELLED';

-- Money is non-negative and two decimals throughout.
ALTER TABLE "fee_structures"
  ADD CONSTRAINT "chk_fee_structures_amount"
  CHECK ("amount" >= 0 AND ("due_day" IS NULL OR "due_day" BETWEEN 1 AND 28));

-- A percentage override is 0–100; every other type is a plain amount.
-- WAIVER ignores the value entirely, so it is only bounded below.
ALTER TABLE "student_fee_overrides"
  ADD CONSTRAINT "chk_fee_overrides_value"
  CHECK (
    "value" >= 0
    AND ("type" <> 'DISCOUNT_PERCENT' OR "value" <= 100)
    AND ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_from" <= "valid_to")
  );

-- The identity the roadmap wanted a GENERATED column for. A generated
-- column cannot be written and Prisma always includes every scalar in
-- its create input, so this CHECK carries the same guarantee without
-- breaking every insert.
ALTER TABLE "invoices"
  ADD CONSTRAINT "chk_invoices_payable"
  CHECK ("payable" = "subtotal" - "discount_total" + "fine_total");

ALTER TABLE "invoices"
  ADD CONSTRAINT "chk_invoices_amounts"
  CHECK (
    "subtotal" >= 0 AND "discount_total" >= 0
    AND "fine_total" >= 0 AND "paid_total" >= 0
    AND "discount_total" <= "subtotal"
    -- Overpayment is refused at the service; this is the backstop.
    AND "paid_total" <= "payable"
  );

ALTER TABLE "invoices"
  ADD CONSTRAINT "chk_invoices_dates"
  CHECK ("due_date" >= "issue_date");

-- Cancelling requires a reason, and a reason implies a cancellation.
ALTER TABLE "invoices"
  ADD CONSTRAINT "chk_invoices_cancellation"
  CHECK (
    ("cancelled_at" IS NULL AND "cancel_reason" IS NULL)
    OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)
  );

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "chk_invoice_items_amounts"
  CHECK ("amount" >= 0 AND "discount" >= 0 AND "discount" <= "amount");

ALTER TABLE "payments"
  ADD CONSTRAINT "chk_payments_amount"
  CHECK ("amount" > 0);

-- A SUCCESS payment must record WHEN it was taken, and an online one
-- must have been verified server-side (roadmap M16 §6 — never trust a
-- redirect). Offline methods are verified by the person at the counter.
ALTER TABLE "payments"
  ADD CONSTRAINT "chk_payments_success_evidence"
  CHECK (
    "status" <> 'SUCCESS'
    OR (
      "paid_at" IS NOT NULL
      AND (
        "method" IN ('CASH', 'BANK', 'CHEQUE', 'ADJUSTMENT')
        OR "verified_at" IS NOT NULL
      )
    )
  );

ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "chk_payment_refunds_amount"
  CHECK ("amount" > 0);
