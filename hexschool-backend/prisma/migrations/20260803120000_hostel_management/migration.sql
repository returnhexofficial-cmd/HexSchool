-- ── Module 26: Hostel Management ─────────────────────────────────────

-- CreateEnum
CREATE TYPE "hostel_type_enum" AS ENUM ('BOYS', 'GIRLS');

-- CreateEnum
CREATE TYPE "hostel_status_enum" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "hostel_room_type_enum" AS ENUM ('STANDARD', 'AC', 'SHARED');

-- CreateEnum
CREATE TYPE "hostel_room_status_enum" AS ENUM ('ACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "hostel_bed_status_enum" AS ENUM ('VACANT', 'OCCUPIED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "hostel_allocation_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED', 'VACATED');

-- CreateEnum
CREATE TYPE "meal_off_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `hostel` joins
-- it so the new `hostel.*` keys validate. Safe inside the migration
-- transaction because nothing written HERE uses the new value (PG only
-- forbids *using* it in the transaction that adds it) — the
-- M20/M21/M22/M23/M24/M25 `settings_group_enum` precedent.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'hostel';

-- AlterEnum
-- M20's auto-posting source. The security deposit is money the school
-- HOLDS rather than earns, so it needs its own source: a reader of the
-- income & expenditure statement must be able to see that a deposit is
-- not income and a refund is not an expense.
ALTER TYPE "voucher_source_enum" ADD VALUE IF NOT EXISTS 'HOSTEL';

-- CreateTable
CREATE TABLE "hostels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "name_bn" VARCHAR(160),
    "type" "hostel_type_enum" NOT NULL,
    "warden_staff_id" UUID,
    "address" TEXT,
    "phone" VARCHAR(20),
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "status" "hostel_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "room_no" VARCHAR(40) NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 0,
    "type" "hostel_room_type_enum" NOT NULL DEFAULT 'STANDARD',
    "bed_count" INTEGER NOT NULL DEFAULT 1,
    "monthly_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "hostel_room_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "hostel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_beds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "bed_no" VARCHAR(20) NOT NULL,
    "status" "hostel_bed_status_enum" NOT NULL DEFAULT 'VACANT',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "hostel_beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "hostel_allocation_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "suspended_at" DATE,
    "resumed_at" DATE,
    "security_deposit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deposit_refunded" BOOLEAN NOT NULL DEFAULT false,
    "deposit_refund_amount" DECIMAL(12,2),
    "deposit_refunded_at" DATE,
    "deposit_refund_note" TEXT,
    "deposit_voucher_id" UUID,
    "refund_voucher_id" UUID,
    "status_reason" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "hostel_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mess_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "monthly_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "hostel_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mess_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mess_enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mess_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_offs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "meal_off_status_enum" NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "credit_month" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "meal_offs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_hostels_status" ON "hostels"("school_id", "status");
CREATE INDEX "idx_hostel_rooms_hostel" ON "hostel_rooms"("school_id", "hostel_id", "floor");
CREATE INDEX "idx_hostel_beds_room" ON "hostel_beds"("school_id", "room_id");
CREATE INDEX "idx_hostel_beds_status" ON "hostel_beds"("school_id", "hostel_id", "status");
CREATE INDEX "idx_hostel_allocations_hostel" ON "hostel_allocations"("school_id", "hostel_id", "status");
CREATE INDEX "idx_hostel_allocations_bed" ON "hostel_allocations"("school_id", "bed_id");
CREATE INDEX "idx_hostel_allocations_enrollment" ON "hostel_allocations"("enrollment_id");
CREATE INDEX "idx_mess_plans_hostel" ON "mess_plans"("school_id", "hostel_id", "status");
CREATE INDEX "idx_mess_enrollments_allocation" ON "mess_enrollments"("school_id", "allocation_id");
CREATE INDEX "idx_mess_enrollments_plan" ON "mess_enrollments"("school_id", "plan_id");
CREATE INDEX "idx_meal_offs_allocation" ON "meal_offs"("school_id", "allocation_id", "status");
CREATE INDEX "idx_meal_offs_credit_month" ON "meal_offs"("school_id", "credit_month");

-- ── Composite-FK targets ────────────────────────────────────────────
-- Four PLAIN uniques, so they must also be declared in `schema.prisma`
-- or a clean replay reports drift — the rule M24 learned the hard way
-- (a partial or expression index is migration-only; a plain one is not).
--
-- None of them constrains anything the primary key did not already: `id`
-- is unique on its own. They exist so that `hostel_id` can be carried
-- down the chain as a column a FOREIGN KEY checks, which is what turns
-- "this bed is in this building" and "this plan belongs to this
-- building" from a service's memory into a database fact.
CREATE UNIQUE INDEX "uq_hostel_rooms_hostel_room" ON "hostel_rooms"("hostel_id", "id");
CREATE UNIQUE INDEX "uq_hostel_beds_hostel_bed" ON "hostel_beds"("hostel_id", "id");
CREATE UNIQUE INDEX "uq_hostel_allocations_hostel_alloc" ON "hostel_allocations"("hostel_id", "id");
CREATE UNIQUE INDEX "uq_mess_plans_hostel_plan" ON "mess_plans"("hostel_id", "id");

-- AddForeignKey
ALTER TABLE "hostels" ADD CONSTRAINT "fk_hostels_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostels" ADD CONSTRAINT "fk_hostels_warden" FOREIGN KEY ("warden_staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "fk_hostel_rooms_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "fk_hostel_rooms_hostel" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_beds" ADD CONSTRAINT "fk_hostel_beds_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_beds" ADD CONSTRAINT "fk_hostel_beds_hostel" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The bed must be in a room OF THAT HOSTEL. Same technique as M25's
-- `(route_id, stop_id)`: a single-column FK on `room_id` would happily
-- accept a room in the girls' hostel for a bed recorded in the boys',
-- and the gender rule this module exists to enforce would then be
-- checked against the wrong building.
ALTER TABLE "hostel_beds" ADD CONSTRAINT "fk_hostel_beds_room" FOREIGN KEY ("hostel_id", "room_id") REFERENCES "hostel_rooms"("hostel_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hostel_allocations" ADD CONSTRAINT "fk_hostel_allocations_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_allocations" ADD CONSTRAINT "fk_hostel_allocations_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_allocations" ADD CONSTRAINT "fk_hostel_allocations_hostel" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The bed must belong to the hostel the allocation says it does.
ALTER TABLE "hostel_allocations" ADD CONSTRAINT "fk_hostel_allocations_hostel_bed" FOREIGN KEY ("hostel_id", "bed_id") REFERENCES "hostel_beds"("hostel_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mess_plans" ADD CONSTRAINT "fk_mess_plans_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mess_plans" ADD CONSTRAINT "fk_mess_plans_hostel" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mess_enrollments" ADD CONSTRAINT "fk_mess_enrollments_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mess_enrollments" ADD CONSTRAINT "fk_mess_enrollments_hostel" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- **The one that pays for the whole scheme.** A boarder in the boys'
-- hostel may only be enrolled on a mess plan of the boys' hostel, and a
-- plan belongs to exactly one building. Get this wrong and the invoice
-- still balances — it is simply the wrong number, on the wrong family's
-- bill, for a kitchen that never cooked for them.
ALTER TABLE "mess_enrollments" ADD CONSTRAINT "fk_mess_enrollments_allocation" FOREIGN KEY ("hostel_id", "allocation_id") REFERENCES "hostel_allocations"("hostel_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mess_enrollments" ADD CONSTRAINT "fk_mess_enrollments_plan" FOREIGN KEY ("hostel_id", "plan_id") REFERENCES "mess_plans"("hostel_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meal_offs" ADD CONSTRAINT "fk_meal_offs_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meal_offs" ADD CONSTRAINT "fk_meal_offs_allocation" FOREIGN KEY ("allocation_id") REFERENCES "hostel_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written identity indexes ───────────────────────────────────
-- Prisma cannot express a partial unique, so every one of these is
-- written here and mirrored nowhere else (the M11/M12/M15/M16 rule).

-- A hostel's name is how the office, the warden and the parents refer to
-- the building; two live ones sharing a name is a resident list nobody
-- can act on. A deleted hostel frees its name (the M25 plate rule — this
-- is a label the school chooses, not a number issued to it).
CREATE UNIQUE INDEX "uq_hostels_name" ON "hostels"("school_id", lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

-- Roadmap §3's `uq(hostel_id, room_no)`, as a live-rows partial unique so
-- a mis-typed room can be deleted and re-entered. Case- and space-
-- insensitive because "  a-101 " and "A-101" are the same door.
CREATE UNIQUE INDEX "uq_hostel_rooms_no" ON "hostel_rooms"("hostel_id", upper(btrim("room_no")))
  WHERE "deleted_at" IS NULL;

-- Two beds called "B2" in one room is a bed nobody can be assigned to
-- unambiguously — and this module's whole unit of work is "which bed".
CREATE UNIQUE INDEX "uq_hostel_beds_no" ON "hostel_beds"("room_id", upper(btrim("bed_no")))
  WHERE "deleted_at" IS NULL;

-- **One live allocation per student** (roadmap §6). A boarder sleeps in
-- one bed; the SUSPENDED row is still that student's place, which is why
-- the predicate excludes only VACATED — the M25 suspended-rider rule.
CREATE UNIQUE INDEX "uq_hostel_allocations_live_enrollment" ON "hostel_allocations"("enrollment_id")
  WHERE "status" IN ('ACTIVE', 'SUSPENDED') AND "deleted_at" IS NULL;

-- **Bed exclusivity** (roadmap §6), and the reason `hostel_beds.status`
-- may be treated as a shadow rather than a source of truth: two students
-- cannot be given the same bed even if every service in the codebase
-- forgets to check, and a suspended boarder keeps theirs.
CREATE UNIQUE INDEX "uq_hostel_allocations_live_bed" ON "hostel_allocations"("bed_id")
  WHERE "status" IN ('ACTIVE', 'SUSPENDED') AND "deleted_at" IS NULL;

-- Two live plans called "Full board" in one hostel would make the mess
-- charge a coin toss.
CREATE UNIQUE INDEX "uq_mess_plans_name" ON "mess_plans"("hostel_id", lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

-- One OPEN mess enrolment per boarder. A closed one (with an `end_date`)
-- is history and may sit beside the current plan, which is what lets a
-- boarder move from full board to lunch-only mid-year and still be billed
-- correctly for both halves of the month.
CREATE UNIQUE INDEX "uq_mess_enrollments_live" ON "mess_enrollments"("allocation_id")
  WHERE "end_date" IS NULL AND "deleted_at" IS NULL;

-- ── CHECK constraints ───────────────────────────────────────────────

-- A blank name is a building nobody can pick from a list, and a negative
-- declared capacity is a typo the occupancy report would print.
ALTER TABLE "hostels"
  ADD CONSTRAINT "chk_hostels_shape"
  CHECK (
    length(btrim("name")) > 0
    AND "capacity" >= 0
  );

-- `bed_count` is bounded because it is what bulk bed generation loops
-- over: a fat-fingered 5000 would claim five thousand rows in one
-- transaction (the M20 transaction-budget lesson, and M23's 200-copy
-- cap). The seat rent is billed monthly, so a negative one would hand a
-- family money for living in the school.
ALTER TABLE "hostel_rooms"
  ADD CONSTRAINT "chk_hostel_rooms_shape"
  CHECK (
    length(btrim("room_no")) > 0
    AND "bed_count" BETWEEN 1 AND 50
    AND "monthly_fee" >= 0
    AND "floor" BETWEEN -5 AND 200
  );

ALTER TABLE "hostel_beds"
  ADD CONSTRAINT "chk_hostel_beds_shape"
  CHECK (length(btrim("bed_no")) > 0);

-- **The residency window has to be a window.** M16 reads
-- `[resumed_at ?? start_date, end_date ?? suspended_at ?? ∞)` and
-- prorates a month against it; each clause here is a way that window
-- could come out backwards and quietly bill a negative number of days —
-- the M25 `chk_transport_assignments_window` situation, for a bed.
ALTER TABLE "hostel_allocations"
  ADD CONSTRAINT "chk_hostel_allocations_window"
  CHECK (
    ("end_date" IS NULL OR "end_date" >= "start_date")
    AND ("suspended_at" IS NULL OR "suspended_at" >= "start_date")
    AND ("resumed_at" IS NULL OR "suspended_at" IS NULL OR "resumed_at" >= "suspended_at")
  );

-- A status with no date behind it cannot answer "how much of March does
-- this boarder owe" — the M21 `exit_date` lesson, pinned at the database.
-- ACTIVE additionally may not still carry a suspension date, or billing
-- would stop for a student who sleeps here every night.
ALTER TABLE "hostel_allocations"
  ADD CONSTRAINT "chk_hostel_allocations_status_evidence"
  CHECK (
    ("status" <> 'VACATED' OR "end_date" IS NOT NULL)
    AND ("status" <> 'SUSPENDED' OR "suspended_at" IS NOT NULL)
    AND ("status" <> 'ACTIVE' OR "suspended_at" IS NULL)
  );

-- The deposit is money the school is HOLDING. Three things follow, and
-- all three are the kind a "mark as refunded" button breaks:
--   * you cannot hand back more than was taken;
--   * a refund that happened has an amount and a date on it (the M16/M17
--     evidence rule);
--   * and you cannot refund a deposit to somebody who still lives here —
--     the deposit is security against a room that is still occupied.
ALTER TABLE "hostel_allocations"
  ADD CONSTRAINT "chk_hostel_allocations_deposit"
  CHECK (
    "security_deposit" >= 0
    AND ("deposit_refund_amount" IS NULL OR ("deposit_refund_amount" >= 0 AND "deposit_refund_amount" <= "security_deposit"))
    AND (
      "deposit_refunded" = false
      OR (
        "deposit_refund_amount" IS NOT NULL
        AND "deposit_refunded_at" IS NOT NULL
        AND "status" = 'VACATED'
      )
    )
  );

ALTER TABLE "mess_plans"
  ADD CONSTRAINT "chk_mess_plans_shape"
  CHECK (
    length(btrim("name")) > 0
    AND "monthly_charge" >= 0
  );

ALTER TABLE "mess_enrollments"
  ADD CONSTRAINT "chk_mess_enrollments_window"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- A meal-off is a range of whole days with a reason on it. The reason is
-- required because the approver is being asked to give money back and
-- has to be able to say why they did.
ALTER TABLE "meal_offs"
  ADD CONSTRAINT "chk_meal_offs_window"
  CHECK (
    "to_date" >= "from_date"
    AND length(btrim("reason")) > 0
  );

-- A decision carries the name of whoever made it and when (the M16/M17
-- evidence rule), a PENDING request carries neither, and an APPROVED one
-- additionally names the month whose invoice will carry the credit —
-- **pinned to the 1st**, because `idx_meal_offs_credit_month` and the
-- billing query both treat that column as a month and a value of the 14th
-- would silently belong to no month at all (the M21 `payroll_runs.month`
-- rule).
ALTER TABLE "meal_offs"
  ADD CONSTRAINT "chk_meal_offs_status_evidence"
  CHECK (
    ("status" NOT IN ('APPROVED', 'REJECTED') OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL))
    AND ("status" <> 'PENDING' OR ("approved_at" IS NULL AND "credit_month" IS NULL))
    AND ("status" <> 'APPROVED' OR "credit_month" IS NOT NULL)
    AND ("credit_month" IS NULL OR EXTRACT(DAY FROM "credit_month") = 1)
  );
