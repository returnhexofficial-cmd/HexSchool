-- ── Module 25: Transport Management ──────────────────────────────────

-- CreateEnum
CREATE TYPE "vehicle_type_enum" AS ENUM ('BUS', 'MICROBUS', 'VAN', 'OTHER');

-- CreateEnum
CREATE TYPE "vehicle_status_enum" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "driver_status_enum" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "route_status_enum" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "transport_assignment_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "vehicle_expense_type_enum" AS ENUM ('FUEL', 'MAINTENANCE', 'REPAIR', 'TOLL', 'OTHER');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `transport`
-- joins it so the new `transport.*` keys validate. Safe inside the
-- migration transaction because nothing written HERE uses the new value
-- (PG only forbids *using* it in the transaction that adds it) — the
-- M20/M21/M22/M23 `settings_group_enum` precedent.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'transport';

-- AlterEnum
-- M20's auto-posting source. A fuel bill is the first machine-posted
-- voucher in the system that SPENDS money rather than receiving it, and
-- the income & expenditure statement has to be able to say so.
ALTER TYPE "voucher_source_enum" ADD VALUE IF NOT EXISTS 'TRANSPORT';

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "reg_no" VARCHAR(40) NOT NULL,
    "type" "vehicle_type_enum" NOT NULL DEFAULT 'BUS',
    "capacity" INTEGER NOT NULL,
    "make_model" VARCHAR(120),
    "model_year" INTEGER,
    "status" "vehicle_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "fitness_expiry" DATE,
    "tax_token_expiry" DATE,
    "insurance_expiry" DATE,
    "expiry_notified_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "staff_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "license_no" VARCHAR(60) NOT NULL,
    "license_expiry" DATE,
    "address" TEXT,
    "status" "driver_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "expiry_notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "name_bn" VARCHAR(160),
    "description" TEXT,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "substitute_driver_id" UUID,
    "helper_name" VARCHAR(120),
    "helper_phone" VARCHAR(20),
    "status" "route_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "landmark" VARCHAR(200),
    "pickup_time" TIME(0),
    "drop_time" TIME(0),
    "monthly_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "stop_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "transport_assignment_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "suspended_at" DATE,
    "resumed_at" DATE,
    "status_reason" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "transport_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "type" "vehicle_expense_type_enum" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "odometer" INTEGER,
    "description" TEXT,
    "receipt_url" VARCHAR(500),
    "voucher_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vehicle_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_vehicles_status" ON "vehicles"("school_id", "status");
CREATE INDEX "idx_drivers_status" ON "drivers"("school_id", "status");
CREATE INDEX "idx_routes_status" ON "routes"("school_id", "status");
CREATE INDEX "idx_routes_vehicle" ON "routes"("school_id", "vehicle_id");
CREATE INDEX "idx_route_stops_route" ON "route_stops"("route_id");
CREATE INDEX "idx_transport_assignments_route" ON "transport_assignments"("school_id", "route_id", "status");
CREATE INDEX "idx_transport_assignments_stop" ON "transport_assignments"("school_id", "stop_id");
CREATE INDEX "idx_transport_assignments_enrollment" ON "transport_assignments"("enrollment_id");
CREATE INDEX "idx_vehicle_expenses_vehicle" ON "vehicle_expenses"("school_id", "vehicle_id", "date");
CREATE INDEX "idx_vehicle_expenses_date" ON "vehicle_expenses"("school_id", "date");

-- CreateIndex
-- Not an identity rule: this is the unique target the COMPOSITE foreign
-- key below needs. `id` is already unique on its own, so the index adds
-- no constraint the table did not have — it only lets Postgres check
-- "this stop belongs to this route" as a foreign key.
CREATE UNIQUE INDEX "uq_route_stops_route_stop" ON "route_stops"("route_id", "id");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "fk_vehicles_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drivers" ADD CONSTRAINT "fk_drivers_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drivers" ADD CONSTRAINT "fk_drivers_staff" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "routes" ADD CONSTRAINT "fk_routes_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "routes" ADD CONSTRAINT "fk_routes_vehicle" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "routes" ADD CONSTRAINT "fk_routes_driver" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "routes" ADD CONSTRAINT "fk_routes_substitute_driver" FOREIGN KEY ("substitute_driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "route_stops" ADD CONSTRAINT "fk_route_stops_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "route_stops" ADD CONSTRAINT "fk_route_stops_route" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transport_assignments" ADD CONSTRAINT "fk_transport_assignments_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transport_assignments" ADD CONSTRAINT "fk_transport_assignments_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transport_assignments" ADD CONSTRAINT "fk_transport_assignments_route" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The stop must be a stop ON that route. A single-column FK on `stop_id`
-- would happily accept a stop from a different route, and the office
-- would find out when the driver's sheet printed a child waiting at a
-- corner the bus never passes. Composite FKs are the one way to say
-- "these two columns agree" without a trigger.
ALTER TABLE "transport_assignments" ADD CONSTRAINT "fk_transport_assignments_route_stop" FOREIGN KEY ("route_id", "stop_id") REFERENCES "route_stops"("route_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "fk_vehicle_expenses_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "fk_vehicle_expenses_vehicle" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written identity indexes ───────────────────────────────────
-- Prisma cannot express a partial unique, so every one of these is
-- written here and mirrored nowhere else (the M11/M12/M15/M16 rule).

-- A registration plate is unique per school among LIVE rows — the
-- OPPOSITE of the M07 employee-ID / M09 student-UID / M23 accession rule,
-- and deliberately so. Those numbers are issued BY the school and printed
-- on something; a plate is issued by the BRTA and belongs to the vehicle.
-- Deleting a mis-typed row must free the plate to be entered correctly.
CREATE UNIQUE INDEX "uq_vehicles_reg_no" ON "vehicles"("school_id", upper(btrim("reg_no")))
  WHERE "deleted_at" IS NULL;

-- A licence number identifies a person, and two live driver rows sharing
-- one would mean the school does not know who is driving.
CREATE UNIQUE INDEX "uq_drivers_license_no" ON "drivers"("school_id", upper(btrim("license_no")))
  WHERE "deleted_at" IS NULL;

-- One driver record per employee. Without it a school that links a staff
-- member twice gets two driver rows for one person, and the leave that
-- takes them off the road only reaches one of them.
CREATE UNIQUE INDEX "uq_drivers_staff" ON "drivers"("school_id", "staff_id")
  WHERE "staff_id" IS NOT NULL AND "deleted_at" IS NULL;

-- Route names are how the office and the driver talk about a route, so
-- two live routes may not share one; a deleted route frees its name.
CREATE UNIQUE INDEX "uq_routes_name" ON "routes"("school_id", lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

-- Two stops with the same name on one route is a driver's sheet nobody
-- can follow.
CREATE UNIQUE INDEX "uq_route_stops_name" ON "route_stops"("route_id", lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

-- The stop sequence is the route: it decides the order the sheet prints
-- and the order the bus drives. Two stops at position 3 have no defined
-- order, so the reorder endpoint has to do the M11 two-phase negative
-- update rather than assign 0…N over the top of itself.
CREATE UNIQUE INDEX "uq_route_stops_order" ON "route_stops"("route_id", "display_order")
  WHERE "deleted_at" IS NULL;

-- **One live transport assignment per enrollment** (roadmap §3). A child
-- rides one bus from one stop; the SUSPENDED row is still that child's
-- place on the route, which is why the predicate excludes only ENDED.
CREATE UNIQUE INDEX "uq_transport_assignments_live" ON "transport_assignments"("enrollment_id")
  WHERE "status" IN ('ACTIVE', 'SUSPENDED') AND "deleted_at" IS NULL;

-- ── CHECK constraints ───────────────────────────────────────────────

-- A plate that is blank, or a bus with no seats, is a row no report can
-- use. The upper bound on capacity is a sanity rail: a 500-seat school
-- bus is a typo, and the capacity engine would then never warn about
-- anything.
ALTER TABLE "vehicles"
  ADD CONSTRAINT "chk_vehicles_shape"
  CHECK (
    length(btrim("reg_no")) > 0
    AND "capacity" BETWEEN 1 AND 200
    AND ("model_year" IS NULL OR "model_year" BETWEEN 1950 AND 2200)
  );

ALTER TABLE "drivers"
  ADD CONSTRAINT "chk_drivers_shape"
  CHECK (
    length(btrim("name")) > 0
    AND length(btrim("phone")) > 0
    AND length(btrim("license_no")) > 0
  );

-- A route may not list the same person as driver and substitute: the
-- substitute exists precisely because the driver is away, so the pair
-- being equal means the route has nobody.
ALTER TABLE "routes"
  ADD CONSTRAINT "chk_routes_shape"
  CHECK (
    length(btrim("name")) > 0
    AND (
      "substitute_driver_id" IS NULL
      OR "driver_id" IS NULL
      OR "substitute_driver_id" <> "driver_id"
    )
  );

-- The stop's fee is what a rider is billed every month, so a negative one
-- would hand a family money for travelling. `display_order` is a position
-- in a sequence, and positions start at zero.
ALTER TABLE "route_stops"
  ADD CONSTRAINT "chk_route_stops_shape"
  CHECK (
    length(btrim("name")) > 0
    AND "monthly_fee" >= 0
    AND "display_order" >= 0
  );

-- **The billing window has to be a window.** M16 reads
-- `[resumed_at ?? start_date, end_date ?? suspended_at ?? ∞)` and
-- prorates a month against it; every one of these clauses is a way that
-- window could come out backwards and quietly bill a negative number of
-- days — the M22 `chk_assignments_window` situation, for money.
ALTER TABLE "transport_assignments"
  ADD CONSTRAINT "chk_transport_assignments_window"
  CHECK (
    ("end_date" IS NULL OR "end_date" >= "start_date")
    AND ("suspended_at" IS NULL OR "suspended_at" >= "start_date")
    AND ("resumed_at" IS NULL OR "suspended_at" IS NULL OR "resumed_at" >= "suspended_at")
  );

-- A status with no date behind it cannot answer "how much of March does
-- this rider owe" — the M21 `exit_date` lesson, pinned at the database.
-- ACTIVE additionally may not carry a suspension date, or billing would
-- stop for a rider who is on the bus every morning.
ALTER TABLE "transport_assignments"
  ADD CONSTRAINT "chk_transport_assignments_status_evidence"
  CHECK (
    ("status" <> 'ENDED' OR "end_date" IS NOT NULL)
    AND ("status" <> 'SUSPENDED' OR "suspended_at" IS NOT NULL)
    AND ("status" <> 'ACTIVE' OR "suspended_at" IS NULL)
  );

-- An expense of zero is a receipt nobody needs to keep, and a negative
-- one is income entered in the wrong place — which would understate what
-- the fleet costs in exactly the report this module exists to produce.
-- A negative odometer is a broken reading, and the per-kilometre figure
-- would divide by it.
ALTER TABLE "vehicle_expenses"
  ADD CONSTRAINT "chk_vehicle_expenses_shape"
  CHECK (
    "amount" > 0
    AND ("odometer" IS NULL OR "odometer" >= 0)
  );
