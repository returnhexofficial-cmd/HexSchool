-- CreateEnum
CREATE TYPE "exam_status_enum" AS ENUM ('DRAFT', 'SCHEDULED', 'ONGOING', 'MARK_ENTRY', 'PROCESSING', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "seat_plan_strategy_enum" AS ENUM ('SERPENTINE', 'INTERLEAVE');

-- CreateTable
CREATE TABLE "exam_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "weight" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "exam_type_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "grading_system_id" UUID NOT NULL,
    "status" "exam_status_enum" NOT NULL DEFAULT 'DRAFT',
    "result_publish_at" TIMESTAMPTZ(6),
    "grading_snapshot" JSONB,
    "instructions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_classes" (
    "exam_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_exam_classes" PRIMARY KEY ("exam_id","class_id")
);

-- CreateTable
CREATE TABLE "exam_subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "full_marks" INTEGER NOT NULL,
    "pass_marks" INTEGER NOT NULL,
    "cq_marks" INTEGER,
    "mcq_marks" INTEGER,
    "practical_marks" INTEGER,
    "ca_marks" INTEGER,
    "cq_pass_marks" INTEGER,
    "mcq_pass_marks" INTEGER,
    "practical_pass_marks" INTEGER,
    "ca_pass_marks" INTEGER,
    "exam_date" DATE,
    "start_time" TIME(0),
    "duration_min" INTEGER,
    "room" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "exam_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "room" VARCHAR(20) NOT NULL,
    "date" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "strategy" "seat_plan_strategy_enum" NOT NULL DEFAULT 'SERPENTINE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "seat_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_plan_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "seat_plan_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "seat_no" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_plan_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_exam_types_school" ON "exam_types"("school_id");

-- CreateIndex
CREATE INDEX "idx_exams_school_session_status" ON "exams"("school_id", "session_id", "status");

-- CreateIndex
CREATE INDEX "idx_exams_type" ON "exams"("exam_type_id");

-- CreateIndex
CREATE INDEX "idx_exam_classes_class" ON "exam_classes"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_exam_subjects_paper" ON "exam_subjects"("exam_id", "class_id", "subject_id");

-- CreateIndex
CREATE INDEX "idx_exam_subjects_exam_date" ON "exam_subjects"("exam_id", "exam_date");

-- CreateIndex
CREATE INDEX "idx_exam_subjects_subject" ON "exam_subjects"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_seat_plans_room_date" ON "seat_plans"("exam_id", "date", "room");

-- CreateIndex
CREATE INDEX "idx_seat_plans_exam_date" ON "seat_plans"("exam_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_seat_plan_entries_seat" ON "seat_plan_entries"("seat_plan_id", "seat_no");

-- CreateIndex
CREATE UNIQUE INDEX "uq_seat_plan_entries_candidate" ON "seat_plan_entries"("seat_plan_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "idx_seat_plan_entries_enrollment" ON "seat_plan_entries"("enrollment_id");

-- AddForeignKey
ALTER TABLE "exam_types" ADD CONSTRAINT "fk_exam_types_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "fk_exams_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "fk_exams_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "fk_exams_type" FOREIGN KEY ("exam_type_id") REFERENCES "exam_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "fk_exams_grading_system" FOREIGN KEY ("grading_system_id") REFERENCES "grading_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_classes" ADD CONSTRAINT "fk_exam_classes_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_classes" ADD CONSTRAINT "fk_exam_classes_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "fk_exam_subjects_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "fk_exam_subjects_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "fk_exam_subjects_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "fk_exam_subjects_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_plans" ADD CONSTRAINT "fk_seat_plans_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_plans" ADD CONSTRAINT "fk_seat_plans_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_plan_entries" ADD CONSTRAINT "fk_seat_plan_entries_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_plan_entries" ADD CONSTRAINT "fk_seat_plan_entries_plan" FOREIGN KEY ("seat_plan_id") REFERENCES "seat_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_plan_entries" ADD CONSTRAINT "fk_seat_plan_entries_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes + CHECKs (hand-written — Prisma can't express them).

-- Names are the human handle for both entities, so they are unique per
-- scope and case-insensitively so ("Half Yearly" vs "half yearly" is the
-- same exam type to a user). Soft-delete scoped: deleting a type frees
-- its name for reuse.
CREATE UNIQUE INDEX "uq_exam_types_name"
  ON "exam_types" ("school_id", lower("name"))
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_exams_name"
  ON "exams" ("school_id", "session_id", lower("name"))
  WHERE "deleted_at" IS NULL;

-- A weight is a percentage share of a combined result. That the weights
-- of a COMBINED SET add to 100 cannot live here — only Module 15 knows
-- which types a given report card merges (roadmap M14 §7).
ALTER TABLE "exam_types"
  ADD CONSTRAINT "chk_exam_types_weight"
  CHECK ("weight" IS NULL OR ("weight" >= 0 AND "weight" <= 100));

-- Exam window sanity. That the window sits INSIDE the session is
-- service-enforced: the dates live on academic_sessions, one join away.
ALTER TABLE "exams"
  ADD CONSTRAINT "chk_exams_date_order"
  CHECK ("start_date" <= "end_date");

-- Pass marks are reachable (roadmap M14 §6).
ALTER TABLE "exam_subjects"
  ADD CONSTRAINT "chk_exam_subjects_marks"
  CHECK ("full_marks" > 0 AND "pass_marks" >= 0 AND "pass_marks" <= "full_marks");

-- A paper is either flat (every component NULL) or fully split, and a
-- split's parts must add up to full_marks. Expressible as a CHECK because
-- all four columns are on this row.
ALTER TABLE "exam_subjects"
  ADD CONSTRAINT "chk_exam_subjects_components"
  CHECK (
    ("cq_marks" IS NULL AND "mcq_marks" IS NULL AND "practical_marks" IS NULL AND "ca_marks" IS NULL)
    OR (
      COALESCE("cq_marks", 0) + COALESCE("mcq_marks", 0)
      + COALESCE("practical_marks", 0) + COALESCE("ca_marks", 0) = "full_marks"
    )
  );

-- A per-component pass threshold only means something when that
-- component exists, and can never exceed it. Non-NULL is the roadmap's
-- "per-component pass flag": this part must be passed on its own.
ALTER TABLE "exam_subjects"
  ADD CONSTRAINT "chk_exam_subjects_component_pass"
  CHECK (
    ("cq_pass_marks" IS NULL OR ("cq_marks" IS NOT NULL AND "cq_pass_marks" BETWEEN 0 AND "cq_marks"))
    AND ("mcq_pass_marks" IS NULL OR ("mcq_marks" IS NOT NULL AND "mcq_pass_marks" BETWEEN 0 AND "mcq_marks"))
    AND ("practical_pass_marks" IS NULL OR ("practical_marks" IS NOT NULL AND "practical_pass_marks" BETWEEN 0 AND "practical_marks"))
    AND ("ca_pass_marks" IS NULL OR ("ca_marks" IS NOT NULL AND "ca_pass_marks" BETWEEN 0 AND "ca_marks"))
  );

-- Sitting length bounds (roadmap M14 §7).
ALTER TABLE "exam_subjects"
  ADD CONSTRAINT "chk_exam_subjects_duration"
  CHECK ("duration_min" IS NULL OR ("duration_min" BETWEEN 10 AND 360));

-- A scheduled sitting needs both a date and a time, or neither — a
-- half-scheduled paper cannot be printed on a routine or an admit card.
ALTER TABLE "exam_subjects"
  ADD CONSTRAINT "chk_exam_subjects_schedule"
  CHECK (
    ("exam_date" IS NULL AND "start_time" IS NULL AND "duration_min" IS NULL)
    OR ("exam_date" IS NOT NULL AND "start_time" IS NOT NULL AND "duration_min" IS NOT NULL)
  );

ALTER TABLE "seat_plans"
  ADD CONSTRAINT "chk_seat_plans_capacity"
  CHECK ("capacity" > 0);

ALTER TABLE "seat_plan_entries"
  ADD CONSTRAINT "chk_seat_plan_entries_seat_no"
  CHECK ("seat_no" > 0);
