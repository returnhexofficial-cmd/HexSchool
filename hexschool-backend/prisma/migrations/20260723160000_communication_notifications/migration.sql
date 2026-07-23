-- ── Module 17: Communication & Notifications ──────────────────────────

-- The settings registry stores its group in this PG enum. `communication`
-- joins it so the new `communication.*` keys validate. Safe to add inside
-- the migration transaction because no row in THIS migration uses it
-- (settings rows are written at runtime by the registry seeder).
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'communication';

-- CreateEnum
CREATE TYPE "notification_channel_enum" AS ENUM ('SMS', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "notification_language_enum" AS ENUM ('EN', 'BN');

-- CreateEnum
CREATE TYPE "notification_recipient_type_enum" AS ENUM ('USER', 'GUARDIAN', 'STUDENT', 'STAFF', 'RAW');

-- CreateEnum
CREATE TYPE "notification_status_enum" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "notice_audience_enum" AS ENUM ('ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'STAFF', 'CLASS', 'SECTION');

-- CreateEnum
CREATE TYPE "sms_credit_type_enum" AS ENUM ('PURCHASE', 'CONSUME', 'ADJUST');

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "channel" "notification_channel_enum" NOT NULL,
    "language" "notification_language_enum" NOT NULL DEFAULT 'EN',
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "channel" "notification_channel_enum" NOT NULL,
    "recipient_type" "notification_recipient_type_enum" NOT NULL,
    "recipient_id" UUID,
    "destination" VARCHAR(200),
    "template_code" VARCHAR(40),
    "payload" JSONB,
    "subject" VARCHAR(200),
    "body_rendered" TEXT NOT NULL,
    "status" "notification_status_enum" NOT NULL DEFAULT 'QUEUED',
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "provider_msg_id" VARCHAR(120),
    "error" VARCHAR(500),
    "segments" INTEGER,
    "cost" DECIMAL(8,4),
    "dedupe_key" VARCHAR(200),
    "batch_key" VARCHAR(80),
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "notice_audience_enum" NOT NULL DEFAULT 'ALL',
    "audience_ref" JSONB,
    "attachment_urls" JSONB,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "publish_at" TIMESTAMPTZ(6),
    "is_website_visible" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_credits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "type" "sms_credit_type_enum" NOT NULL,
    "qty" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "ref" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "sms_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notification_templates_code" ON "notification_templates"("school_id", "code");

-- CreateIndex
CREATE INDEX "idx_notifications_school_status" ON "notifications"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_notifications_inbox" ON "notifications"("school_id", "recipient_type", "recipient_id", "read_at");

-- CreateIndex
CREATE INDEX "idx_notifications_channel_created" ON "notifications"("school_id", "channel", "created_at");

-- CreateIndex
CREATE INDEX "idx_notices_published" ON "notices"("school_id", "is_published", "pinned");

-- CreateIndex
CREATE INDEX "idx_sms_credits_school_created" ON "sms_credits"("school_id", "created_at");

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "fk_notification_templates_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "fk_notices_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_credits" ADD CONSTRAINT "fk_sms_credits_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written constraints (Prisma cannot express these) ────────────

-- Template identity: one active body per (code, channel, language). The
-- partial index excludes soft-deleted rows so a re-created template does
-- not collide with a tombstone (the M06/M16 master-name pattern).
CREATE UNIQUE INDEX "uq_notification_templates_identity"
  ON "notification_templates" ("school_id", "code", "channel", "language")
  WHERE "deleted_at" IS NULL;

-- Dedupe guarantee: the same (destination, template) is not queued twice
-- inside the dedupe window (roadmap M17 §8 — a guardian with two absent
-- children gets one SMS). The service computes `dedupe_key` = destination
-- + template + a window bucket, so a bare partial unique enforces it; a
-- NULL key (dedupe not requested, e.g. OTP) is exempt because Postgres
-- treats NULLs as distinct.
CREATE UNIQUE INDEX "uq_notifications_dedupe"
  ON "notifications" ("school_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

-- Cost accounting is non-negative; a message with a cost has a part count.
ALTER TABLE "notifications"
  ADD CONSTRAINT "chk_notifications_cost"
  CHECK (
    ("cost" IS NULL OR "cost" >= 0)
    AND ("segments" IS NULL OR "segments" >= 0)
  );

-- A SENT/DELIVERED message must record WHEN it went out — the same
-- "evidence, not a bare flag" rule as the M16 payment success check. A
-- FAILED message must say why.
ALTER TABLE "notifications"
  ADD CONSTRAINT "chk_notifications_status_evidence"
  CHECK (
    ("status" NOT IN ('SENT', 'DELIVERED') OR "sent_at" IS NOT NULL)
    AND ("status" <> 'FAILED' OR "error" IS NOT NULL)
  );

-- (A published-notice-with-a-future-publish_at is refused in NoticeService,
-- not by a CHECK: a time-relative CHECK would use a non-immutable
-- function, which Postgres cannot index-check meaningfully.)

-- The running balance never goes negative — a send that would overdraw is
-- refused at the service, and this is the backstop.
ALTER TABLE "sms_credits"
  ADD CONSTRAINT "chk_sms_credits_balance"
  CHECK ("balance_after" >= 0);
