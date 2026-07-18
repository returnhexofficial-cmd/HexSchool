-- CreateEnum
CREATE TYPE "admission_cycle_status_enum" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "admission_application_status_enum" AS ENUM ('DRAFT', 'SUBMITTED', 'PAYMENT_PENDING', 'UNDER_REVIEW', 'TEST_SCHEDULED', 'PASSED', 'FAILED', 'SELECTED', 'WAITLISTED', 'ADMITTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "admission_payment_status_enum" AS ENUM ('UNPAID', 'PAID', 'WAIVED', 'REFUNDED');

-- CreateTable
CREATE TABLE "admission_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "test_required" BOOLEAN NOT NULL DEFAULT false,
    "status" "admission_cycle_status_enum" NOT NULL DEFAULT 'DRAFT',
    "instructions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "admission_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_cycle_classes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "application_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admission_cycle_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "application_no" VARCHAR(30) NOT NULL,
    "class_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "name_bn" VARCHAR(200),
    "gender" "gender_enum" NOT NULL,
    "dob" DATE NOT NULL,
    "religion" "religion_enum" NOT NULL DEFAULT 'ISLAM',
    "photo_url" VARCHAR(500),
    "present_address" JSONB NOT NULL DEFAULT '{}',
    "permanent_address" JSONB NOT NULL DEFAULT '{}',
    "previous_school" VARCHAR(300),
    "previous_gpa" DECIMAL(4,2),
    "previous_result" JSONB NOT NULL DEFAULT '{}',
    "guardian" JSONB NOT NULL DEFAULT '{}',
    "phone" VARCHAR(15) NOT NULL,
    "status" "admission_application_status_enum" NOT NULL DEFAULT 'SUBMITTED',
    "payment_status" "admission_payment_status_enum" NOT NULL DEFAULT 'UNPAID',
    "payment_ref" VARCHAR(100),
    "payment_method" VARCHAR(30),
    "paid_amount" DECIMAL(12,2),
    "paid_at" TIMESTAMPTZ(6),
    "test_marks" DECIMAL(6,2),
    "merit_position" INTEGER,
    "admission_deadline" TIMESTAMPTZ(6),
    "student_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_tests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "test_date" DATE NOT NULL,
    "venue" VARCHAR(200),
    "total_marks" INTEGER NOT NULL,
    "pass_marks" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "admission_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_admission_cycles_school_status" ON "admission_cycles"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_admission_cycles_session" ON "admission_cycles"("session_id");

-- CreateIndex
CREATE INDEX "idx_admission_cycle_classes_class" ON "admission_cycle_classes"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_admission_cycle_classes" ON "admission_cycle_classes"("cycle_id", "class_id");

-- CreateIndex
CREATE INDEX "idx_admission_applications_cycle_class" ON "admission_applications"("cycle_id", "class_id", "status");

-- CreateIndex
CREATE INDEX "idx_admission_applications_phone" ON "admission_applications"("school_id", "phone");

-- CreateIndex
CREATE INDEX "idx_admission_applications_deadline" ON "admission_applications"("status", "admission_deadline");

-- CreateIndex
CREATE UNIQUE INDEX "uq_admission_applications_no" ON "admission_applications"("school_id", "application_no");

-- CreateIndex
CREATE UNIQUE INDEX "uq_admission_tests_cycle_class" ON "admission_tests"("cycle_id", "class_id");

-- AddForeignKey
ALTER TABLE "admission_cycles" ADD CONSTRAINT "fk_admission_cycles_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_cycles" ADD CONSTRAINT "fk_admission_cycles_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_cycle_classes" ADD CONSTRAINT "fk_admission_cycle_classes_cycle" FOREIGN KEY ("cycle_id") REFERENCES "admission_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_cycle_classes" ADD CONSTRAINT "fk_admission_cycle_classes_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "fk_admission_applications_cycle" FOREIGN KEY ("cycle_id") REFERENCES "admission_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "fk_admission_applications_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "fk_admission_applications_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_tests" ADD CONSTRAINT "fk_admission_tests_cycle" FOREIGN KEY ("cycle_id") REFERENCES "admission_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_tests" ADD CONSTRAINT "fk_admission_tests_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written section (features Prisma cannot express in schema) ──

-- Cycle names: soft-unique per school.
CREATE UNIQUE INDEX "uq_admission_cycles_name" ON "admission_cycles" ("school_id", "name")
  WHERE "deleted_at" IS NULL;

-- Duplicate rule (roadmap M10 §6): one LIVE application per
-- (cycle, class, phone, dob). Terminal statuses are excluded so a
-- cancelled/rejected/expired applicant may reapply.
CREATE UNIQUE INDEX "uq_admission_applications_applicant" ON "admission_applications"
  ("cycle_id", "class_id", "phone", "dob")
  WHERE "deleted_at" IS NULL
    AND "status" NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED');

-- Sanity CHECKs (roadmap M10 §7).
ALTER TABLE "admission_cycles" ADD CONSTRAINT "chk_admission_cycles_window"
  CHECK ("start_at" < "end_at");
ALTER TABLE "admission_cycle_classes" ADD CONSTRAINT "chk_admission_cycle_classes_seats"
  CHECK ("seats" > 0);
ALTER TABLE "admission_cycle_classes" ADD CONSTRAINT "chk_admission_cycle_classes_fee"
  CHECK ("application_fee" >= 0);
ALTER TABLE "admission_tests" ADD CONSTRAINT "chk_admission_tests_marks"
  CHECK ("total_marks" > 0 AND "pass_marks" >= 0 AND "pass_marks" <= "total_marks");
ALTER TABLE "admission_applications" ADD CONSTRAINT "chk_admission_applications_test_marks"
  CHECK ("test_marks" IS NULL OR "test_marks" >= 0);
ALTER TABLE "admission_applications" ADD CONSTRAINT "chk_admission_applications_paid_amount"
  CHECK ("paid_amount" IS NULL OR "paid_amount" >= 0);
