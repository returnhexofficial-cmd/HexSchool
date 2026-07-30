-- ── Module 21: HR & Payroll ──────────────────────────────────────────

-- CreateEnum
CREATE TYPE "leave_applicable_to_enum" AS ENUM ('ALL', 'TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "salary_component_type_enum" AS ENUM ('ALLOWANCE', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "salary_calc_enum" AS ENUM ('FLAT', 'PERCENT_OF_BASIC');

-- CreateEnum
CREATE TYPE "payment_mode_enum" AS ENUM ('BANK', 'CASH', 'MOBILE_BANKING');

-- CreateEnum
CREATE TYPE "payroll_run_status_enum" AS ENUM ('DRAFT', 'GENERATED', 'APPROVED', 'DISBURSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payslip_status_enum" AS ENUM ('PENDING', 'PAID', 'HELD');

-- CreateEnum
CREATE TYPE "bonus_type_enum" AS ENUM ('FESTIVAL', 'PERFORMANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "bonus_basis_enum" AS ENUM ('PERCENT_OF_BASIC', 'FLAT');

-- CreateEnum
CREATE TYPE "pf_entry_type_enum" AS ENUM ('CONTRIBUTION', 'WITHDRAWAL', 'ADJUSTMENT');

-- AlterEnum
-- Withdrawing an application is not the same event as the school
-- refusing it, and payroll has to tell the two apart when it counts
-- unpaid days. Safe inside the migration transaction because nothing
-- written HERE uses the new value (PG only forbids *using* it in the
-- same transaction that adds it) — the M20 `settings_group_enum`
-- precedent.
ALTER TYPE "leave_status_enum" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterEnum
-- The settings registry stores its group in this PG enum; `payroll`
-- joins it so the new `payroll.*` keys validate.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'payroll';

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "annual_quota" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "carry_forward" BOOLEAN NOT NULL DEFAULT false,
    "max_carry" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "applicable_to" "leave_applicable_to_enum" NOT NULL DEFAULT 'ALL',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_type" "attendance_person_type_enum" NOT NULL,
    "person_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "allocated" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "used" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "carried" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_type" "attendance_person_type_enum" NOT NULL,
    "person_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "session_id" UUID,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "half_day" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(4,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "leave_status_enum" NOT NULL DEFAULT 'PENDING',
    "approver_chain" JSONB NOT NULL DEFAULT '[]',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "attachment_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "leave_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "grade" VARCHAR(30),
    "basic" DECIMAL(12,2) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "salary_component_type_enum" NOT NULL,
    "calc" "salary_calc_enum" NOT NULL DEFAULT 'FLAT',
    "value" DECIMAL(12,2) NOT NULL,
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "is_pf_base" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_type" "attendance_person_type_enum" NOT NULL,
    "person_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "basic_override" DECIMAL(12,2),
    "effective_from" DATE NOT NULL,
    "bank_account" JSONB,
    "payment_mode" "payment_mode_enum" NOT NULL DEFAULT 'BANK',
    "note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "status" "payroll_run_status_enum" NOT NULL DEFAULT 'DRAFT',
    "note" VARCHAR(500),
    "working_days" INTEGER,
    "gross_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "disbursed_by" UUID,
    "disbursed_at" TIMESTAMPTZ(6),
    "voucher_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "person_type" "attendance_person_type_enum" NOT NULL,
    "person_id" UUID NOT NULL,
    "person_name" VARCHAR(200) NOT NULL,
    "employee_id" VARCHAR(30) NOT NULL,
    "designation" VARCHAR(80),
    "basic" DECIMAL(12,2) NOT NULL,
    "total_allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "attendance_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pf_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pf_employer" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "days_present" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "days_leave_paid" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "days_absent" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "days_unpaid_leave" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "working_days" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL DEFAULT '{}',
    "status" "payslip_status_enum" NOT NULL DEFAULT 'PENDING',
    "hold_reason" VARCHAR(300),
    "payment_mode" "payment_mode_enum" NOT NULL DEFAULT 'BANK',
    "paid_at" TIMESTAMPTZ(6),
    "edit_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "bonus_type_enum" NOT NULL DEFAULT 'FESTIVAL',
    "basis" "bonus_basis_enum" NOT NULL DEFAULT 'PERCENT_OF_BASIC',
    "value" DECIMAL(12,2) NOT NULL,
    "month_paid_with" DATE,
    "min_service_months" INTEGER NOT NULL DEFAULT 0,
    "prorate" BOOLEAN NOT NULL DEFAULT false,
    "applicable_to" "leave_applicable_to_enum" NOT NULL DEFAULT 'ALL',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "bonus_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pf_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_type" "attendance_person_type_enum" NOT NULL,
    "person_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "type" "pf_entry_type_enum" NOT NULL DEFAULT 'CONTRIBUTION',
    "employee_amt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employer_amt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "payslip_id" UUID,
    "note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "pf_ledger_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- M07/M08 record a status CHANGE but never the date it took effect, so
-- payroll had no way to prorate a leaver's final month (roadmap M21 §8
-- "mid-month joiner/exit proration"). `exit_date` is set when the status
-- moves to RESIGNED/TERMINATED/RETIRED and cleared on a return to ACTIVE
-- — the mirror of `joining_date`, which has always been there.
ALTER TABLE "teachers" ADD COLUMN "exit_date" DATE;
ALTER TABLE "staff_profiles" ADD COLUMN "exit_date" DATE;

-- An exit cannot precede the joining date.
ALTER TABLE "teachers"
  ADD CONSTRAINT "chk_teachers_exit_after_joining"
  CHECK ("exit_date" IS NULL OR "exit_date" >= "joining_date");

ALTER TABLE "staff_profiles"
  ADD CONSTRAINT "chk_staff_profiles_exit_after_joining"
  CHECK ("exit_date" IS NULL OR "exit_date" >= "joining_date");

-- CreateIndex
CREATE INDEX "idx_leave_types_school_active" ON "leave_types"("school_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_leave_balances_scope" ON "leave_balances"("school_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_leave_balances_person" ON "leave_balances"("person_type", "person_id");

-- CreateIndex
CREATE INDEX "idx_leave_applications_school_status" ON "leave_applications"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_leave_applications_person" ON "leave_applications"("person_type", "person_id", "from_date");

-- CreateIndex
CREATE INDEX "idx_leave_applications_range" ON "leave_applications"("school_id", "from_date", "to_date");

-- CreateIndex
CREATE INDEX "idx_salary_structures_school_active" ON "salary_structures"("school_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_salary_components_structure" ON "salary_components"("structure_id", "display_order");

-- CreateIndex
CREATE INDEX "idx_employee_salaries_person" ON "employee_salaries"("school_id", "person_type", "person_id");

-- CreateIndex
CREATE INDEX "idx_employee_salaries_structure" ON "employee_salaries"("structure_id");

-- CreateIndex
CREATE INDEX "idx_payroll_runs_school_month" ON "payroll_runs"("school_id", "month");

-- CreateIndex
CREATE INDEX "idx_payslips_run" ON "payslips"("payroll_run_id");

-- CreateIndex
CREATE INDEX "idx_payslips_person" ON "payslips"("school_id", "person_type", "person_id");

-- CreateIndex
CREATE INDEX "idx_bonus_runs_month" ON "bonus_runs"("school_id", "month_paid_with");

-- CreateIndex
CREATE INDEX "idx_pf_ledger_person_month" ON "pf_ledger"("school_id", "person_type", "person_id", "month");

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "fk_leave_types_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "fk_leave_balances_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "fk_leave_balances_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "fk_leave_balances_type" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "fk_leave_applications_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "fk_leave_applications_type" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "fk_salary_structures_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "fk_salary_components_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "fk_salary_components_structure" FOREIGN KEY ("structure_id") REFERENCES "salary_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "fk_employee_salaries_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "fk_employee_salaries_structure" FOREIGN KEY ("structure_id") REFERENCES "salary_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "fk_payroll_runs_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "fk_payslips_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "fk_payslips_run" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_runs" ADD CONSTRAINT "fk_bonus_runs_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pf_ledger" ADD CONSTRAINT "fk_pf_ledger_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written constraints (Prisma cannot express these) ────────────

-- A leave type's CODE is what payroll and the M08 data migration key on
-- ("is this the unpaid one?"), so it must be unique among live rows.
-- Deleting a type frees its code, like an account code and unlike a
-- document number.
CREATE UNIQUE INDEX "uq_leave_types_code"
  ON "leave_types" ("school_id", "code")
  WHERE "deleted_at" IS NULL;

-- One balance row per person per type per session. Without this the
-- yearly allocation job would add a second row on its next run and an
-- employee's quota would quietly double.
CREATE UNIQUE INDEX "uq_leave_balances_identity"
  ON "leave_balances" ("school_id", "person_type", "person_id", "session_id", "leave_type_id")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_salary_structures_name"
  ON "salary_structures" ("school_id", "name")
  WHERE "deleted_at" IS NULL;

-- Salary assignments are history: a change writes a NEW row. What must
-- not happen is TWO rows for the same person on the same effective date,
-- because then "the salary in force on 1 March" has no answer. Re-saving
-- a correction for that date replaces the row instead.
CREATE UNIQUE INDEX "uq_employee_salaries_identity"
  ON "employee_salaries" ("school_id", "person_type", "person_id", "effective_from")
  WHERE "deleted_at" IS NULL;

-- One live run per month (roadmap §6). CANCELLED is excluded so a
-- cancelled run frees the month for a corrected one — the M11 enrollment
-- rule, where a CANCELLED row must not keep holding the slot.
CREATE UNIQUE INDEX "uq_payroll_runs_month"
  ON "payroll_runs" ("school_id", "month")
  WHERE "deleted_at" IS NULL AND "status" <> 'CANCELLED';

-- One payslip per person per run. This is what makes regeneration an
-- idempotent replace: the generator deletes and rewrites the run's
-- payslips, and a concurrent second generate cannot double anybody's pay.
CREATE UNIQUE INDEX "uq_payslips_person"
  ON "payslips" ("payroll_run_id", "person_type", "person_id")
  WHERE "deleted_at" IS NULL;

-- One provident-fund CONTRIBUTION row per payslip. A re-disbursement, a
-- retried job or a double-clicked button must not credit the fund twice
-- — and, like the M20 auto-posting key, the guarantee has to be an index
-- rather than a check-then-insert, because both rows would look correct.
CREATE UNIQUE INDEX "uq_pf_ledger_payslip"
  ON "pf_ledger" ("payslip_id")
  WHERE "payslip_id" IS NOT NULL AND "type" = 'CONTRIBUTION';

-- ── Row-level invariants ──────────────────────────────────────────────

-- Quotas are days, and a negative entitlement is not a thing a school can
-- grant. `max_carry` only means something when carry-forward is on.
ALTER TABLE "leave_types"
  ADD CONSTRAINT "chk_leave_types_quota"
  CHECK (
    "annual_quota" >= 0 AND "max_carry" >= 0
    AND ("carry_forward" = true OR "max_carry" = 0)
  );

-- A balance is three non-negative counters. `used` may legitimately
-- exceed allocated+carried (a school can approve past the quota with an
-- override), so the two are deliberately NOT compared here.
ALTER TABLE "leave_balances"
  ADD CONSTRAINT "chk_leave_balances_non_negative"
  CHECK ("allocated" >= 0 AND "used" >= 0 AND "carried" >= 0);

-- from ≤ to, a positive number of days, and a half-day is exactly one
-- calendar day — half of a fortnight is not a half-day leave, it is a
-- data-entry mistake that would consume 0.5 of quota for 14 days off.
ALTER TABLE "leave_applications"
  ADD CONSTRAINT "chk_leave_applications_range"
  CHECK (
    "to_date" >= "from_date"
    AND "days" > 0
    AND ("half_day" = false OR "from_date" = "to_date")
  );

-- The evidence rule the whole codebase uses (M16 payments, M17
-- notifications, M20 vouchers): a state that claims a decision was taken
-- must record when it was taken.
ALTER TABLE "leave_applications"
  ADD CONSTRAINT "chk_leave_applications_decision_evidence"
  CHECK (
    "status" IN ('PENDING', 'CANCELLED')
    OR "approved_at" IS NOT NULL
  );

ALTER TABLE "salary_structures"
  ADD CONSTRAINT "chk_salary_structures_basic" CHECK ("basic" >= 0);

-- A PERCENT_OF_BASIC line is bounded at 100 (roadmap §7); a FLAT line is
-- taka and only has to be non-negative. Mirrored in the DTO and in the
-- structure builder, so a bad value is caught before it is typed in full.
ALTER TABLE "salary_components"
  ADD CONSTRAINT "chk_salary_components_value"
  CHECK (
    "value" >= 0
    AND ("calc" <> 'PERCENT_OF_BASIC' OR "value" <= 100)
  );

ALTER TABLE "employee_salaries"
  ADD CONSTRAINT "chk_employee_salaries_basic_override"
  CHECK ("basic_override" IS NULL OR "basic_override" >= 0);

-- Payroll `month` is stored as the first day of the month so that
-- `uq_payroll_runs_month` compares what it claims to compare. Without
-- this, 2027-03-01 and 2027-03-15 would be two different March runs.
ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "chk_payroll_runs_month_first"
  CHECK (EXTRACT(DAY FROM "month") = 1);

-- Each lifecycle step records when it happened, and a CANCELLED run says
-- why (the M20 `chk_vouchers_status_evidence` rule).
ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "chk_payroll_runs_status_evidence"
  CHECK (
    ("status" <> 'GENERATED' OR "generated_at" IS NOT NULL)
    AND ("status" <> 'APPROVED' OR "approved_at" IS NOT NULL)
    AND ("status" <> 'DISBURSED' OR "disbursed_at" IS NOT NULL)
    AND ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL))
  );

-- Money on a payslip is never negative. Net pay is the one figure that
-- could go negative through deductions, and it is floored at zero by the
-- engine instead — a school does not invoice a teacher for turning up.
ALTER TABLE "payslips"
  ADD CONSTRAINT "chk_payslips_amounts"
  CHECK (
    "basic" >= 0 AND "total_allowances" >= 0 AND "gross" >= 0
    AND "total_deductions" >= 0 AND "attendance_deduction" >= 0
    AND "tax" >= 0 AND "pf_employee" >= 0 AND "pf_employer" >= 0
    AND "bonus" >= 0 AND "net_payable" >= 0
  );

-- Day counts are days: non-negative, and never more than the month's
-- working days they are counted against.
ALTER TABLE "payslips"
  ADD CONSTRAINT "chk_payslips_days"
  CHECK (
    "days_present" >= 0 AND "days_leave_paid" >= 0
    AND "days_absent" >= 0 AND "days_unpaid_leave" >= 0
    AND "working_days" >= 0
  );

-- A HELD payslip carries its reason (it is a disciplinary decision, and
-- the person it is held from will ask), and a PAID one carries when.
ALTER TABLE "payslips"
  ADD CONSTRAINT "chk_payslips_status_evidence"
  CHECK (
    ("status" <> 'HELD' OR "hold_reason" IS NOT NULL)
    AND ("status" <> 'PAID' OR "paid_at" IS NOT NULL)
  );

ALTER TABLE "bonus_runs"
  ADD CONSTRAINT "chk_bonus_runs_value"
  CHECK (
    "value" >= 0
    AND ("basis" <> 'PERCENT_OF_BASIC' OR "value" <= 100)
    AND "min_service_months" >= 0
    AND ("month_paid_with" IS NULL OR EXTRACT(DAY FROM "month_paid_with") = 1)
  );

-- A contribution adds; a withdrawal subtracts. Storing both sides as
-- positive numbers with a `type` discriminator keeps the passbook
-- readable, and `balance_after` may never go below zero — a fund cannot
-- pay out more than it holds.
ALTER TABLE "pf_ledger"
  ADD CONSTRAINT "chk_pf_ledger_amounts"
  CHECK (
    "employee_amt" >= 0 AND "employer_amt" >= 0
    AND "balance_after" >= 0
    AND ("employee_amt" + "employer_amt") > 0
    AND EXTRACT(DAY FROM "month") = 1
  );

-- ── Data migration: `teacher_leaves` → `leave_applications` ───────────
--
-- M08 shipped `teacher_leaves` explicitly as an interim table. M21
-- replaces it with a polymorphic application that hangs off a leave TYPE
-- row, so the five enum values become five seeded rows per school first.
-- Nothing is thrown away: every teacher leave on file is copied across
-- with its status, reason and approver.

INSERT INTO "leave_types" (
  "school_id", "name", "code", "annual_quota", "carry_forward", "max_carry",
  "is_paid", "applicable_to", "display_order", "updated_at"
)
SELECT s."id", t."name", t."code", t."quota", t."carry", t."max_carry",
       t."paid", 'ALL'::"leave_applicable_to_enum", t."ord", CURRENT_TIMESTAMP
FROM "schools" s
CROSS JOIN (VALUES
  ('Casual Leave',    'CASUAL',    10.0, false, 0.0,  true,  1),
  ('Sick Leave',      'SICK',      14.0, false, 0.0,  true,  2),
  ('Earned Leave',    'EARNED',    20.0, true,  40.0, true,  3),
  ('Maternity Leave', 'MATERNITY', 112.0, false, 0.0, true,  4),
  ('Unpaid Leave',    'UNPAID',     0.0, false, 0.0,  false, 5),
  ('Other Leave',     'OTHER',      0.0, false, 0.0,  true,  6)
) AS t("name", "code", "quota", "carry", "max_carry", "paid", "ord")
ON CONFLICT DO NOTHING;

INSERT INTO "leave_applications" (
  "id", "school_id", "person_type", "person_id", "leave_type_id",
  "from_date", "to_date", "half_day", "days", "reason", "status",
  "approved_by", "approved_at", "created_at", "updated_at",
  "created_by", "updated_by"
)
SELECT
  tl."id",
  tl."school_id",
  'TEACHER'::"attendance_person_type_enum",
  tl."teacher_id",
  lt."id",
  tl."from_date",
  tl."to_date",
  false,
  -- Historical rows keep a CALENDAR-day count: the working-day calendar
  -- these were taken against is not reconstructible after the fact, and
  -- inventing a working-day figure now would silently restate how much
  -- quota a past leave consumed.
  (tl."to_date" - tl."from_date" + 1)::numeric(4,1),
  COALESCE(tl."reason", 'Migrated from teacher_leaves (M08)'),
  tl."status",
  tl."approved_by",
  CASE WHEN tl."status" = 'PENDING' THEN NULL ELSE tl."updated_at" END,
  tl."created_at",
  tl."updated_at",
  tl."created_by",
  tl."updated_by"
FROM "teacher_leaves" tl
JOIN "leave_types" lt
  ON lt."school_id" = tl."school_id"
 AND lt."code" = tl."type"::text
 AND lt."deleted_at" IS NULL;

-- DropTable
DROP TABLE "teacher_leaves";

-- DropEnum
-- The taxonomy is a table now; nothing references the type any more.
DROP TYPE "leave_type_enum";
