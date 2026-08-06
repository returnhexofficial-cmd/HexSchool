-- ── Module 27: Document Management & Certificates ────────────────────

-- CreateEnum
CREATE TYPE "certificate_type_enum" AS ENUM ('TRANSFER', 'CHARACTER', 'TESTIMONIAL', 'PRIZE', 'PARTICIPATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "certificate_status_enum" AS ENUM ('DRAFT', 'ISSUED', 'REVOKED');

-- CreateEnum
CREATE TYPE "certificate_issue_kind_enum" AS ENUM ('ORIGINAL', 'DUPLICATE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "archive_link_type_enum" AS ENUM ('STUDENT', 'TEACHER', 'STAFF', 'CERTIFICATE');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `documents`
-- joins it so the new `documents.*` keys validate. Safe inside the
-- migration transaction because nothing written HERE uses the new value
-- (PG only forbids *using* it in the transaction that adds it) — the
-- M20/M21/M22/M23/M24/M25/M26 `settings_group_enum` precedent.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'documents';

-- CreateTable
CREATE TABLE "certificate_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "type" "certificate_type_enum" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "body_html" TEXT NOT NULL,
    "background_url" VARCHAR(500),
    "signatories" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "enrollment_id" UUID,
    "session_id" UUID,
    "template_id" UUID,
    "type" "certificate_type_enum" NOT NULL,
    "certificate_no" VARCHAR(60),
    "verify_code" VARCHAR(16),
    "status" "certificate_status_enum" NOT NULL DEFAULT 'DRAFT',
    "issue_kind" "certificate_issue_kind_enum" NOT NULL DEFAULT 'ORIGINAL',
    "original_certificate_id" UUID,
    "data_snapshot" JSONB NOT NULL DEFAULT '{}',
    "body_html" TEXT,
    "file_url" VARCHAR(500),
    "is_legacy" BOOLEAN NOT NULL DEFAULT false,
    "clearance_snapshot" JSONB,
    "clearance_override_by" UUID,
    "clearance_override_note" TEXT,
    "issued_by" UUID,
    "issued_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_folders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "parent_id" UUID,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "archive_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "folder_id" UUID NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "file_url" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linked_type" "archive_link_type_enum",
    "linked_id" UUID,
    "notes" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "archive_files_pkey" PRIMARY KEY ("id")
);

-- ── Plain indexes (mirrored in schema.prisma — the M24 rule: an index
--    Prisma CAN express must also be declared there, or `migrate diff`
--    reports it as drift) ───────────────────────────────────────────────

CREATE INDEX "idx_certificate_templates_type" ON "certificate_templates"("school_id", "type", "is_active");
CREATE INDEX "idx_certificates_type" ON "certificates"("school_id", "type", "status");
CREATE INDEX "idx_certificates_student" ON "certificates"("student_id");
CREATE INDEX "idx_certificates_issued_at" ON "certificates"("school_id", "issued_at");
CREATE INDEX "idx_archive_folders_parent" ON "archive_folders"("school_id", "parent_id");
CREATE INDEX "idx_archive_files_folder" ON "archive_files"("folder_id");
CREATE INDEX "idx_archive_files_linked" ON "archive_files"("school_id", "linked_type", "linked_id");

-- ── Foreign keys ────────────────────────────────────────────────────

ALTER TABLE "certificate_templates" ADD CONSTRAINT "fk_certificate_templates_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "certificates" ADD CONSTRAINT "fk_certificates_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificates" ADD CONSTRAINT "fk_certificates_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificates" ADD CONSTRAINT "fk_certificates_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificates" ADD CONSTRAINT "fk_certificates_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificates" ADD CONSTRAINT "fk_certificates_template" FOREIGN KEY ("template_id") REFERENCES "certificate_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Roadmap §8's two re-issue cases, as a self-reference: a DUPLICATE
-- reprints the row it points at, a CORRECTION replaces it. RESTRICT
-- because deleting the original would orphan the chain the register reads.
ALTER TABLE "certificates" ADD CONSTRAINT "fk_certificates_original" FOREIGN KEY ("original_certificate_id") REFERENCES "certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "archive_folders" ADD CONSTRAINT "fk_archive_folders_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "archive_folders" ADD CONSTRAINT "fk_archive_folders_parent" FOREIGN KEY ("parent_id") REFERENCES "archive_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "archive_files" ADD CONSTRAINT "fk_archive_files_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "archive_files" ADD CONSTRAINT "fk_archive_files_folder" FOREIGN KEY ("folder_id") REFERENCES "archive_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written identity indexes ───────────────────────────────────
-- Prisma cannot express a partial or expression index, so every one of
-- these is written here and nowhere else (the M11/M12/M15/M16 rule).

-- Two live templates called "Transfer Certificate 2026" is a template
-- picker nobody can act on. Scoped by TYPE as well as name, because a
-- school legitimately runs "Standard" layouts of several types, and
-- scoped to live rows because a template name is a label the school
-- chooses and may re-file (the M25 registration-plate rule).
CREATE UNIQUE INDEX "uq_certificate_templates_name" ON "certificate_templates"("school_id", "type", lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

-- **A certificate number is NEVER reused** — the M07 employee-ID / M09
-- student-UID / M23 accession / M24 asset-tag rule, and the strongest
-- case of it in the codebase: this number is printed on a document that
-- has left the building and may be quoted back at the school by a
-- university, an employer or a court ten years from now. So the index
-- deliberately IGNORES `deleted_at`. It tolerates the NULL a DRAFT
-- carries, because Postgres treats NULLs as distinct and an unissued
-- draft has no number to protect.
CREATE UNIQUE INDEX "uq_certificates_no" ON "certificates"("school_id", "certificate_no")
  WHERE "certificate_no" IS NOT NULL;

-- The public handle, and the reason it needs a unique at all: verification
-- resolves a typed-in code to exactly one document. Also ignores
-- `deleted_at` — a code that has been printed inside a QR must never come
-- back pointing at a different certificate. Globally scoped rather than
-- per-school, because the public verify endpoint is reached without a
-- school context.
CREATE UNIQUE INDEX "uq_certificates_verify_code" ON "certificates"("verify_code")
  WHERE "verify_code" IS NOT NULL;

-- One live folder of a given name under one parent. The COALESCE maps a
-- NULL parent (a root folder) to the nil UUID inside the index, because
-- Postgres treats NULLs as distinct and two root folders both called
-- "Admissions" would otherwise be legal — the M06 `uq_sections_identity`
-- / M12 attendance-identity trick.
CREATE UNIQUE INDEX "uq_archive_folders_identity" ON "archive_folders"("school_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

-- Roadmap §4's "search by tag": a GIN index over the array, so a tag
-- filter is an index scan rather than a sequential unnest of the whole
-- cabinet.
CREATE INDEX "idx_archive_files_tags" ON "archive_files" USING GIN ("tags");

-- ── CHECK constraints ───────────────────────────────────────────────

-- A template with no name cannot be picked and a template with no body
-- renders a blank page over the school's stationery.
ALTER TABLE "certificate_templates"
  ADD CONSTRAINT "chk_certificate_templates_shape"
  CHECK (
    length(btrim("name")) > 0
    AND length(btrim("body_html")) > 0
    AND jsonb_typeof("signatories") = 'array'
  );

-- **The status carries its own evidence** (the M16/M17/M23/M26 rule).
--   * An ISSUED certificate has a number, a verify code, a snapshot to
--     print and a date — anything less is a document the register cannot
--     describe and the public page cannot resolve.
--   * A DRAFT has none of the first three: it has no public existence
--     (roadmap §6, "DRAFTs invisible publicly"), and letting one hold a
--     verify code would put an unissued certificate one URL away from
--     reading VALID.
--   * A REVOKED one keeps everything it had — the file stays, the register
--     entry stays (roadmap §4) — and additionally carries the reason and
--     the name of whoever decided.
ALTER TABLE "certificates"
  ADD CONSTRAINT "chk_certificates_status_evidence"
  CHECK (
    (
      "status" <> 'DRAFT'
      OR ("certificate_no" IS NULL AND "verify_code" IS NULL AND "issued_at" IS NULL)
    )
    AND (
      "status" = 'DRAFT'
      OR (
        "certificate_no" IS NOT NULL
        AND "verify_code" IS NOT NULL
        AND "issued_at" IS NOT NULL
        AND "data_snapshot" <> '{}'::jsonb
      )
    )
    AND (
      "status" <> 'REVOKED'
      OR ("revoked_at" IS NOT NULL AND length(btrim(coalesce("revoked_reason", ''))) > 0)
    )
  );

-- Roadmap §8's re-issue chain, pinned. An ORIGINAL points at nothing; a
-- DUPLICATE or a CORRECTION points at the certificate it came from and may
-- not point at itself. Without this, "reissue" is a free-text convention
-- and the register's chain quietly stops being a chain.
ALTER TABLE "certificates"
  ADD CONSTRAINT "chk_certificates_issue_kind"
  CHECK (
    ("issue_kind" = 'ORIGINAL') = ("original_certificate_id" IS NULL)
    AND ("original_certificate_id" IS NULL OR "original_certificate_id" <> "id")
  );

-- A legacy backfill is a certificate the school issued on paper before
-- this system existed: it has no template to render and is never a DRAFT,
-- because there is nothing left to decide about a document that is already
-- in somebody's file. A waiver, symmetrically, carries the name of whoever
-- granted it AND why (roadmap §6, "override with mandatory reason") — an
-- override with no reason is the audit trail failing at the one point it
-- exists for.
ALTER TABLE "certificates"
  ADD CONSTRAINT "chk_certificates_provenance"
  CHECK (
    ("is_legacy" = false OR ("template_id" IS NULL AND "status" <> 'DRAFT'))
    AND (
      "clearance_override_by" IS NULL
      OR length(btrim(coalesce("clearance_override_note", ''))) > 0
    )
  );

-- A folder with a blank name is a node the tree cannot render, and a
-- folder that is its own parent is a tree walk that never terminates. The
-- service refuses a longer cycle (A → B → A) with a readable message —
-- a CHECK cannot see another row — but the one-step case is free here.
ALTER TABLE "archive_folders"
  ADD CONSTRAINT "chk_archive_folders_shape"
  CHECK (
    length(btrim("name")) > 0
    AND ("parent_id" IS NULL OR "parent_id" <> "id")
  );

-- Both link columns are set or neither is. A file recorded against a
-- `linked_type` with no id is invisible to every "documents of this
-- student" query while still claiming to belong to one — which is worse
-- than an unfiled document, because nobody goes looking for it.
-- An empty title or a zero-byte file is a row the explorer prints as a
-- blank line.
ALTER TABLE "archive_files"
  ADD CONSTRAINT "chk_archive_files_link"
  CHECK (
    ("linked_type" IS NULL) = ("linked_id" IS NULL)
    AND length(btrim("title")) > 0
    AND length(btrim("file_url")) > 0
    AND "size_bytes" > 0
  );
