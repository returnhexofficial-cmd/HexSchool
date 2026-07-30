-- ── Module 22: Assignments & Homework ────────────────────────────────

-- CreateEnum
CREATE TYPE "assignment_type_enum" AS ENUM ('ASSIGNMENT', 'HOMEWORK');

-- CreateEnum
CREATE TYPE "assignment_status_enum" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "submission_status_enum" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'EVALUATED', 'RETURNED');

-- CreateEnum
CREATE TYPE "learning_material_type_enum" AS ENUM ('NOTE', 'SLIDE', 'VIDEO_URL', 'LINK', 'OTHER');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `assignment`
-- joins it so the new `assignment.*` keys validate. Safe inside the
-- migration transaction because nothing written HERE uses the new value
-- (PG only forbids *using* it in the transaction that adds it) — the
-- M20/M21 `settings_group_enum` precedent.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'assignment';

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "type" "assignment_type_enum" NOT NULL DEFAULT 'ASSIGNMENT',
    "title" VARCHAR(200) NOT NULL,
    "instructions" TEXT,
    "attachment_urls" JSONB NOT NULL DEFAULT '[]',
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "full_marks" DECIMAL(6,2),
    "allow_late" BOOLEAN NOT NULL DEFAULT false,
    "status" "assignment_status_enum" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "due_reminder_sent_at" TIMESTAMPTZ(6),
    "no_submission_alert_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "text_answer" TEXT,
    "attachment_urls" JSONB NOT NULL DEFAULT '[]',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "marks" DECIMAL(6,2),
    "feedback" TEXT,
    "evaluated_by" UUID,
    "evaluated_at" TIMESTAMPTZ(6),
    "status" "submission_status_enum" NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "section_id" UUID,
    "subject_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "type" "learning_material_type_enum" NOT NULL DEFAULT 'NOTE',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "file_urls" JSONB NOT NULL DEFAULT '[]',
    "link_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "learning_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_assignments_scope" ON "assignments"("school_id", "session_id", "section_id");

-- CreateIndex
CREATE INDEX "idx_assignments_teacher" ON "assignments"("school_id", "teacher_id", "status");

-- CreateIndex
CREATE INDEX "idx_assignments_due" ON "assignments"("school_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_enrollment" ON "assignment_submissions"("school_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_status" ON "assignment_submissions"("assignment_id", "status");

-- CreateIndex
-- One submission per candidate per assignment. A PLAIN unique, not a
-- partial one, because `assignment_submissions` has no `deleted_at`: a
-- resubmission replaces the row in place so the id the evaluation hangs
-- off stays stable (the M15 `marks` rule).
CREATE UNIQUE INDEX "uq_assignment_submissions_identity" ON "assignment_submissions"("assignment_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "idx_learning_materials_scope" ON "learning_materials"("school_id", "session_id", "class_id");

-- CreateIndex
CREATE INDEX "idx_learning_materials_subject" ON "learning_materials"("school_id", "subject_id");

-- CreateIndex
CREATE INDEX "idx_learning_materials_teacher" ON "learning_materials"("school_id", "teacher_id");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "fk_assignments_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "fk_assignments_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "fk_assignments_section" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "fk_assignments_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "fk_assignments_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "fk_assignment_submissions_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE: a deleted assignment takes its submissions with it, the same
-- way a deleted paper takes its marks (M15). The delete guard in the
-- service is what stops that happening once work has been handed in.
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "fk_assignment_submissions_assignment" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "fk_assignment_submissions_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_materials" ADD CONSTRAINT "fk_learning_materials_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_materials" ADD CONSTRAINT "fk_learning_materials_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_materials" ADD CONSTRAINT "fk_learning_materials_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_materials" ADD CONSTRAINT "fk_learning_materials_section" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_materials" ADD CONSTRAINT "fk_learning_materials_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_materials" ADD CONSTRAINT "fk_learning_materials_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Row-level invariants ──────────────────────────────────────────────

-- Work cannot be due before it is set (roadmap §7), a graded assignment
-- is graded out of something positive, and a title is not whitespace.
ALTER TABLE "assignments"
  ADD CONSTRAINT "chk_assignments_window"
  CHECK (
    "due_at" > "assigned_at"
    AND ("full_marks" IS NULL OR "full_marks" > 0)
    AND length(btrim("title")) > 0
  );

-- The evidence rule the whole codebase uses (M16 payments, M17
-- notifications, M20 vouchers, M21 payslips): a state that claims
-- something happened records when. A CLOSED assignment must also carry
-- `published_at`, because closing something never published is not a
-- lifecycle this module has — a draft is deleted, not closed.
ALTER TABLE "assignments"
  ADD CONSTRAINT "chk_assignments_status_evidence"
  CHECK (
    ("status" = 'DRAFT' OR "published_at" IS NOT NULL)
    AND ("status" <> 'CLOSED' OR "closed_at" IS NOT NULL)
  );

-- An EMPTY submission is not a submission. Without this a student could
-- "submit" nothing, land on the teacher's grid as handed-in, and the
-- submission percentage — the one number this module exists to report —
-- would count them. Text or a file; the service enforces the same rule
-- with a readable message, this is what holds if it ever forgets.
ALTER TABLE "assignment_submissions"
  ADD CONSTRAINT "chk_assignment_submissions_content"
  CHECK (
    ("text_answer" IS NOT NULL AND length(btrim("text_answer")) > 0)
    OR jsonb_array_length("attachment_urls") > 0
  );

-- Marks are non-negative; that they also fit inside the assignment's
-- `full_marks` is one join away and lives in `evaluation.engine.ts` (the
-- M15 mark-entry precedent — a CHECK cannot see the parent row).
-- An EVALUATED or RETURNED row records who decided and when, and a
-- RETURNED one carries the feedback: handing work back without saying
-- why is not a revision request, it is a rejection with no appeal.
ALTER TABLE "assignment_submissions"
  ADD CONSTRAINT "chk_assignment_submissions_evaluation"
  CHECK (
    "attempt" >= 1
    AND ("marks" IS NULL OR "marks" >= 0)
    AND (
      "status" NOT IN ('EVALUATED', 'RETURNED')
      OR ("evaluated_at" IS NOT NULL AND "evaluated_by" IS NOT NULL)
    )
    AND (
      "status" <> 'RETURNED'
      OR ("feedback" IS NOT NULL AND length(btrim("feedback")) > 0)
    )
  );

-- A material has to BE something: a VIDEO_URL/LINK is its URL, anything
-- else is at least one file (or a link, for a note that is really a
-- pointer). A row with neither is an empty shelf entry a student clicks
-- and gets nothing from.
ALTER TABLE "learning_materials"
  ADD CONSTRAINT "chk_learning_materials_payload"
  CHECK (
    length(btrim("title")) > 0
    AND (
      CASE
        WHEN "type" IN ('VIDEO_URL', 'LINK') THEN "link_url" IS NOT NULL
        ELSE jsonb_array_length("file_urls") > 0 OR "link_url" IS NOT NULL
      END
    )
  );

-- An external link is https, always. The host allow-list
-- (`assignment.material_link_hosts`) is a setting and lives in
-- `material-link.util.ts`; the scheme is not negotiable and belongs here,
-- because a `javascript:` URL stored in this column would be rendered as
-- an anchor in a student's browser (the M19 sanitizer's reasoning,
-- applied to the one column that is a URL by construction).
ALTER TABLE "learning_materials"
  ADD CONSTRAINT "chk_learning_materials_link_scheme"
  CHECK ("link_url" IS NULL OR "link_url" LIKE 'https://%');
