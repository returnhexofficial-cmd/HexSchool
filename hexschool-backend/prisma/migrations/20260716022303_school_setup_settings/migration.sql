-- CreateEnum
CREATE TYPE "school_type_enum" AS ENUM ('PRIMARY', 'HIGH_SCHOOL', 'KINDERGARTEN', 'ENGLISH_VERSION', 'ENGLISH_MEDIUM', 'MADRASA', 'VOCATIONAL', 'COLLEGE');

-- CreateEnum
CREATE TYPE "school_status_enum" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "settings_group_enum" AS ENUM ('general', 'academic', 'sms', 'email', 'payment', 'attendance', 'exam', 'fees');

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "name_bn" VARCHAR(200),
    "code" VARCHAR(10) NOT NULL,
    "eiin_number" VARCHAR(6),
    "type" "school_type_enum" NOT NULL DEFAULT 'HIGH_SCHOOL',
    "address" TEXT,
    "phone" VARCHAR(20),
    "email" CITEXT,
    "website" VARCHAR(200),
    "logo_url" VARCHAR(500),
    "established_year" INTEGER,
    "principal_name" VARCHAR(120),
    "status" "school_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "group" "settings_group_enum" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "school_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_systems" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "grading_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_points" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grading_system_id" UUID NOT NULL,
    "grade" VARCHAR(5) NOT NULL,
    "point" DECIMAL(3,2) NOT NULL,
    "min_mark" INTEGER NOT NULL,
    "max_mark" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_school_settings_group" ON "school_settings"("school_id", "group");

-- CreateIndex
CREATE UNIQUE INDEX "uq_school_settings_key" ON "school_settings"("school_id", "key");

-- CreateIndex
CREATE INDEX "idx_grading_systems_school" ON "grading_systems"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_grade_points_grade" ON "grade_points"("grading_system_id", "grade");

-- ── Hand-written: bootstrap school row (MUST precede the users/roles FKs;
-- every M02/M03 row already references this fixed id — PROJECT_CONTEXT §16).
INSERT INTO "schools" ("id", "name", "code", "type", "updated_at")
VALUES ('00000000-0000-4000-8000-000000000001', 'HexSchool', 'HEX', 'HIGH_SCHOOL', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "fk_users_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_settings" ADD CONSTRAINT "fk_school_settings_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_systems" ADD CONSTRAINT "fk_grading_systems_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_points" ADD CONSTRAINT "fk_grade_points_system" FOREIGN KEY ("grading_system_id") REFERENCES "grading_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "fk_roles_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written section (features Prisma cannot express in schema) ──
-- Soft-delete-aware code uniqueness: a deleted school releases its code.
CREATE UNIQUE INDEX "uq_schools_code" ON "schools" ("code")
  WHERE "deleted_at" IS NULL;

-- EIIN is exactly 6 digits when provided (roadmap M04 §7).
ALTER TABLE "schools" ADD CONSTRAINT "chk_schools_eiin"
  CHECK ("eiin_number" IS NULL OR "eiin_number" ~ '^[0-9]{6}$');

-- Exactly one default grading system per school (roadmap M04 §6).
CREATE UNIQUE INDEX "uq_grading_systems_default" ON "grading_systems" ("school_id")
  WHERE "is_default" = true AND "deleted_at" IS NULL;

-- Grade band sanity: 0 <= min <= max <= 100 (non-overlap is service-enforced).
ALTER TABLE "grade_points" ADD CONSTRAINT "chk_grade_points_range"
  CHECK ("min_mark" >= 0 AND "min_mark" <= "max_mark" AND "max_mark" <= 100);
