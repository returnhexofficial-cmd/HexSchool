-- ── Module 23: Library Management ────────────────────────────────────

-- CreateEnum
CREATE TYPE "book_copy_status_enum" AS ENUM ('AVAILABLE', 'ISSUED', 'RESERVED', 'LOST', 'DAMAGED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "book_condition_enum" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "library_member_type_enum" AS ENUM ('STUDENT', 'TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "library_member_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "library_fine_reason_enum" AS ENUM ('NONE', 'OVERDUE', 'LOST', 'DAMAGED');

-- CreateEnum
CREATE TYPE "book_reservation_status_enum" AS ENUM ('ACTIVE', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "stock_verification_status_enum" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `library` joins
-- it so the new `library.*` keys validate. Safe inside the migration
-- transaction because nothing written HERE uses the new value (PG only
-- forbids *using* it in the transaction that adds it) — the M20/M21/M22
-- `settings_group_enum` precedent.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'library';

-- AlterEnum
-- M20's auto-posting source. A library fine receipt is neither a fee nor
-- a payroll payment, and the income & expenditure statement has to be
-- able to say which it was. Same in-transaction rule as above: no row
-- written by this migration uses the value.
ALTER TYPE "voucher_source_enum" ADD VALUE IF NOT EXISTS 'LIBRARY';

-- CreateTable
CREATE TABLE "book_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "name_bn" VARCHAR(120),
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "book_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "name_bn" VARCHAR(160),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "name_bn" VARCHAR(160),
    "phone" VARCHAR(20),
    "email" VARCHAR(160),
    "address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "title_bn" VARCHAR(250),
    "isbn" VARCHAR(17),
    "category_id" UUID NOT NULL,
    "publisher_id" UUID,
    "edition" VARCHAR(60),
    "language" VARCHAR(40) NOT NULL DEFAULT 'English',
    "price" DECIMAL(12,2),
    "cover_url" VARCHAR(500),
    "rack_no" VARCHAR(40),
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_authors" (
    "book_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "book_authors_pkey" PRIMARY KEY ("book_id","author_id")
);

-- CreateTable
CREATE TABLE "book_copies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "accession_no" VARCHAR(40) NOT NULL,
    "status" "book_copy_status_enum" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "book_condition_enum" NOT NULL DEFAULT 'NEW',
    "condition_note" TEXT,
    "purchase_price" DECIMAL(12,2),
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_type" "library_member_type_enum" NOT NULL,
    "person_id" UUID NOT NULL,
    "card_no" VARCHAR(40) NOT NULL,
    "max_books" INTEGER NOT NULL DEFAULT 2,
    "status" "library_member_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "library_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "copy_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "returned_at" TIMESTAMPTZ(6),
    "renew_count" INTEGER NOT NULL DEFAULT 0,
    "fine_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fine_collected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fine_waived" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fine_reason" "library_fine_reason_enum" NOT NULL DEFAULT 'NONE',
    "fine_paid" BOOLEAN NOT NULL DEFAULT true,
    "fine_waived_by" UUID,
    "fine_waive_reason" TEXT,
    "fine_collected_at" TIMESTAMPTZ(6),
    "fine_voucher_id" UUID,
    "overdue_days" INTEGER NOT NULL DEFAULT 0,
    "holiday_days" INTEGER NOT NULL DEFAULT 0,
    "return_condition" "book_condition_enum",
    "issued_by" UUID,
    "returned_to" UUID,
    "remarks" TEXT,
    "overdue_notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "book_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "book_reservation_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "reserved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "held_copy_id" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "book_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "stock_verification_status_enum" NOT NULL DEFAULT 'IN_PROGRESS',
    "rack_no" VARCHAR(40),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expected_count" INTEGER NOT NULL DEFAULT 0,
    "scanned_count" INTEGER NOT NULL DEFAULT 0,
    "missing_count" INTEGER NOT NULL DEFAULT 0,
    "unexpected_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_verification_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "verification_id" UUID NOT NULL,
    "copy_id" UUID,
    "accession_no" VARCHAR(40) NOT NULL,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_verification_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_book_categories_school" ON "book_categories"("school_id");
CREATE INDEX "idx_authors_school" ON "authors"("school_id");
CREATE INDEX "idx_publishers_school" ON "publishers"("school_id");
CREATE INDEX "idx_books_category" ON "books"("school_id", "category_id");
CREATE INDEX "idx_books_title" ON "books"("school_id", "title");
CREATE INDEX "idx_books_isbn" ON "books"("school_id", "isbn");
CREATE INDEX "idx_book_authors_author" ON "book_authors"("author_id");
CREATE INDEX "idx_book_copies_book" ON "book_copies"("school_id", "book_id", "status");
CREATE INDEX "idx_book_copies_status" ON "book_copies"("school_id", "status");
CREATE INDEX "idx_library_members_status" ON "library_members"("school_id", "status");
CREATE INDEX "idx_library_members_person" ON "library_members"("school_id", "person_type", "person_id");
CREATE INDEX "idx_book_issues_member" ON "book_issues"("school_id", "member_id");
CREATE INDEX "idx_book_issues_due" ON "book_issues"("school_id", "due_at");
CREATE INDEX "idx_book_issues_copy" ON "book_issues"("copy_id");
CREATE INDEX "idx_book_reservations_book" ON "book_reservations"("school_id", "book_id", "status");
CREATE INDEX "idx_book_reservations_member" ON "book_reservations"("school_id", "member_id", "status");
CREATE INDEX "idx_stock_verifications_status" ON "stock_verifications"("school_id", "status");
CREATE INDEX "idx_stock_verification_scans_verification" ON "stock_verification_scans"("verification_id");
CREATE INDEX "idx_stock_verification_scans_copy" ON "stock_verification_scans"("copy_id");

-- AddForeignKey
ALTER TABLE "book_categories" ADD CONSTRAINT "fk_book_categories_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authors" ADD CONSTRAINT "fk_authors_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publishers" ADD CONSTRAINT "fk_publishers_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "books" ADD CONSTRAINT "fk_books_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "books" ADD CONSTRAINT "fk_books_category" FOREIGN KEY ("category_id") REFERENCES "book_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "books" ADD CONSTRAINT "fk_books_publisher" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "book_authors" ADD CONSTRAINT "fk_book_authors_book" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "book_authors" ADD CONSTRAINT "fk_book_authors_author" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "book_copies" ADD CONSTRAINT "fk_book_copies_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "book_copies" ADD CONSTRAINT "fk_book_copies_book" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_members" ADD CONSTRAINT "fk_library_members_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "book_issues" ADD CONSTRAINT "fk_book_issues_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "book_issues" ADD CONSTRAINT "fk_book_issues_copy" FOREIGN KEY ("copy_id") REFERENCES "book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "book_issues" ADD CONSTRAINT "fk_book_issues_member" FOREIGN KEY ("member_id") REFERENCES "library_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "book_reservations" ADD CONSTRAINT "fk_book_reservations_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "book_reservations" ADD CONSTRAINT "fk_book_reservations_book" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "book_reservations" ADD CONSTRAINT "fk_book_reservations_member" FOREIGN KEY ("member_id") REFERENCES "library_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_verifications" ADD CONSTRAINT "fk_stock_verifications_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_verification_scans" ADD CONSTRAINT "fk_stock_verification_scans_verification" FOREIGN KEY ("verification_id") REFERENCES "stock_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_verification_scans" ADD CONSTRAINT "fk_stock_verification_scans_copy" FOREIGN KEY ("copy_id") REFERENCES "book_copies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written identity indexes ───────────────────────────────────
-- Prisma cannot express a partial unique, so every one of these is
-- written here and mirrored nowhere else (the M11/M12/M15/M16 rule).

-- Masters: unique per school among LIVE rows, so a deleted category
-- frees its name.
CREATE UNIQUE INDEX "uq_book_categories_name" ON "book_categories"("school_id", lower("name"))
  WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_authors_name" ON "authors"("school_id", lower("name"))
  WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_publishers_name" ON "publishers"("school_id", lower("name"))
  WHERE "deleted_at" IS NULL;

-- The accession number is the barcode written INSIDE the book, so its
-- unique deliberately IGNORES `deleted_at`: the number is never reused,
-- exactly as an employee ID (M07) or a student UID (M09) is never
-- reused. Deleting a mis-entered copy frees the shelf, not the label —
-- re-issuing the label to a different volume would make every stock
-- register printed since then lie about what was counted.
CREATE UNIQUE INDEX "uq_book_copies_accession" ON "book_copies"("school_id", "accession_no");

-- One card per person, among live cards. A student who leaves and
-- returns is re-enrolled into a NEW card rather than inheriting the
-- closed one's loan history.
CREATE UNIQUE INDEX "uq_library_members_person" ON "library_members"("school_id", "person_type", "person_id")
  WHERE "deleted_at" IS NULL;

-- The card number, like the accession number, is printed on a physical
-- card and never reused.
CREATE UNIQUE INDEX "uq_library_members_card" ON "library_members"("school_id", "card_no");

-- **One open loan per copy.** A physical book is in one pair of hands at
-- a time; this is the rule that makes that true no matter what a service
-- forgets. `book_issues` carries no `deleted_at` — a loan is history —
-- so the predicate is only about whether the book is back.
CREATE UNIQUE INDEX "uq_book_issues_open_copy" ON "book_issues"("copy_id")
  WHERE "returned_at" IS NULL;

-- One live hold per member per title. Reserving the same book twice is
-- not a stronger claim on it; it is a queue with the same person in it
-- twice, and would hand them two copies of one title.
CREATE UNIQUE INDEX "uq_book_reservations_live" ON "book_reservations"("book_id", "member_id")
  WHERE "status" IN ('ACTIVE', 'READY');

-- A copy is held for at most one reservation at a time.
CREATE UNIQUE INDEX "uq_book_reservations_held_copy" ON "book_reservations"("held_copy_id")
  WHERE "held_copy_id" IS NOT NULL AND "status" = 'READY';

-- One scan per copy per stock-take: scanning the same shelf twice is
-- normal human behaviour and must not double the count.
CREATE UNIQUE INDEX "uq_stock_verification_scans_copy" ON "stock_verification_scans"("verification_id", "copy_id")
  WHERE "copy_id" IS NOT NULL;

-- One stock-take open at a time per school. Two concurrent counts would
-- each report the other's shelves as missing.
CREATE UNIQUE INDEX "uq_stock_verifications_open" ON "stock_verifications"("school_id")
  WHERE "status" = 'IN_PROGRESS' AND "deleted_at" IS NULL;

-- ── CHECK constraints ───────────────────────────────────────────────

-- A title needs a title, and a price that is a price. A negative
-- replacement value would produce a negative lost-book charge, which is
-- the library paying a member to lose a book.
ALTER TABLE "books"
  ADD CONSTRAINT "chk_books_shape"
  CHECK (length(btrim("title")) > 0 AND ("price" IS NULL OR "price" >= 0));

ALTER TABLE "book_copies"
  ADD CONSTRAINT "chk_book_copies_shape"
  CHECK (
    length(btrim("accession_no")) > 0
    AND ("purchase_price" IS NULL OR "purchase_price" >= 0)
  );

-- A borrowing limit of zero is a card that cannot borrow, which is what
-- SUSPENDED is for; a negative one is nonsense. The upper bound is a
-- sanity rail, not a policy — policy lives in the settings.
ALTER TABLE "library_members"
  ADD CONSTRAINT "chk_library_members_shape"
  CHECK (length(btrim("card_no")) > 0 AND "max_books" BETWEEN 1 AND 100);

-- The loan window. A due date at or before the issue instant is a book
-- that was overdue before it left the desk, and the fine engine would
-- charge for it — the M22 `chk_assignments_window` situation exactly.
ALTER TABLE "book_issues"
  ADD CONSTRAINT "chk_book_issues_window"
  CHECK (
    "due_at" > "issued_at"
    AND ("returned_at" IS NULL OR "returned_at" >= "issued_at")
    AND "renew_count" >= 0
    AND "overdue_days" >= 0
    AND "holiday_days" >= 0
  );

-- The fine arithmetic. Every component is non-negative, and what has
-- been settled can never exceed what was assessed — without this, a
-- waiver entered twice would turn a fine into a refund the school has no
-- record of paying.
ALTER TABLE "book_issues"
  ADD CONSTRAINT "chk_book_issues_fine_amounts"
  CHECK (
    "fine_amount" >= 0
    AND "fine_collected" >= 0
    AND "fine_waived" >= 0
    AND "fine_collected" + "fine_waived" <= "fine_amount"
  );

-- `fine_paid` is DERIVED, not assigned — the M16 `deriveStatus` rule
-- pinned at the database. Every write path that touches the money must
-- recompute the flag in the same statement or be refused, so the flag
-- and the figures beside it can never disagree. This is the one
-- invariant a "mark as paid" button would otherwise be able to break.
ALTER TABLE "book_issues"
  ADD CONSTRAINT "chk_book_issues_fine_paid"
  CHECK ("fine_paid" = ("fine_collected" + "fine_waived" >= "fine_amount"));

-- Money that was written off says who wrote it off and why. A waiver
-- with no name on it is indistinguishable from a fine that was never
-- charged — the M16/M20 "every monetary override needs permission and a
-- reason" rule, made structural.
ALTER TABLE "book_issues"
  ADD CONSTRAINT "chk_book_issues_waiver_evidence"
  CHECK (
    "fine_waived" = 0
    OR (
      "fine_waived_by" IS NOT NULL
      AND "fine_waive_reason" IS NOT NULL
      AND length(btrim("fine_waive_reason")) > 0
    )
  );

-- Collected money carries the instant it was taken (the M16
-- `chk_payments_success_evidence` shape), and a fine that was assessed
-- names its reason.
ALTER TABLE "book_issues"
  ADD CONSTRAINT "chk_book_issues_fine_evidence"
  CHECK (
    ("fine_collected" = 0 OR "fine_collected_at" IS NOT NULL)
    AND ("fine_amount" = 0 OR "fine_reason" <> 'NONE')
  );

-- A reservation that is READY is holding a specific copy until a
-- specific time; one that is closed says when. Without the first half a
-- copy could sit in RESERVED with nothing pointing at it and no job able
-- to release it.
ALTER TABLE "book_reservations"
  ADD CONSTRAINT "chk_book_reservations_evidence"
  CHECK (
    ("status" <> 'READY' OR ("held_copy_id" IS NOT NULL AND "ready_at" IS NOT NULL AND "expires_at" IS NOT NULL))
    AND ("status" NOT IN ('FULFILLED', 'CANCELLED', 'EXPIRED') OR "closed_at" IS NOT NULL)
  );

-- A completed stock-take carries its frozen diff; an open one has not
-- computed one yet.
ALTER TABLE "stock_verifications"
  ADD CONSTRAINT "chk_stock_verifications_shape"
  CHECK (
    length(btrim("name")) > 0
    AND "expected_count" >= 0
    AND "scanned_count" >= 0
    AND "missing_count" >= 0
    AND "unexpected_count" >= 0
    AND ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL)
  );

ALTER TABLE "stock_verification_scans"
  ADD CONSTRAINT "chk_stock_verification_scans_accession"
  CHECK (length(btrim("accession_no")) > 0);
