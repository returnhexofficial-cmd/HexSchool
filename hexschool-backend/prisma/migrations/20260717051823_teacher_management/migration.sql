-- CreateEnum
CREATE TYPE "teacher_designation_enum" AS ENUM ('HEAD_TEACHER', 'ASSISTANT_HEAD', 'SENIOR_TEACHER', 'ASSISTANT_TEACHER', 'SUBJECT_TEACHER', 'PART_TIME');

-- CreateEnum
CREATE TYPE "leave_type_enum" AS ENUM ('CASUAL', 'SICK', 'MATERNITY', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "leave_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "teachers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_id" VARCHAR(30) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "name_bn" VARCHAR(200),
    "designation" "teacher_designation_enum" NOT NULL,
    "department_id" UUID,
    "gender" "gender_enum" NOT NULL,
    "dob" DATE NOT NULL,
    "blood_group" VARCHAR(5),
    "nid_number" VARCHAR(17),
    "photo_url" VARCHAR(500),
    "address" JSONB NOT NULL DEFAULT '{}',
    "joining_date" DATE NOT NULL,
    "salary_grade" VARCHAR(30),
    "mpo_index_no" VARCHAR(30),
    "specialization" VARCHAR(200),
    "status" "staff_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_qualifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "teacher_id" UUID NOT NULL,
    "degree" VARCHAR(100) NOT NULL,
    "institution" VARCHAR(200) NOT NULL,
    "passing_year" INTEGER NOT NULL,
    "result" VARCHAR(50),
    "document_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "teacher_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_subjects" (
    "teacher_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_teacher_subjects" PRIMARY KEY ("teacher_id","subject_id")
);

-- CreateTable
CREATE TABLE "teacher_section_subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "teacher_section_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_leaves" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "type" "leave_type_enum" NOT NULL DEFAULT 'CASUAL',
    "status" "leave_status_enum" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "teacher_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_evaluations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "evaluator_id" UUID NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "score" DECIMAL(5,2) NOT NULL,
    "remarks" TEXT,
    "evaluated_at" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "teacher_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "staff_document_type_enum" NOT NULL DEFAULT 'OTHER',
    "file_url" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teacher_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_teachers_user" ON "teachers"("user_id");

-- CreateIndex
CREATE INDEX "idx_teachers_school_status" ON "teachers"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_teachers_department" ON "teachers"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_teachers_employee_id" ON "teachers"("school_id", "employee_id");

-- CreateIndex
CREATE INDEX "idx_teacher_qualifications_teacher" ON "teacher_qualifications"("teacher_id");

-- CreateIndex
CREATE INDEX "idx_teacher_subjects_subject" ON "teacher_subjects"("subject_id");

-- CreateIndex
CREATE INDEX "idx_teacher_assignments_teacher" ON "teacher_section_subjects"("teacher_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_teacher_assignments_section" ON "teacher_section_subjects"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_teacher_assignments_slot" ON "teacher_section_subjects"("session_id", "section_id", "subject_id");

-- CreateIndex
CREATE INDEX "idx_teacher_leaves_teacher_status" ON "teacher_leaves"("teacher_id", "status");

-- CreateIndex
CREATE INDEX "idx_teacher_leaves_range" ON "teacher_leaves"("school_id", "from_date", "to_date");

-- CreateIndex
CREATE INDEX "idx_teacher_evaluations_teacher" ON "teacher_evaluations"("teacher_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_teacher_documents_teacher" ON "teacher_documents"("teacher_id");

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "fk_sections_class_teacher" FOREIGN KEY ("class_teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "fk_teachers_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "fk_teachers_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "fk_teachers_department" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_qualifications" ADD CONSTRAINT "fk_teacher_qualifications_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "fk_teacher_subjects_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "fk_teacher_subjects_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_section_subjects" ADD CONSTRAINT "fk_teacher_section_subjects_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_section_subjects" ADD CONSTRAINT "fk_teacher_section_subjects_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_section_subjects" ADD CONSTRAINT "fk_teacher_section_subjects_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_section_subjects" ADD CONSTRAINT "fk_teacher_section_subjects_section" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_section_subjects" ADD CONSTRAINT "fk_teacher_section_subjects_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_leaves" ADD CONSTRAINT "fk_teacher_leaves_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_leaves" ADD CONSTRAINT "fk_teacher_leaves_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_evaluations" ADD CONSTRAINT "fk_teacher_evaluations_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_evaluations" ADD CONSTRAINT "fk_teacher_evaluations_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_evaluations" ADD CONSTRAINT "fk_teacher_evaluations_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "fk_teacher_documents_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "fk_teacher_documents_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written section (features Prisma cannot express in schema) ──
-- Sanity CHECKs (roadmap M08 §7).
ALTER TABLE "teachers" ADD CONSTRAINT "chk_teachers_dates"
  CHECK ("dob" < "joining_date");
ALTER TABLE "teacher_qualifications" ADD CONSTRAINT "chk_teacher_qualifications_year"
  CHECK ("passing_year" >= 1950 AND "passing_year" <= 2100);
ALTER TABLE "teacher_leaves" ADD CONSTRAINT "chk_teacher_leaves_dates"
  CHECK ("from_date" <= "to_date");
ALTER TABLE "teacher_evaluations" ADD CONSTRAINT "chk_teacher_evaluations_score"
  CHECK ("score" >= 0 AND "score" <= 100);
ALTER TABLE "teacher_documents" ADD CONSTRAINT "chk_teacher_documents_size"
  CHECK ("size_bytes" > 0);
