---
name: smis-database
description: Change the Prisma schema and write/verify a hand-edited SQL migration for SMIS/HexSchool — new tables, enums, partial unique indexes, CHECK constraints, COALESCE identity indexes — then prove it replays cleanly with zero drift and deploy it to the local Docker Postgres and the Neon dev database. Use for any schema, migration, index, constraint or seed-data task.
---

# SMIS schema & migrations

Prisma 7, Postgres 16. `prisma/schema.prisma` + one migration directory
per module in `prisma/migrations/` (14 so far, strictly ordered).

## Mandatory column set

Every **business** table:

```prisma
id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
schoolId  String    @map("school_id") @db.Uuid          // ALWAYS, even single-school
createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
createdBy String?   @map("created_by") @db.Uuid
updatedBy String?   @map("updated_by") @db.Uuid
deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)
```

Omit `deleted_at` only on join tables, append-only logs, and generated
artifacts that are replaced wholesale — and **say why in the model doc
comment** (`seat_plans`, `timetable_entries`, `marks`, `mark_corrections`,
`audit_logs`).

Other rules: snake_case via `@map`, plural table names, `fk_`/`uq_`/`idx_`/
`chk_` constraint prefixes, money `NUMERIC(12,2)`, dates that mean a
calendar day as `@db.Date` handled as `YYYY-MM-DD` strings end to end
(parse through `academic/calendar/date.util.ts`'s `parseDate`).

Every unique constraint is scoped by `school_id`.

## The workflow

```bash
cd hexschool-backend
# 1. edit prisma/schema.prisma (models + BACK-RELATIONS on School, etc.)
npx prisma validate
npx prisma generate

# 2. create the migration WITHOUT applying it, then hand-edit the SQL
npx prisma migrate dev --create-only --name marks_result_processing
```

Then append the hand-written section Prisma cannot express, with comments
explaining each constraint's purpose — see the tail of
`20260722213000_marks_result_processing/migration.sql` for the house style.

Finally re-export the new PG enums from `src/common/constants/enums.ts`.

## What must be hand-written

Prisma cannot express these; they go in the migration SQL only.

**Partial unique indexes** — the workhorse of this schema:
```sql
-- at most one ACTIVE publication per exam
CREATE UNIQUE INDEX "uq_result_publications_one_active"
  ON "result_publications" ("exam_id") WHERE "is_active" = true;
```
Also used for: one `is_current` session, one primary guardian per student,
soft-delete-aware name uniqueness (`WHERE deleted_at IS NULL`), and
enrollment uniques that exclude `CANCELLED` so a cancelled row frees its
slot.

**COALESCE identity indexes** — Postgres treats NULLs as distinct, so a
nullable column in an identity key needs mapping to the nil UUID:
```sql
CREATE UNIQUE INDEX "uq_sections_identity" ON "sections"
  ("school_id", "session_id", "class_id", "name",
   COALESCE("shift_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "deleted_at" IS NULL;
```

**CHECK constraints** for anything expressible from columns *on the row*:
```sql
ALTER TABLE "marks" ADD CONSTRAINT "chk_marks_absent_empty"
  CHECK ("is_absent" = false OR (… AND "total" = 0));
```
Anything needing a join (a mark against its paper's `full_marks`) is
**service-enforced** — say so in a comment naming the engine that owns it.

**Deliberately NOT soft-delete-scoped:** the employee-ID and student-UID
uniques ignore `deleted_at`, because those identifiers are never reused.

## Verification — do this, do not skip it

Prisma's `migrate diff` **ignores partial/expression indexes and CHECKs**
(it cannot introspect them), so "no difference detected" proves the
*representable* schema matches. Assert the rest with SQL.

```bash
# 1. replay the WHOLE chain onto an empty database — stronger than
#    applying just the new one, and it is what a fresh deploy does
docker compose exec -T postgres psql -U smis -d smis \
  -c "DROP DATABASE IF EXISTS smis_verify;" -c "CREATE DATABASE smis_verify;"
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis_verify" npx prisma migrate deploy

# 2. drift check (Prisma 7 has no --from-url; use the config datasource)
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis_verify" \
  npx prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --exit-code       # → "No difference detected."

# 3. assert the hand-written objects actually landed
docker compose exec -T postgres psql -U smis -d smis_verify -t -c "
  SELECT conname FROM pg_constraint WHERE conname LIKE 'chk_%' ORDER BY 1;
  SELECT indexname FROM pg_indexes WHERE indexname LIKE 'uq_%';"

# 4. seed it, then clean up
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis_verify" npm run seed
docker compose exec -T postgres psql -U smis -d smis -c "DROP DATABASE smis_verify;"
```

## Two databases — know which one you are hitting

`.env` `DATABASE_URL` points at the **Neon cloud dev DB**. Docker Compose
also runs a local Postgres on host port **5433**.

- Migrations get deployed to **both**: local dev DB and Neon.
- The **e2e suite must run against local** — override `DATABASE_URL`
  inline; it creates and deletes fixture data.

```bash
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" npx prisma migrate deploy
npx prisma migrate deploy                    # → Neon (uses .env)
npx prisma migrate status                    # confirm "up to date"
```

## Seeders

`src/database/seeds/seed.ts` runs an ordered list; each module appends
one. **Every seeder must be idempotent** — check for existence and log
`already present — skipped;`. The RBAC seeder syncs the permission
registry (inserting new codes, orphan-flagging removed ones) and grants
role baselines without revoking admin-added extras.

## Frequent mistakes

- Forgetting the **back-relation** on `School` (and `Exam`, `Enrollment`,
  `AcademicSession`) — `prisma validate` catches it; run it.
- A `@@unique` in the schema **and** a hand-written partial unique for the
  same thing — you get two indexes. Pick one; if it needs a `WHERE`, it is
  hand-written only.
- Editing an already-applied migration. Never. Write a new one.
