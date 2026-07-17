-- CreateEnum
CREATE TYPE "religion_enum" AS ENUM ('ISLAM', 'HINDUISM', 'BUDDHISM', 'CHRISTIANITY', 'OTHER');

-- CreateEnum
CREATE TYPE "student_status_enum" AS ENUM ('ACTIVE', 'INACTIVE', 'TRANSFERRED', 'GRADUATED', 'DROPPED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "guardian_relation_enum" AS ENUM ('FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'UNCLE', 'AUNT', 'GRANDPARENT', 'LEGAL_GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "student_document_type_enum" AS ENUM ('BIRTH_CERTIFICATE', 'PHOTO', 'TRANSFER_CERTIFICATE', 'PREVIOUS_MARKSHEET', 'OTHER');

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "student_uid" VARCHAR(30) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "name_bn" VARCHAR(200),
    "gender" "gender_enum" NOT NULL,
    "dob" DATE NOT NULL,
    "blood_group" VARCHAR(5),
    "religion" "religion_enum" NOT NULL DEFAULT 'ISLAM',
    "birth_certificate_no" VARCHAR(17),
    "photo_url" VARCHAR(500),
    "present_address" JSONB NOT NULL DEFAULT '{}',
    "permanent_address" JSONB NOT NULL DEFAULT '{}',
    "admission_date" DATE NOT NULL,
    "admission_class_id" UUID,
    "previous_school" VARCHAR(300),
    "status" "student_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "qr_token" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "name_bn" VARCHAR(200),
    "relation" "guardian_relation_enum" NOT NULL DEFAULT 'OTHER',
    "phone" VARCHAR(15) NOT NULL,
    "email" CITEXT,
    "nid" VARCHAR(17),
    "occupation" VARCHAR(120),
    "monthly_income" DECIMAL(12,2),
    "address" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "relation" "guardian_relation_enum" NOT NULL DEFAULT 'OTHER',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_emergency_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_student_guardians" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "student_medical_info" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "height_cm" DECIMAL(5,2),
    "weight_kg" DECIMAL(5,2),
    "allergies" TEXT,
    "chronic_conditions" TEXT,
    "disabilities" TEXT,
    "emergency_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "student_medical_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "student_document_type_enum" NOT NULL DEFAULT 'OTHER',
    "file_url" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "from_status" "student_status_enum" NOT NULL,
    "to_status" "student_status_enum" NOT NULL,
    "reason" TEXT,
    "changed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_students_user" ON "students"("user_id");

-- CreateIndex (deliberately NOT deleted_at-scoped: UIDs never reused)
CREATE UNIQUE INDEX "uq_students_uid" ON "students"("school_id", "student_uid");

-- CreateIndex
CREATE UNIQUE INDEX "uq_students_qr_token" ON "students"("qr_token");

-- CreateIndex
CREATE INDEX "idx_students_school_status" ON "students"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_students_admission_class" ON "students"("school_id", "admission_class_id");

-- CreateIndex
CREATE INDEX "idx_students_dob" ON "students"("school_id", "dob");

-- CreateIndex
CREATE UNIQUE INDEX "uq_guardians_user" ON "guardians"("user_id");

-- CreateIndex
CREATE INDEX "idx_guardians_school_phone" ON "guardians"("school_id", "phone");

-- CreateIndex
CREATE INDEX "idx_student_guardians_guardian" ON "student_guardians"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_student_medical_info_student" ON "student_medical_info"("student_id");

-- CreateIndex
CREATE INDEX "idx_student_documents_student" ON "student_documents"("student_id");

-- CreateIndex
CREATE INDEX "idx_student_status_history_student" ON "student_status_history"("student_id", "created_at");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "fk_students_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "fk_students_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "fk_students_admission_class" FOREIGN KEY ("admission_class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "fk_guardians_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "fk_guardians_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "fk_student_guardians_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "fk_student_guardians_guardian" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_medical_info" ADD CONSTRAINT "fk_student_medical_info_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_medical_info" ADD CONSTRAINT "fk_student_medical_info_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "fk_student_documents_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "fk_student_documents_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "fk_student_status_history_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written section (features Prisma cannot express in schema) ──

-- Birth certificate numbers: soft-unique per school (data quality varies;
-- a deleted student releases the number — unlike the permanent UID).
CREATE UNIQUE INDEX "uq_students_birth_certificate" ON "students" ("school_id", "birth_certificate_no")
  WHERE "deleted_at" IS NULL AND "birth_certificate_no" IS NOT NULL;

-- Exactly one primary guardian per student (roadmap M09 §6).
CREATE UNIQUE INDEX "uq_student_guardians_primary" ON "student_guardians" ("student_id")
  WHERE "is_primary";

-- Sanity CHECKs (roadmap M09 §7).
ALTER TABLE "students" ADD CONSTRAINT "chk_students_dates"
  CHECK ("dob" < "admission_date");
ALTER TABLE "student_medical_info" ADD CONSTRAINT "chk_student_medical_measurements"
  CHECK (("height_cm" IS NULL OR "height_cm" > 0) AND ("weight_kg" IS NULL OR "weight_kg" > 0));
ALTER TABLE "student_documents" ADD CONSTRAINT "chk_student_documents_size"
  CHECK ("size_bytes" > 0);
ALTER TABLE "guardians" ADD CONSTRAINT "chk_guardians_income"
  CHECK ("monthly_income" IS NULL OR "monthly_income" >= 0);

-- M02 constraint adjustment (roadmap M09 §8): a guardian may also be
-- staff — the SAME phone/email may now back one account per user type.
-- Login resolves multi-matches by verifying the password against every
-- candidate (AuthService). Uniqueness moves from (school_id, contact)
-- to (school_id, user_type, contact), still soft-delete-scoped.
DROP INDEX "uq_users_email";
DROP INDEX "uq_users_phone";
CREATE UNIQUE INDEX "uq_users_email" ON "users" ("school_id", "user_type", "email")
  WHERE "deleted_at" IS NULL AND "email" IS NOT NULL;
CREATE UNIQUE INDEX "uq_users_phone" ON "users" ("school_id", "user_type", "phone")
  WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL;
