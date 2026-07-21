-- CreateEnum
CREATE TYPE "enrollment_type_enum" AS ENUM ('NEW', 'PROMOTED', 'READMITTED', 'TRANSFERRED_IN');

-- CreateEnum
CREATE TYPE "enrollment_status_enum" AS ENUM ('ACTIVE', 'TRANSFERRED_OUT', 'PROMOTED', 'RETAINED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "promotion_batch_status_enum" AS ENUM ('DRAFT', 'EXECUTED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "promotion_decision_enum" AS ENUM ('PROMOTE', 'RETAIN', 'GRADUATE', 'EXCLUDE');

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "group_id" UUID,
    "shift_id" UUID,
    "roll_no" INTEGER NOT NULL,
    "enrollment_date" DATE NOT NULL,
    "type" "enrollment_type_enum" NOT NULL DEFAULT 'NEW',
    "status" "enrollment_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "optional_subject_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "from_section_id" UUID NOT NULL,
    "to_section_id" UUID NOT NULL,
    "from_roll_no" INTEGER,
    "to_roll_no" INTEGER,
    "reason" TEXT,
    "transferred_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "from_session_id" UUID NOT NULL,
    "to_session_id" UUID NOT NULL,
    "status" "promotion_batch_status_enum" NOT NULL DEFAULT 'DRAFT',
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "executed_by" UUID,
    "executed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "promotion_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_enrollment_id" UUID,
    "decision" "promotion_decision_enum" NOT NULL DEFAULT 'PROMOTE',
    "to_class_id" UUID,
    "to_section_id" UUID,
    "to_enrollment_id" UUID,
    "result_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "promotion_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_enrollments_section" ON "enrollments"("session_id", "section_id", "status");

-- CreateIndex
CREATE INDEX "idx_enrollments_student" ON "enrollments"("student_id");

-- CreateIndex
CREATE INDEX "idx_enrollments_school_session" ON "enrollments"("school_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_enrollment_transfers_enrollment" ON "enrollment_transfers"("enrollment_id");

-- CreateIndex
CREATE INDEX "idx_promotion_batches_school_status" ON "promotion_batches"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_promotion_items_batch" ON "promotion_items"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_promotion_items_student" ON "promotion_items"("batch_id", "student_id");

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_section" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_group" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_optional_subject" FOREIGN KEY ("optional_subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_transfers" ADD CONSTRAINT "fk_enrollment_transfers_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_batches" ADD CONSTRAINT "fk_promotion_batches_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_batches" ADD CONSTRAINT "fk_promotion_batches_from_session" FOREIGN KEY ("from_session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_batches" ADD CONSTRAINT "fk_promotion_batches_to_session" FOREIGN KEY ("to_session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "fk_promotion_items_batch" FOREIGN KEY ("batch_id") REFERENCES "promotion_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "fk_promotion_items_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "fk_promotion_items_from_enrollment" FOREIGN KEY ("from_enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "fk_promotion_items_to_class" FOREIGN KEY ("to_class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "fk_promotion_items_to_section" FOREIGN KEY ("to_section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique indexes (hand-written — Prisma can't express them).
-- One LIVE enrollment per student per session: a CANCELLED (or soft-
-- deleted) enrollment frees the slot so the student can be re-enrolled.
CREATE UNIQUE INDEX "uq_enrollments_student_session"
  ON "enrollments" ("student_id", "session_id")
  WHERE "deleted_at" IS NULL AND "status" <> 'CANCELLED';

-- Roll number unique within a section for a session (same exclusion).
CREATE UNIQUE INDEX "uq_enrollments_roll"
  ON "enrollments" ("session_id", "section_id", "roll_no")
  WHERE "deleted_at" IS NULL AND "status" <> 'CANCELLED';
