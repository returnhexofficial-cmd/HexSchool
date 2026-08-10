-- ── Module 29: Reports & Analytics v2 ───────────────────────────────

-- CreateEnum
CREATE TYPE "report_output_enum" AS ENUM ('TABLE', 'CHART', 'PDF', 'XLSX');

-- CreateEnum
CREATE TYPE "report_format_enum" AS ENUM ('XLSX', 'CSV', 'PDF', 'JSON');

-- CreateEnum
CREATE TYPE "report_run_status_enum" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "report_schedule_status_enum" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `analytics`
-- joins it so the new `analytics.*` keys validate. Safe inside the
-- migration transaction because nothing written HERE uses the new value
-- (PG only forbids *using* it in the transaction that adds it) — the
-- M20…M28 `settings_group_enum` precedent, ninth use.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'analytics';

-- CreateTable
-- A system catalog, not a business table: no `school_id`, no soft delete,
-- an `is_orphaned` flag instead — the `permissions` arrangement verbatim,
-- because the code registry stays the source of truth and this is its
-- projection (see the schema comment on ReportDefinition).
CREATE TABLE "report_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "module" VARCHAR(60) NOT NULL,
    "description" TEXT,
    "params_schema" JSONB NOT NULL DEFAULT '[]',
    "permission" VARCHAR(100) NOT NULL,
    "sensitive_permission" VARCHAR(100),
    "output" "report_output_enum" NOT NULL DEFAULT 'TABLE',
    "formats" JSONB NOT NULL DEFAULT '[]',
    "endpoint" VARCHAR(200),
    "is_runnable" BOOLEAN NOT NULL DEFAULT false,
    "freshness" VARCHAR(40),
    "is_orphaned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "report_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "cron" VARCHAR(60) NOT NULL,
    "recipients" JSONB NOT NULL DEFAULT '{}',
    "format" "report_format_enum" NOT NULL DEFAULT 'XLSX',
    "status" "report_schedule_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "owner_id" UUID,
    "next_run_at" TIMESTAMPTZ(6),
    "last_run_at" TIMESTAMPTZ(6),
    "last_status" "report_run_status_enum",
    "last_error" TEXT,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "disabled_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "schedule_id" UUID,
    "report_code" VARCHAR(100) NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "format" "report_format_enum" NOT NULL DEFAULT 'XLSX',
    "requested_by" UUID,
    "status" "report_run_status_enum" NOT NULL DEFAULT 'QUEUED',
    "file_url" VARCHAR(1000),
    "file_key" VARCHAR(500),
    "file_bucket" VARCHAR(120),
    "file_size" INTEGER,
    "row_count" INTEGER,
    "duration_ms" INTEGER,
    "stripped_columns" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_analytics_daily" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    "unique_visitors" INTEGER NOT NULL DEFAULT 0,
    "top_pages" JSONB NOT NULL DEFAULT '[]',
    "top_referrers" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_analytics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_report_definitions_code" ON "report_definitions"("code");

-- CreateIndex
CREATE INDEX "idx_report_definitions_module" ON "report_definitions"("module");

-- CreateIndex
CREATE INDEX "idx_report_schedules_school" ON "report_schedules"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_report_schedules_due" ON "report_schedules"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "idx_report_schedules_owner" ON "report_schedules"("owner_id");

-- CreateIndex
CREATE INDEX "idx_report_runs_school" ON "report_runs"("school_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_report_runs_requester" ON "report_runs"("school_id", "requested_by", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_report_runs_schedule" ON "report_runs"("schedule_id");

-- CreateIndex
CREATE INDEX "idx_report_runs_retention" ON "report_runs"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_site_analytics_daily" ON "site_analytics_daily"("school_id", "date");

-- CreateIndex
CREATE INDEX "idx_site_analytics_daily_recent" ON "site_analytics_daily"("school_id", "date" DESC);

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "fk_report_schedules_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "fk_report_schedules_definition" FOREIGN KEY ("report_code") REFERENCES "report_definitions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "fk_report_runs_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "fk_report_runs_schedule" FOREIGN KEY ("schedule_id") REFERENCES "report_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "fk_report_runs_definition" FOREIGN KEY ("report_code") REFERENCES "report_definitions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_analytics_daily" ADD CONSTRAINT "fk_site_analytics_daily_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CHECK constraints ────────────────────────────────────────────────

-- A definition with no permission code is a report anybody can run, which
-- is not a thing this system has (roadmap §6: access is enforced at the
-- engine, and the engine reads this column).
ALTER TABLE "report_definitions"
  ADD CONSTRAINT "chk_report_definitions_shape"
  CHECK (
    length(btrim("code")) > 0
    AND length(btrim("name")) > 0
    AND length(btrim("permission")) > 0
    AND jsonb_typeof("params_schema") = 'array'
    AND jsonb_typeof("formats") = 'array'
  );

-- Roadmap §7's cron whitelist is enforced in the engine (it needs to
-- reject a *sub-hourly* expression, which is a parse, not a pattern). What
-- the database can insist on is that a DISABLED schedule says why — the
-- whole point of separating DISABLED from PAUSED — and that a live
-- schedule has somewhere to send the file.
ALTER TABLE "report_schedules"
  ADD CONSTRAINT "chk_report_schedules_shape"
  CHECK (
    length(btrim("name")) > 0
    AND length(btrim("cron")) > 0
    AND "failure_count" >= 0
    AND jsonb_typeof("recipients") = 'object'
    AND jsonb_typeof("params") = 'object'
    AND (
      "status" <> 'DISABLED'
      OR length(btrim(coalesce("disabled_reason", ''))) > 0
    )
  );

-- The run status machine, as far as a row can see it. DONE means there is
-- a file and a finish time; FAILED means there is an error and no file —
-- a "successful" run with nothing to download is the failure mode that
-- makes an export centre useless, and it is cheap to make unrepresentable.
ALTER TABLE "report_runs"
  ADD CONSTRAINT "chk_report_runs_shape"
  CHECK (
    ("row_count" IS NULL OR "row_count" >= 0)
    AND ("duration_ms" IS NULL OR "duration_ms" >= 0)
    AND ("file_size" IS NULL OR "file_size" >= 0)
    AND jsonb_typeof("params") = 'object'
    AND jsonb_typeof("stripped_columns") = 'array'
    AND (
      "status" <> 'DONE'
      OR ("file_key" IS NOT NULL AND "finished_at" IS NOT NULL)
    )
    AND (
      "status" <> 'FAILED'
      OR (length(btrim(coalesce("error", ''))) > 0 AND "file_key" IS NULL)
    )
    AND ("status" NOT IN ('QUEUED') OR "started_at" IS NULL)
  );

ALTER TABLE "site_analytics_daily"
  ADD CONSTRAINT "chk_site_analytics_daily_shape"
  CHECK (
    "page_views" >= 0
    AND "unique_visitors" >= 0
    AND "unique_visitors" <= "page_views"
    AND jsonb_typeof("top_pages") = 'array'
    AND jsonb_typeof("top_referrers") = 'array'
  );

-- ── Materialized views (roadmap §3) ──────────────────────────────────
--
-- Three aggregates that are read on every dashboard load and recomputed
-- from the same rows every time. They are refreshed nightly and by an
-- explicit endpoint (roadmap §4), so **everything served from them is up
-- to 24 hours stale** — the report definitions that read them say so in
-- their `freshness` column, and the dashboard prints it, because a figure
-- that quietly disagrees with the live screen next to it destroys trust in
-- both (roadmap §8).
--
-- Each carries a UNIQUE index. That is not for lookups: REFRESH
-- MATERIALIZED VIEW CONCURRENTLY *requires* one, and without CONCURRENTLY
-- the refresh takes an ACCESS EXCLUSIVE lock — the nightly job would then
-- block every dashboard reading the view for the length of the rebuild.

-- Attendance by section and month. `student_attendances` carries the
-- section but not the class, so the class comes through the enrollment —
-- which is also the row the M11 rule says attendance keys on.
CREATE MATERIALIZED VIEW "mv_attendance_monthly" AS
SELECT
    a."school_id",
    e."session_id",
    e."class_id",
    a."section_id",
    date_trunc('month', a."date")::date AS "month",
    count(*) FILTER (WHERE a."status" <> 'HOLIDAY')::int    AS "marked",
    count(*) FILTER (WHERE a."status" = 'PRESENT')::int     AS "present",
    count(*) FILTER (WHERE a."status" = 'LATE')::int        AS "late",
    count(*) FILTER (WHERE a."status" = 'HALF_DAY')::int    AS "half_day",
    count(*) FILTER (WHERE a."status" = 'ABSENT')::int      AS "absent",
    count(*) FILTER (WHERE a."status" = 'LEAVE')::int       AS "on_leave",
    count(DISTINCT a."enrollment_id")::int                  AS "students"
FROM "student_attendances" a
JOIN "enrollments" e ON e."id" = a."enrollment_id"
WHERE a."deleted_at" IS NULL
  AND e."deleted_at" IS NULL
GROUP BY 1, 2, 3, 4, 5;

CREATE UNIQUE INDEX "uq_mv_attendance_monthly"
  ON "mv_attendance_monthly" ("school_id", "session_id", "class_id", "section_id", "month");

CREATE INDEX "idx_mv_attendance_monthly_month"
  ON "mv_attendance_monthly" ("school_id", "month");

-- Fee realization by month: what was billed against what was collected.
--
-- The two halves are counted on **different dates and cannot be one
-- GROUP BY** — an invoice belongs to its billing month, a payment belongs
-- to the day the money arrived, and a March invoice settled in May is a
-- real and common event. A single join would multiply the invoice total by
-- its payment count, which is the classic fan-out bug; the FULL OUTER JOIN
-- of two independent aggregates is what keeps both numbers honest and
-- keeps a month that had payments but no invoices (or the reverse).
CREATE MATERIALIZED VIEW "mv_collection_monthly" AS
WITH "billed" AS (
    SELECT
        i."school_id",
        date_trunc('month', coalesce(i."billing_month", i."issue_date"))::date AS "month",
        sum(i."payable")::numeric(14,2)   AS "billed",
        sum(i."fine_total")::numeric(14,2) AS "fined",
        count(*)::int                      AS "invoices"
    FROM "invoices" i
    WHERE i."deleted_at" IS NULL
      AND i."status" <> 'CANCELLED'
    GROUP BY 1, 2
),
"collected" AS (
    SELECT
        p."school_id",
        date_trunc('month', coalesce(p."paid_at", p."created_at"))::date AS "month",
        sum(p."amount")::numeric(14,2) AS "collected",
        count(*)::int                  AS "payments"
    FROM "payments" p
    WHERE p."status" = 'SUCCESS'
    GROUP BY 1, 2
)
SELECT
    coalesce(b."school_id", c."school_id") AS "school_id",
    coalesce(b."month", c."month")         AS "month",
    coalesce(b."billed", 0)                AS "billed",
    coalesce(b."fined", 0)                 AS "fined",
    coalesce(b."invoices", 0)              AS "invoices",
    coalesce(c."collected", 0)             AS "collected",
    coalesce(c."payments", 0)              AS "payments"
FROM "billed" b
FULL OUTER JOIN "collected" c
  ON c."school_id" = b."school_id" AND c."month" = b."month";

CREATE UNIQUE INDEX "uq_mv_collection_monthly"
  ON "mv_collection_monthly" ("school_id", "month");

-- Result trends: pass rate and average GPA per exam over time.
--
-- **Only published results count**, and publication is `published_at`
-- rather than a status — `result_status_enum` is PASSED/FAILED/INCOMPLETE/
-- WITHHELD, which describes the candidate and not the release. A WITHHELD
-- row is excluded on top of that: it is a result the school has decided
-- not to stand behind yet, and a trend line that moves when somebody's
-- dues are cleared is not measuring what the reader thinks it is.
CREATE MATERIALIZED VIEW "mv_result_summary" AS
SELECT
    r."school_id",
    r."exam_id",
    x."session_id",
    x."name"                                        AS "exam_name",
    x."start_date"                                  AS "exam_date",
    count(*)::int                                   AS "candidates",
    count(*) FILTER (WHERE r."status" = 'PASSED')::int AS "passed",
    round(avg(r."gpa"), 2)                          AS "avg_gpa",
    round(avg(
      CASE WHEN r."total_marks" > 0
           THEN r."obtained_marks" * 100 / r."total_marks"
      END
    ), 2)                                           AS "avg_percentage",
    max(r."published_at")                           AS "last_published_at"
FROM "results" r
JOIN "exams" x ON x."id" = r."exam_id" AND x."deleted_at" IS NULL
WHERE r."published_at" IS NOT NULL
  AND r."status" <> 'WITHHELD'
GROUP BY r."school_id", r."exam_id", x."session_id", x."name", x."start_date";

CREATE UNIQUE INDEX "uq_mv_result_summary"
  ON "mv_result_summary" ("school_id", "exam_id");

CREATE INDEX "idx_mv_result_summary_session"
  ON "mv_result_summary" ("school_id", "session_id", "exam_date");
