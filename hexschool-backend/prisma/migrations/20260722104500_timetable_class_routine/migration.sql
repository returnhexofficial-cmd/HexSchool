-- CreateEnum
CREATE TYPE "period_slot_type_enum" AS ENUM ('CLASS', 'BREAK', 'ASSEMBLY');

-- CreateEnum
CREATE TYPE "weekday_enum" AS ENUM ('SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI');

-- CreateEnum
CREATE TYPE "timetable_status_enum" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "period_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "type" "period_slot_type_enum" NOT NULL DEFAULT 'CLASS',
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "period_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "status" "timetable_status_enum" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "timetables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "timetable_id" UUID NOT NULL,
    "day" "weekday_enum" NOT NULL,
    "period_slot_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "room_no" VARCHAR(20),
    "combined_with_section_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_period_slots_school_shift" ON "period_slots"("school_id", "shift_id");

-- CreateIndex
CREATE INDEX "idx_timetables_school_session_status" ON "timetables"("school_id", "session_id", "status");

-- CreateIndex
CREATE INDEX "idx_timetables_section_status" ON "timetables"("section_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_timetable_entries_cell" ON "timetable_entries"("timetable_id", "day", "period_slot_id");

-- CreateIndex
CREATE INDEX "idx_timetable_entries_teacher_day" ON "timetable_entries"("teacher_id", "day");

-- CreateIndex
CREATE INDEX "idx_timetable_entries_slot_day" ON "timetable_entries"("period_slot_id", "day");

-- AddForeignKey
ALTER TABLE "period_slots" ADD CONSTRAINT "fk_period_slots_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_slots" ADD CONSTRAINT "fk_period_slots_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetables" ADD CONSTRAINT "fk_timetables_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetables" ADD CONSTRAINT "fk_timetables_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetables" ADD CONSTRAINT "fk_timetables_section" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "fk_timetable_entries_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "fk_timetable_entries_timetable" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "fk_timetable_entries_period_slot" FOREIGN KEY ("period_slot_id") REFERENCES "period_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "fk_timetable_entries_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "fk_timetable_entries_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "fk_timetable_entries_combined_section" FOREIGN KEY ("combined_with_section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- M12 debt closed: `student_attendances.period_id` was created as a bare
-- UUID column because period_slots did not exist yet. The FK lands now,
-- which is what turns period-mode marking on.
ALTER TABLE "student_attendances" ADD CONSTRAINT "fk_student_attendances_period" FOREIGN KEY ("period_id") REFERENCES "period_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique indexes + CHECKs (hand-written — Prisma can't express them).

-- Bell-schedule identity within a shift: no two live slots share a
-- position, and no two share a name (both soft-delete scoped so a
-- retired slot frees its position).
CREATE UNIQUE INDEX "uq_period_slots_order"
  ON "period_slots" ("shift_id", "display_order")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_period_slots_name"
  ON "period_slots" ("shift_id", lower("name"))
  WHERE "deleted_at" IS NULL;

-- Slot times are ordered (roadmap M13 §7). Overlap between slots of one
-- shift is a service-level check — an exclusion constraint would need
-- btree_gist and could not be relaxed for the BREAK-inside-CLASS layouts
-- some schools print.
ALTER TABLE "period_slots"
  ADD CONSTRAINT "chk_period_slots_time_order"
  CHECK ("start_time" < "end_time");

-- One live routine per (session, section) per lifecycle state: at most
-- one DRAFT being built and one PUBLISHED in force. ARCHIVED versions are
-- unlimited — they are the effective_from history.
CREATE UNIQUE INDEX "uq_timetables_live_version"
  ON "timetables" ("session_id", "section_id", "status")
  WHERE "deleted_at" IS NULL AND "status" <> 'ARCHIVED';

-- NOTE: "a combined class must point at a DIFFERENT section" (roadmap
-- M13 §8) is NOT a CHECK — the owning section lives one join away on
-- `timetables` and Postgres forbids subqueries in CHECK. The entry
-- service enforces it (and the conflict engine relies on it).
