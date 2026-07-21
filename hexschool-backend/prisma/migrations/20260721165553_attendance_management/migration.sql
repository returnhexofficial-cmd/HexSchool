-- CreateEnum
CREATE TYPE "attendance_status_enum" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "attendance_method_enum" AS ENUM ('MANUAL', 'QR', 'IMPORT', 'AUTO');

-- CreateEnum
CREATE TYPE "attendance_person_type_enum" AS ENUM ('TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "student_leave_applied_by_enum" AS ENUM ('GUARDIAN', 'ADMIN');

-- CreateTable
CREATE TABLE "student_attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "period_id" UUID,
    "status" "attendance_status_enum" NOT NULL,
    "check_in_time" TIMESTAMPTZ(6),
    "method" "attendance_method_enum" NOT NULL DEFAULT 'MANUAL',
    "remarks" TEXT,
    "marked_by" UUID,
    "absent_notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "student_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_type" "attendance_person_type_enum" NOT NULL,
    "person_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "attendance_status_enum" NOT NULL,
    "check_in_time" TIMESTAMPTZ(6),
    "check_out_time" TIMESTAMPTZ(6),
    "method" "attendance_method_enum" NOT NULL DEFAULT 'MANUAL',
    "remarks" TEXT,
    "marked_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_leave_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "applied_by" "student_leave_applied_by_enum" NOT NULL DEFAULT 'ADMIN',
    "status" "leave_status_enum" NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "student_leave_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_student_attendances_section_date" ON "student_attendances"("section_id", "date");

-- CreateIndex
CREATE INDEX "idx_student_attendances_enrollment_date" ON "student_attendances"("enrollment_id", "date");

-- CreateIndex
CREATE INDEX "idx_student_attendances_school_date" ON "student_attendances"("school_id", "date", "status");

-- CreateIndex
CREATE INDEX "idx_staff_attendances_school_date" ON "staff_attendances"("school_id", "date");

-- CreateIndex
CREATE INDEX "idx_staff_attendances_person" ON "staff_attendances"("person_type", "person_id", "date");

-- CreateIndex
CREATE INDEX "idx_student_leave_applications_school_status" ON "student_leave_applications"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_student_leave_applications_student" ON "student_leave_applications"("student_id", "from_date");

-- AddForeignKey
ALTER TABLE "student_attendances" ADD CONSTRAINT "fk_student_attendances_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendances" ADD CONSTRAINT "fk_student_attendances_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendances" ADD CONSTRAINT "fk_student_attendances_section" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendances" ADD CONSTRAINT "fk_staff_attendances_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_leave_applications" ADD CONSTRAINT "fk_student_leave_applications_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_leave_applications" ADD CONSTRAINT "fk_student_leave_applications_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_leave_applications" ADD CONSTRAINT "fk_student_leave_applications_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes + CHECKs (hand-written — Prisma can't express them).
-- One attendance row per enrollment per date per period. period_id is
-- NULL in daily mode and Postgres treats NULLs as distinct, so COALESCE
-- maps it to the nil UUID inside the index (same trick as M06 sections).
CREATE UNIQUE INDEX "uq_student_attendances_entry"
  ON "student_attendances" ("enrollment_id", "date",
   COALESCE("period_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "deleted_at" IS NULL;

-- One attendance row per employee per date.
CREATE UNIQUE INDEX "uq_staff_attendances_entry"
  ON "staff_attendances" ("person_type", "person_id", "date")
  WHERE "deleted_at" IS NULL;

-- Leave ranges are ordered (roadmap M12 §7).
ALTER TABLE "student_leave_applications"
  ADD CONSTRAINT "chk_student_leave_applications_range"
  CHECK ("from_date" <= "to_date");
