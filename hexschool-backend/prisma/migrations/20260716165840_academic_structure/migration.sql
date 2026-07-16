-- CreateEnum
CREATE TYPE "subject_type_enum" AS ENUM ('THEORY', 'PRACTICAL', 'BOTH');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_bn" VARCHAR(100),
    "numeric_level" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "applicable_from_level" INTEGER NOT NULL DEFAULT 9,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "name" VARCHAR(5) NOT NULL,
    "shift_id" UUID,
    "group_id" UUID,
    "capacity" INTEGER,
    "class_teacher_id" UUID,
    "room_no" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_bn" VARCHAR(100),
    "code" VARCHAR(20) NOT NULL,
    "department_id" UUID,
    "type" "subject_type_enum" NOT NULL DEFAULT 'THEORY',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "group_id" UUID,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "full_marks_default" INTEGER NOT NULL DEFAULT 100,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_departments_school" ON "departments"("school_id");

-- CreateIndex
CREATE INDEX "idx_shifts_school" ON "shifts"("school_id");

-- CreateIndex
CREATE INDEX "idx_classes_school" ON "classes"("school_id");

-- CreateIndex
CREATE INDEX "idx_groups_school" ON "groups"("school_id");

-- CreateIndex
CREATE INDEX "idx_sections_school_session" ON "sections"("school_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_sections_class" ON "sections"("class_id");

-- CreateIndex
CREATE INDEX "idx_subjects_school" ON "subjects"("school_id");

-- CreateIndex
CREATE INDEX "idx_class_subjects_class_session" ON "class_subjects"("class_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_class_subjects_subject" ON "class_subjects"("subject_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "fk_departments_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "fk_shifts_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "fk_classes_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "fk_groups_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "fk_sections_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "fk_sections_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "fk_sections_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "fk_sections_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "fk_sections_group" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "fk_subjects_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "fk_subjects_department" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "fk_class_subjects_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "fk_class_subjects_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "fk_class_subjects_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "fk_class_subjects_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "fk_class_subjects_group" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Hand-written section (features Prisma cannot express in schema) ──
-- Soft-delete-aware uniques: a deleted row releases its identity.
CREATE UNIQUE INDEX "uq_departments_code" ON "departments" ("school_id", "code")
  WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_classes_numeric_level" ON "classes" ("school_id", "numeric_level")
  WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_groups_name" ON "groups" ("school_id", "name")
  WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_subjects_code" ON "subjects" ("school_id", "code")
  WHERE "deleted_at" IS NULL;
-- Shifts are hard-deleted (no deleted_at) — plain unique name per school.
CREATE UNIQUE INDEX "uq_shifts_name" ON "shifts" ("school_id", "name");

-- Section identity (roadmap M06 §3): NULL shift_id must not evade the
-- uniqueness, so COALESCE maps it to the nil UUID inside the index.
CREATE UNIQUE INDEX "uq_sections_identity" ON "sections"
  ("school_id", "session_id", "class_id", "name",
   COALESCE("shift_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "deleted_at" IS NULL;

-- Curriculum mapping identity — same treatment for NULL group_id.
CREATE UNIQUE INDEX "uq_class_subjects_identity" ON "class_subjects"
  ("class_id", "subject_id", "session_id",
   COALESCE("group_id", '00000000-0000-0000-0000-000000000000'::uuid));

-- Sanity CHECKs (roadmap M06 §7).
ALTER TABLE "shifts" ADD CONSTRAINT "chk_shifts_times"
  CHECK ("start_time" < "end_time");
ALTER TABLE "classes" ADD CONSTRAINT "chk_classes_level"
  CHECK ("numeric_level" >= 0 AND "numeric_level" <= 20);
ALTER TABLE "sections" ADD CONSTRAINT "chk_sections_capacity"
  CHECK ("capacity" IS NULL OR "capacity" > 0);
ALTER TABLE "class_subjects" ADD CONSTRAINT "chk_class_subjects_marks"
  CHECK ("full_marks_default" > 0 AND "full_marks_default" <= 1000);
