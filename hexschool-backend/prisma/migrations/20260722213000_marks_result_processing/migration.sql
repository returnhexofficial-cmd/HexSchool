-- CreateEnum
CREATE TYPE "mark_status_enum" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'LOCKED');

-- CreateEnum
CREATE TYPE "result_status_enum" AS ENUM ('PASSED', 'FAILED', 'INCOMPLETE', 'WITHHELD');

-- CreateEnum
CREATE TYPE "result_run_status_enum" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "marks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "cq" DECIMAL(6,2),
    "mcq" DECIMAL(6,2),
    "practical" DECIMAL(6,2),
    "ca" DECIMAL(6,2),
    "total" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "is_absent" BOOLEAN NOT NULL DEFAULT false,
    "grace_applied" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "grade" VARCHAR(5),
    "grade_point" DECIMAL(3,2),
    "status" "mark_status_enum" NOT NULL DEFAULT 'DRAFT',
    "entered_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "remarks" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mark_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "mark_id" UUID NOT NULL,
    "old_values" JSONB NOT NULL,
    "new_values" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "corrected_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mark_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "total_marks" DECIMAL(8,2) NOT NULL,
    "obtained_marks" DECIMAL(8,2) NOT NULL,
    "gpa" DECIMAL(4,2) NOT NULL,
    "gpa_without_optional" DECIMAL(4,2) NOT NULL,
    "grade" VARCHAR(5) NOT NULL,
    "subjects_count" INTEGER NOT NULL DEFAULT 0,
    "failed_subjects" INTEGER NOT NULL DEFAULT 0,
    "status" "result_status_enum" NOT NULL,
    "merit_position_section" INTEGER,
    "merit_position_class" INTEGER,
    "grading_snapshot" JSONB NOT NULL,
    "withheld_reason" VARCHAR(500),
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_publications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "channels" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "result_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "status" "result_run_status_enum" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB,
    "error" TEXT,
    "override" BOOLEAN NOT NULL DEFAULT false,
    "scope_enrollment_id" UUID,
    "triggered_by" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combined_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "components" JSONB NOT NULL,
    "weights" JSONB NOT NULL,
    "total_marks" DECIMAL(8,2) NOT NULL,
    "obtained_marks" DECIMAL(8,2) NOT NULL,
    "gpa" DECIMAL(4,2) NOT NULL,
    "grade" VARCHAR(5) NOT NULL,
    "status" "result_status_enum" NOT NULL,
    "merit_position_section" INTEGER,
    "merit_position_class" INTEGER,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "combined_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_marks_paper_candidate" ON "marks"("exam_subject_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "idx_marks_exam_status" ON "marks"("exam_id", "status");

-- CreateIndex
CREATE INDEX "idx_marks_enrollment" ON "marks"("enrollment_id");

-- CreateIndex
CREATE INDEX "idx_mark_corrections_mark" ON "mark_corrections"("mark_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_results_exam_candidate" ON "results"("exam_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "idx_results_exam_status" ON "results"("exam_id", "status");

-- CreateIndex
CREATE INDEX "idx_results_enrollment" ON "results"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_result_publications_version" ON "result_publications"("exam_id", "version");

-- CreateIndex
CREATE INDEX "idx_result_publications_exam_active" ON "result_publications"("exam_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_result_runs_exam" ON "result_runs"("exam_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_combined_results_candidate" ON "combined_results"("session_id", "name", "enrollment_id");

-- CreateIndex
CREATE INDEX "idx_combined_results_batch" ON "combined_results"("session_id", "name");

-- CreateIndex
CREATE INDEX "idx_combined_results_enrollment" ON "combined_results"("enrollment_id");

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "fk_marks_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "fk_marks_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "fk_marks_exam_subject" FOREIGN KEY ("exam_subject_id") REFERENCES "exam_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "fk_marks_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_corrections" ADD CONSTRAINT "fk_mark_corrections_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_corrections" ADD CONSTRAINT "fk_mark_corrections_mark" FOREIGN KEY ("mark_id") REFERENCES "marks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "fk_results_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "fk_results_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "fk_results_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_publications" ADD CONSTRAINT "fk_result_publications_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_publications" ADD CONSTRAINT "fk_result_publications_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_runs" ADD CONSTRAINT "fk_result_runs_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_runs" ADD CONSTRAINT "fk_result_runs_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combined_results" ADD CONSTRAINT "fk_combined_results_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combined_results" ADD CONSTRAINT "fk_combined_results_session" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combined_results" ADD CONSTRAINT "fk_combined_results_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written constraints (Prisma cannot express these) ────────────
--
-- The last line of defence if a future caller ever skips the service.
-- Everything expressible from columns ON THE ROW is a CHECK; anything
-- needing a join (a mark against its paper's full_marks, a weight set
-- summing to 100 across rows) is service-enforced and named as such.

-- Marks are non-negative with at most 2 decimals. The upper bound is
-- `exam_subjects.full_marks`, one join away, so it lives in the engine
-- (mark-entry.engine.ts) and the DTO instead.
ALTER TABLE "marks"
  ADD CONSTRAINT "chk_marks_non_negative"
  CHECK (
    "total" >= 0 AND "grace_applied" >= 0
    AND ("cq" IS NULL OR "cq" >= 0)
    AND ("mcq" IS NULL OR "mcq" >= 0)
    AND ("practical" IS NULL OR "practical" >= 0)
    AND ("ca" IS NULL OR "ca" >= 0)
  );

-- An absent candidate has no component marks and scores nothing
-- (roadmap M15 §6). Enforcing it here means no import path, however
-- clever, can produce an "absent with 45 marks" row.
ALTER TABLE "marks"
  ADD CONSTRAINT "chk_marks_absent_empty"
  CHECK (
    "is_absent" = false
    OR ("cq" IS NULL AND "mcq" IS NULL AND "practical" IS NULL AND "ca" IS NULL
        AND "total" = 0 AND "grace_applied" = 0)
  );

-- Grade and grade point are written together by a processing run, or
-- not at all — a grade with no point breaks every GPA average.
ALTER TABLE "marks"
  ADD CONSTRAINT "chk_marks_grade_pair"
  CHECK (
    ("grade" IS NULL AND "grade_point" IS NULL)
    OR ("grade" IS NOT NULL AND "grade_point" IS NOT NULL)
  );

-- GPA bounds. 0.00–5.00 is the NCTB scale; a school on a different
-- scale changes its grading system, not this ceiling, because the
-- grade-point column itself is DECIMAL(3,2).
ALTER TABLE "results"
  ADD CONSTRAINT "chk_results_gpa_range"
  CHECK (
    "gpa" >= 0 AND "gpa" <= 5
    AND "gpa_without_optional" >= 0 AND "gpa_without_optional" <= 5
  );

-- Obtained marks cannot exceed the total the student sat for, and
-- neither can be negative.
ALTER TABLE "results"
  ADD CONSTRAINT "chk_results_marks"
  CHECK (
    "total_marks" >= 0
    AND "obtained_marks" >= 0
    AND "obtained_marks" <= "total_marks"
    AND "failed_subjects" >= 0
    AND "subjects_count" >= 0
    AND "failed_subjects" <= "subjects_count"
  );

-- Merit positions are 1-based when present.
ALTER TABLE "results"
  ADD CONSTRAINT "chk_results_merit_positive"
  CHECK (
    ("merit_position_section" IS NULL OR "merit_position_section" > 0)
    AND ("merit_position_class" IS NULL OR "merit_position_class" > 0)
  );

-- A withheld result must say why (roadmap M15 §6 — it is an
-- administrative act, not a computation).
ALTER TABLE "results"
  ADD CONSTRAINT "chk_results_withheld_reason"
  CHECK ("status" <> 'WITHHELD' OR "withheld_reason" IS NOT NULL);

-- Publication versions start at 1, and a revoked publication records
-- both who revoked it and when.
ALTER TABLE "result_publications"
  ADD CONSTRAINT "chk_result_publications_version"
  CHECK ("version" > 0);

ALTER TABLE "result_publications"
  ADD CONSTRAINT "chk_result_publications_revocation"
  CHECK (
    ("revoked_at" IS NULL AND "revoked_by" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
  );

-- Only ONE publication of an exam may be active at a time — the portal
-- and the public search read "the active version", which has to be
-- singular. A partial unique index is the only way to say that.
CREATE UNIQUE INDEX "uq_result_publications_one_active"
  ON "result_publications" ("exam_id")
  WHERE "is_active" = true;

-- Progress can never claim more candidates than the run has.
ALTER TABLE "result_runs"
  ADD CONSTRAINT "chk_result_runs_progress"
  CHECK ("total" >= 0 AND "processed" >= 0 AND "processed" <= "total");

ALTER TABLE "combined_results"
  ADD CONSTRAINT "chk_combined_results_values"
  CHECK (
    "gpa" >= 0 AND "gpa" <= 5
    AND "total_marks" >= 0
    AND "obtained_marks" >= 0
    AND "obtained_marks" <= "total_marks"
  );
