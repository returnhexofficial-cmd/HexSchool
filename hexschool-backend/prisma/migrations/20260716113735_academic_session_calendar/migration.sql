-- CreateEnum
CREATE TYPE "session_status_enum" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "holiday_type_enum" AS ENUM ('GOVERNMENT', 'RELIGIOUS', 'SCHOOL', 'WEEKLY');

-- CreateEnum
CREATE TYPE "holiday_applies_to_enum" AS ENUM ('ALL', 'STUDENTS', 'STAFF');

-- CreateEnum
CREATE TYPE "calendar_event_type_enum" AS ENUM ('EXAM', 'EVENT', 'MEETING', 'SPORTS', 'CULTURAL', 'OTHER');

-- CreateTable
CREATE TABLE "academic_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "session_status_enum" NOT NULL DEFAULT 'UPCOMING',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "academic_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "type" "holiday_type_enum" NOT NULL DEFAULT 'SCHOOL',
    "applies_to" "holiday_applies_to_enum" NOT NULL DEFAULT 'ALL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "type" "calendar_event_type_enum" NOT NULL DEFAULT 'EVENT',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_academic_sessions_school" ON "academic_sessions"("school_id");

-- CreateIndex
CREATE INDEX "idx_holidays_range" ON "holidays"("school_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "idx_holidays_session" ON "holidays"("session_id");

-- CreateIndex
CREATE INDEX "idx_calendar_events_range" ON "calendar_events"("school_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "idx_calendar_events_session" ON "calendar_events"("session_id");

-- AddForeignKey
ALTER TABLE "academic_sessions" ADD CONSTRAINT "fk_academic_sessions_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "fk_holidays_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "fk_calendar_events_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written section (features Prisma cannot express in schema) ──
-- Soft-delete-aware name uniqueness: a deleted session releases its name.
CREATE UNIQUE INDEX "uq_academic_sessions_name" ON "academic_sessions" ("school_id", "name")
  WHERE "deleted_at" IS NULL;

-- Exactly one current session per school (roadmap M05 §6).
CREATE UNIQUE INDEX "uq_academic_sessions_current" ON "academic_sessions" ("school_id")
  WHERE "is_current" = true AND "deleted_at" IS NULL;

-- Sane ranges (roadmap M05 §3/§7): session strictly increasing, holiday/event end >= start.
ALTER TABLE "academic_sessions" ADD CONSTRAINT "chk_academic_sessions_dates"
  CHECK ("start_date" < "end_date");
ALTER TABLE "holidays" ADD CONSTRAINT "chk_holidays_dates"
  CHECK ("start_date" <= "end_date");
ALTER TABLE "calendar_events" ADD CONSTRAINT "chk_calendar_events_dates"
  CHECK ("start_date" <= "end_date");
