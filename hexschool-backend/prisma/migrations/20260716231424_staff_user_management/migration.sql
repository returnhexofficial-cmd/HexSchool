-- CreateEnum
CREATE TYPE "staff_designation_enum" AS ENUM ('PRINCIPAL', 'VICE_PRINCIPAL', 'ACCOUNTANT', 'ADMISSION_OFFICER', 'LIBRARIAN', 'OFFICE_STAFF', 'LAB_ASSISTANT', 'SECURITY', 'CLEANER', 'OTHER');

-- CreateEnum
CREATE TYPE "gender_enum" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "employment_type_enum" AS ENUM ('PERMANENT', 'CONTRACT', 'PART_TIME');

-- CreateEnum
CREATE TYPE "staff_status_enum" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED', 'RETIRED');

-- CreateEnum
CREATE TYPE "staff_document_type_enum" AS ENUM ('NID', 'CERTIFICATE', 'CV', 'PHOTO', 'CONTRACT', 'OTHER');

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_id" VARCHAR(30) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "name_bn" VARCHAR(200),
    "designation" "staff_designation_enum" NOT NULL,
    "department_id" UUID,
    "gender" "gender_enum" NOT NULL,
    "dob" DATE NOT NULL,
    "blood_group" VARCHAR(5),
    "nid_number" VARCHAR(17),
    "photo_url" VARCHAR(500),
    "address" JSONB NOT NULL DEFAULT '{}',
    "joining_date" DATE NOT NULL,
    "employment_type" "employment_type_enum" NOT NULL DEFAULT 'PERMANENT',
    "status" "staff_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "staff_document_type_enum" NOT NULL DEFAULT 'OTHER',
    "file_url" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "prefix" VARCHAR(30) NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_staff_profiles_user" ON "staff_profiles"("user_id");

-- CreateIndex
CREATE INDEX "idx_staff_profiles_school_status" ON "staff_profiles"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_staff_profiles_department" ON "staff_profiles"("department_id");

-- CreateIndex
CREATE INDEX "idx_staff_documents_staff" ON "staff_documents"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_document_sequences_prefix" ON "document_sequences"("school_id", "prefix");

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "fk_staff_profiles_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "fk_staff_profiles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "fk_staff_profiles_department" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_documents" ADD CONSTRAINT "fk_staff_documents_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_documents" ADD CONSTRAINT "fk_staff_documents_staff" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written section (features Prisma cannot express in schema) ──
-- Employee IDs are NEVER reused, even after soft delete (roadmap M07 §6)
-- — so unlike other business uniques, this one is NOT deleted_at-scoped.
CREATE UNIQUE INDEX "uq_staff_profiles_employee_id"
  ON "staff_profiles" ("school_id", "employee_id");

-- Sanity CHECKs.
ALTER TABLE "staff_profiles" ADD CONSTRAINT "chk_staff_profiles_dates"
  CHECK ("dob" < "joining_date");
ALTER TABLE "staff_documents" ADD CONSTRAINT "chk_staff_documents_size"
  CHECK ("size_bytes" > 0);
ALTER TABLE "document_sequences" ADD CONSTRAINT "chk_document_sequences_value"
  CHECK ("next_value" > 0);
