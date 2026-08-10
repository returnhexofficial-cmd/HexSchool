-- ── Module 28: Complaint, Visitor & Alumni Management ────────────────

-- CreateEnum
CREATE TYPE "ticket_type_enum" AS ENUM ('COMPLAINT', 'SUGGESTION', 'FEEDBACK');

-- CreateEnum
CREATE TYPE "ticket_category_enum" AS ENUM ('ACADEMIC', 'FEES', 'TRANSPORT', 'HOSTEL', 'TEACHER', 'FACILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ticket_raiser_type_enum" AS ENUM ('GUARDIAN', 'STUDENT', 'STAFF', 'ANONYMOUS', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ticket_priority_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ticket_status_enum" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "visitor_purpose_enum" AS ENUM ('MEETING', 'ADMISSION_QUERY', 'GUARDIAN_VISIT', 'VENDOR', 'OFFICIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "visitor_host_type_enum" AS ENUM ('TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "appointment_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "alumni_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "alumni_registration_status_enum" AS ENUM ('REGISTERED', 'ATTENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "donation_method_enum" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_BANKING', 'IN_KIND', 'OTHER');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `community`
-- joins it so the new `community.*` keys validate. Safe inside the
-- migration transaction because nothing written HERE uses the new value
-- (PG only forbids *using* it in the transaction that adds it) — the
-- M20/M21/M22/M23/M24/M25/M26/M27 `settings_group_enum` precedent.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'community';

-- AlterEnum
-- M20 designed `voucher_source_enum` append-only so a later module could
-- name its own auto-postings without a data migration. This is the sixth
-- module to take it up (M21 payroll, M23 library, M24 inventory, M25
-- transport, M26 hostel). Same transaction-safety note as above.
ALTER TYPE "voucher_source_enum" ADD VALUE IF NOT EXISTS 'DONATION';

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "ticket_no" VARCHAR(40) NOT NULL,
    "type" "ticket_type_enum" NOT NULL DEFAULT 'COMPLAINT',
    "category" "ticket_category_enum" NOT NULL DEFAULT 'OTHER',
    "subject" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "raised_by_type" "ticket_raiser_type_enum" NOT NULL,
    "raised_by_id" UUID,
    "contact" JSONB,
    "assigned_to" UUID,
    "priority" "ticket_priority_enum" NOT NULL DEFAULT 'MEDIUM',
    "status" "ticket_status_enum" NOT NULL DEFAULT 'OPEN',
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "reopened_at" TIMESTAMPTZ(6),
    "satisfaction_rating" INTEGER,
    "first_response_at" TIMESTAMPTZ(6),
    "escalated_at" TIMESTAMPTZ(6),
    "ip" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID,
    "author_name" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "visitor_name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(160),
    "purpose" "visitor_purpose_enum" NOT NULL DEFAULT 'MEETING',
    "host_type" "visitor_host_type_enum" NOT NULL,
    "host_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "appointment_status_enum" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decided_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "nid" VARCHAR(20),
    "address" VARCHAR(250),
    "purpose" "visitor_purpose_enum" NOT NULL DEFAULT 'MEETING',
    "host_type" "visitor_host_type_enum",
    "host_id" UUID,
    "whom_to_meet" VARCHAR(160),
    "card_no" VARCHAR(30),
    "photo_url" VARCHAR(500),
    "gate_pass_no" VARCHAR(40),
    "check_in" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "check_out" TIMESTAMPTZ(6),
    "valid_until" DATE,
    "auto_checked_out" BOOLEAN NOT NULL DEFAULT false,
    "appointment_id" UUID,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alumni" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "batch_year" INTEGER NOT NULL,
    "last_class" VARCHAR(80),
    "phone" VARCHAR(20),
    "email" VARCHAR(160),
    "address" VARCHAR(250),
    "profession" VARCHAR(160),
    "organization" VARCHAR(160),
    "photo_url" VARCHAR(500),
    "bio" TEXT,
    "is_public_profile" BOOLEAN NOT NULL DEFAULT false,
    "status" "alumni_status_enum" NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "alumni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alumni_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "event_date" DATE NOT NULL,
    "venue" VARCHAR(200),
    "description" TEXT,
    "fee" DECIMAL(12,2),
    "capacity" INTEGER,
    "registration_deadline" DATE,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "alumni_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alumni_event_registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "alumni_id" UUID NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "alumni_registration_status_enum" NOT NULL DEFAULT 'REGISTERED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "alumni_event_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "alumni_id" UUID,
    "donor_name" VARCHAR(160) NOT NULL,
    "donor_phone" VARCHAR(20),
    "donor_email" VARCHAR(160),
    "amount" DECIMAL(12,2) NOT NULL,
    "purpose" VARCHAR(200),
    "method" "donation_method_enum" NOT NULL DEFAULT 'CASH',
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "receipt_no" VARCHAR(40) NOT NULL,
    "voucher_id" UUID,
    "remarks" TEXT,
    "received_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- ── Plain indexes (mirrored in schema.prisma — the M24 rule: an index
--    Prisma CAN express must also be declared there, or `migrate diff`
--    reports it as drift) ───────────────────────────────────────────────

CREATE INDEX "idx_tickets_status" ON "tickets"("school_id", "status", "priority");
CREATE INDEX "idx_tickets_assignee" ON "tickets"("school_id", "assigned_to");
CREATE INDEX "idx_tickets_raiser" ON "tickets"("school_id", "raised_by_type", "raised_by_id");
CREATE INDEX "idx_tickets_created" ON "tickets"("school_id", "created_at");
CREATE INDEX "idx_ticket_comments_ticket" ON "ticket_comments"("ticket_id", "created_at");
CREATE INDEX "idx_appointments_scheduled" ON "appointments"("school_id", "scheduled_at");
CREATE INDEX "idx_appointments_host" ON "appointments"("school_id", "host_type", "host_id", "status");
CREATE INDEX "idx_visitors_check_in" ON "visitors"("school_id", "check_in");
CREATE INDEX "idx_visitors_host" ON "visitors"("school_id", "host_type", "host_id");
CREATE INDEX "idx_visitors_phone" ON "visitors"("school_id", "phone");
CREATE INDEX "idx_alumni_status" ON "alumni"("school_id", "status");
CREATE INDEX "idx_alumni_batch" ON "alumni"("school_id", "batch_year");
CREATE INDEX "idx_alumni_events_date" ON "alumni_events"("school_id", "event_date");
CREATE INDEX "idx_alumni_event_registrations_event" ON "alumni_event_registrations"("event_id");
CREATE INDEX "idx_alumni_event_registrations_alumni" ON "alumni_event_registrations"("alumni_id");
CREATE INDEX "idx_donations_received" ON "donations"("school_id", "received_at");
CREATE INDEX "idx_donations_alumni" ON "donations"("alumni_id");

-- ── Foreign keys ────────────────────────────────────────────────────

ALTER TABLE "tickets" ADD CONSTRAINT "fk_tickets_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_comments" ADD CONSTRAINT "fk_ticket_comments_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- CASCADE, unlike almost every other FK in this codebase. A ticket is
-- soft-deleted in practice (spam from the public form), so the cascade
-- rarely fires — but a thread has no meaning without the ticket it hangs
-- off, and an orphaned comment is a row nothing can ever render.
ALTER TABLE "ticket_comments" ADD CONSTRAINT "fk_ticket_comments_ticket" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "visitors" ADD CONSTRAINT "fk_visitors_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL rather than RESTRICT: a visit that happened is a fact of the
-- gate register, and it must survive the appointment record being tidied
-- away. The visitor row keeps the name, the time and the host regardless.
ALTER TABLE "visitors" ADD CONSTRAINT "fk_visitors_appointment" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "alumni" ADD CONSTRAINT "fk_alumni_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL for the same reason: an alumnus is a person, and their entry
-- in the directory does not stop being true because the school archived
-- the student record it was matched to.
ALTER TABLE "alumni" ADD CONSTRAINT "fk_alumni_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "alumni_events" ADD CONSTRAINT "fk_alumni_events_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "alumni_event_registrations" ADD CONSTRAINT "fk_alumni_event_registrations_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alumni_event_registrations" ADD CONSTRAINT "fk_alumni_event_registrations_event" FOREIGN KEY ("event_id") REFERENCES "alumni_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alumni_event_registrations" ADD CONSTRAINT "fk_alumni_event_registrations_alumni" FOREIGN KEY ("alumni_id") REFERENCES "alumni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "donations" ADD CONSTRAINT "fk_donations_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "donations" ADD CONSTRAINT "fk_donations_alumni" FOREIGN KEY ("alumni_id") REFERENCES "alumni"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Hand-written identity indexes ───────────────────────────────────
-- Prisma cannot express a partial or expression index, so every one of
-- these is written here and nowhere else (the M11/M12/M15/M16/M27 rule).

-- **A ticket number is never reused** — the M07 employee-ID / M09
-- student-UID / M23 accession / M24 asset-tag / M27 certificate rule.
-- The office told a parent "quote CMP-26-00041"; handing that reference to
-- a different complaint six months later makes every reply already sent
-- about it wrong. So this index deliberately IGNORES `deleted_at`.
CREATE UNIQUE INDEX "uq_tickets_no" ON "tickets"("school_id", "ticket_no");

-- Same rule for a gate pass, which is a card in somebody's hand while
-- they walk around a building full of children, and for a donation
-- receipt, which a donor may present to the revenue board. Both are
-- partial only because the column is nullable (a visitor recorded without
-- a printed pass is the ordinary case at a school that does not require
-- one).
CREATE UNIQUE INDEX "uq_visitors_gate_pass" ON "visitors"("school_id", "gate_pass_no")
  WHERE "gate_pass_no" IS NOT NULL;

CREATE UNIQUE INDEX "uq_donations_receipt" ON "donations"("school_id", "receipt_no");

-- **Roadmap §8's conflict queue, and it needs no queue table.** A second
-- person claiming a student record may register and sits PENDING — that
-- IS the queue, and it is exactly the review a human has to do. What this
-- index refuses is the *approval*: two APPROVED alumni rows can never
-- point at the same student, so the directory can never carry two people
-- claiming to be the same person. Live rows only, because a rejected
-- claim must not block the genuine one behind it.
CREATE UNIQUE INDEX "uq_alumni_student" ON "alumni"("student_id")
  WHERE "student_id" IS NOT NULL AND "status" = 'APPROVED' AND "deleted_at" IS NULL;

-- One live registration per alumnus per event. CANCELLED is excluded so a
-- withdrawal genuinely frees the seat and the same person may register
-- again — the M11 enrollment / M21 payroll-run rule that a cancelled row
-- releases what it held.
CREATE UNIQUE INDEX "uq_alumni_event_registrations_identity" ON "alumni_event_registrations"("event_id", "alumni_id")
  WHERE "status" <> 'CANCELLED' AND "deleted_at" IS NULL;

-- Two live events with the same title on the same day is a registration
-- list nobody can pick between. Live rows only — an event title is a
-- label the committee chooses and may reuse next year (the M25
-- registration-plate rule).
CREATE UNIQUE INDEX "uq_alumni_events_identity" ON "alumni_events"("school_id", "event_date", lower(btrim("title")))
  WHERE "deleted_at" IS NULL;

-- ── CHECK constraints ───────────────────────────────────────────────

-- **The one constraint this module exists for.** An ANONYMOUS ticket
-- carries no raiser id, no contact block and no IP, because an
-- "anonymous" complaint that stores the sender's phone number is not
-- anonymous — it is a trap, and the person who trusted the box finds out
-- too late. Enforcing it in the service alone would leave one forgotten
-- assignment between a promise and its breach, so it is enforced here.
--
-- The mirror is just as important: a PUBLIC ticket has no account behind
-- it, so it MUST carry a contact block, or the school has a complaint it
-- can never reply to and a complainant who thinks they were ignored.
-- GUARDIAN / STUDENT / STAFF each name the row they came from.
ALTER TABLE "tickets"
  ADD CONSTRAINT "chk_tickets_raiser"
  CHECK (
    (
      "raised_by_type" <> 'ANONYMOUS'
      OR ("raised_by_id" IS NULL AND "contact" IS NULL AND "ip" IS NULL)
    )
    AND ("raised_by_type" <> 'PUBLIC' OR "contact" IS NOT NULL)
    AND (
      "raised_by_type" IN ('ANONYMOUS', 'PUBLIC')
      OR "raised_by_id" IS NOT NULL
    )
  );

-- **The status carries its own evidence** (the M16/M17/M20/M23/M25/M26/
-- M27 rule).
--   * RESOLVED and CLOSED both mean somebody decided something, so both
--     carry a resolution and the time it was written. A ticket marked
--     resolved with no resolution on it is the exact row a parent rings
--     up about and nobody can answer.
--   * CLOSED additionally stamps `closed_at`, which is what the seven-day
--     reopen window (roadmap §6) is measured from — without it the window
--     has no origin and "within 7 days" cannot be evaluated at all.
--   * REOPENED stamps `reopened_at`, and clears the resolution — the
--     ticket is live again and no longer has one. What was said stays in
--     the thread, which is where a conversation belongs.
--   * A satisfaction rating is 1–5 and may only exist on a ticket that
--     reached a decision — rating an OPEN complaint rates nothing.
--     **REOPENED counts as having reached one**, and that is the whole
--     meaning of the state: there WAS a resolution and it did not hold.
--     Excluding it would force a reopen to either fail or destroy the
--     rating the family gave the first attempt — and a school could then
--     improve its average satisfaction by reopening the tickets people
--     scored badly, which is exactly backwards.
ALTER TABLE "tickets"
  ADD CONSTRAINT "chk_tickets_status_evidence"
  CHECK (
    (
      "status" NOT IN ('RESOLVED', 'CLOSED')
      OR ("resolved_at" IS NOT NULL AND length(btrim(coalesce("resolution", ''))) > 0)
    )
    AND ("status" <> 'CLOSED' OR "closed_at" IS NOT NULL)
    AND ("status" <> 'REOPENED' OR "reopened_at" IS NOT NULL)
    AND (
      "satisfaction_rating" IS NULL
      OR (
        "satisfaction_rating" BETWEEN 1 AND 5
        AND "status" IN ('RESOLVED', 'CLOSED', 'REOPENED')
      )
    )
  );

-- Roadmap §7: subject ≤ 200 (the VARCHAR does that) and non-empty. A
-- complaint with no words in it is a row the inbox prints as a blank line
-- and nobody can action.
ALTER TABLE "tickets"
  ADD CONSTRAINT "chk_tickets_shape"
  CHECK (
    length(btrim("subject")) > 0
    AND length(btrim("description")) > 0
    AND jsonb_typeof("attachments") = 'array'
  );

ALTER TABLE "ticket_comments"
  ADD CONSTRAINT "chk_ticket_comments_shape"
  CHECK (
    length(btrim("body")) > 0
    AND length(btrim("author_name")) > 0
  );

-- A visitor who left before they arrived is a register entry that makes
-- the "how long was this person in the building" column negative. The
-- multi-day pass (roadmap §8) may not end before the day it started.
--
-- `auto_checked_out` may only be true on a row that HAS a check-out: the
-- flag means "the day-end sweep wrote this time, not a human", and a flag
-- with no time behind it says nothing at all.
ALTER TABLE "visitors"
  ADD CONSTRAINT "chk_visitors_window"
  CHECK (
    ("check_out" IS NULL OR "check_out" >= "check_in")
    AND ("valid_until" IS NULL OR "valid_until" >= "check_in"::date)
    AND ("auto_checked_out" = false OR "check_out" IS NOT NULL)
  );

-- Both host columns are set or neither is — the M24 `chk_asset_units_custodian`
-- shape. A `host_type` with no id names a table and nobody in it, which is
-- worse than the free-text `whom_to_meet` the row can always fall back on.
-- A visitor with no name and no phone is a gate register that cannot do
-- the one thing a gate register is for.
ALTER TABLE "visitors"
  ADD CONSTRAINT "chk_visitors_host"
  CHECK (
    ("host_type" IS NULL) = ("host_id" IS NULL)
    AND length(btrim("name")) > 0
    AND length(btrim("phone")) > 0
  );

-- An appointment that was decided says who decided and when; a REJECTED
-- one additionally says why, because "no" is the answer a visitor will
-- ring back about (the M16/M17 evidence rule, and the M26 meal-off one).
ALTER TABLE "appointments"
  ADD CONSTRAINT "chk_appointments_decision"
  CHECK (
    (
      "status" NOT IN ('APPROVED', 'REJECTED')
      OR "decided_at" IS NOT NULL
    )
    AND (
      "status" <> 'REJECTED'
      OR length(btrim(coalesce("decided_note", ''))) > 0
    )
    AND length(btrim("visitor_name")) > 0
    AND length(btrim("phone")) > 0
  );

-- Roadmap §7: `batch_year` 1950–current. The DB takes the wide bound and
-- the DTO takes the exact one, deliberately: a CHECK over `CURRENT_DATE`
-- is not IMMUTABLE, so a row that is legal today would fail a restore
-- next January and the school's backup would refuse to load. The upper
-- bound here is a sanity floor against a typo'd 20261, not a business
-- rule.
--
-- An alumnus with neither a phone nor an email is a directory entry
-- nobody can act on — the M19 contact-message rule, and the reason the
-- directory is worth keeping at all.
ALTER TABLE "alumni"
  ADD CONSTRAINT "chk_alumni_shape"
  CHECK (
    length(btrim("name")) > 0
    AND "batch_year" BETWEEN 1950 AND 2200
    AND (
      length(btrim(coalesce("phone", ''))) > 0
      OR length(btrim(coalesce("email", ''))) > 0
    )
    AND (
      "status" <> 'REJECTED'
      OR length(btrim(coalesce("rejected_reason", ''))) > 0
    )
    AND ("status" <> 'APPROVED' OR "approved_at" IS NOT NULL)
  );

-- A free event is `fee IS NULL`; a priced one is a real number ≥ 0. A
-- registration deadline after the event is a form that accepts entries
-- for something that has already happened.
ALTER TABLE "alumni_events"
  ADD CONSTRAINT "chk_alumni_events_shape"
  CHECK (
    length(btrim("title")) > 0
    AND ("fee" IS NULL OR "fee" >= 0)
    AND ("capacity" IS NULL OR "capacity" > 0)
    AND ("registration_deadline" IS NULL OR "registration_deadline" <= "event_date")
  );

ALTER TABLE "alumni_event_registrations"
  ADD CONSTRAINT "chk_alumni_event_registrations_shape"
  CHECK ("guests" >= 0 AND "amount_paid" >= 0);

-- Roadmap §7: donation amount > 0. Zero is not a donation, it is a row
-- somebody created by accident, and it would print a receipt saying the
-- school received nothing.
--
-- **A receipt is immutable, so the only correction is a cancellation** —
-- and it carries a reason and a date, or the register cannot say why a
-- number it once reported is no longer there (the M20 reversal / M24
-- purchase-cancellation rule).
ALTER TABLE "donations"
  ADD CONSTRAINT "chk_donations_shape"
  CHECK (
    "amount" > 0
    AND length(btrim("donor_name")) > 0
    AND length(btrim("receipt_no")) > 0
    AND ("cancelled_at" IS NULL) = ("cancelled_reason" IS NULL)
    AND (
      "cancelled_reason" IS NULL
      OR length(btrim("cancelled_reason")) > 0
    )
  );
