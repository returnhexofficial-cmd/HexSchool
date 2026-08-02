-- ── Module 24: Inventory & Assets ────────────────────────────────────

-- CreateEnum
CREATE TYPE "item_type_enum" AS ENUM ('ASSET', 'CONSUMABLE');

-- CreateEnum
CREATE TYPE "item_unit_enum" AS ENUM ('PCS', 'BOX', 'REAM', 'SET', 'LITER', 'KG', 'OTHER');

-- CreateEnum
CREATE TYPE "supplier_status_enum" AS ENUM ('ACTIVE', 'INACTIVE', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "purchase_status_enum" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "stock_txn_enum" AS ENUM ('PURCHASE', 'ISSUE', 'RETURN', 'ADJUST', 'DISPOSE');

-- CreateEnum
CREATE TYPE "asset_unit_status_enum" AS ENUM ('IN_STORE', 'ASSIGNED', 'UNDER_REPAIR', 'DISPOSED', 'LOST');

-- CreateEnum
CREATE TYPE "asset_condition_enum" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'UNSERVICEABLE');

-- CreateEnum
CREATE TYPE "inventory_holder_type_enum" AS ENUM ('DEPARTMENT', 'PERSON', 'ROOM');

-- CreateEnum
CREATE TYPE "inventory_person_type_enum" AS ENUM ('TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "stock_issue_status_enum" AS ENUM ('ISSUED', 'PARTIAL_RETURN', 'RETURNED');

-- AlterEnum
-- The settings registry stores its group in this PG enum; `inventory`
-- joins it so the new `inventory.*` keys validate. Safe inside the
-- migration transaction because nothing written HERE uses the new value
-- (PG only forbids *using* it in the transaction that adds it) — the
-- M20/M21/M22/M23/M25 `settings_group_enum` precedent.
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'inventory';

-- AlterEnum
-- M20's posting map keyed on an item category, so "furniture
-- capitalizes to 1520 and stationery expenses to 5500" is a school's
-- accounting policy rather than something this module infers from a
-- category name. `PostingMapKind` was designed append-only for exactly
-- this (M20 §16).
ALTER TYPE "posting_map_kind_enum" ADD VALUE IF NOT EXISTS 'INVENTORY_CATEGORY';

-- `voucher_source_enum` already carries INVENTORY: M20 enumerated it
-- when the enum was written, so a purchase voucher needs no ALTER here.

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "contact_person" VARCHAR(120),
    "phone" VARCHAR(20),
    "email" VARCHAR(160),
    "address" TEXT,
    "status" "supplier_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "status_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "name_bn" VARCHAR(120),
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "category_id" UUID,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "name_bn" VARCHAR(160),
    "type" "item_type_enum" NOT NULL,
    "unit" "item_unit_enum" NOT NULL DEFAULT 'PCS',
    "description" TEXT,
    "pack_size" DECIMAL(14,3),
    "pack_label" VARCHAR(40),
    "reorder_level" DECIMAL(14,3),
    "last_unit_cost" DECIMAL(12,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "supplier_id" UUID,
    "purchase_no" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "invoice_ref" VARCHAR(80),
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "purchase_status_enum" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "received_at" TIMESTAMPTZ(6),
    "received_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "voucher_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "pack_size" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "base_qty" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Append-only: no `deleted_at`, no `updated_at`, and no UPDATE path in
-- the repository (the `audit_logs` / `sms_credits` / `pf_ledger` shape).
CREATE TABLE "stock_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "txn" "stock_txn_enum" NOT NULL,
    "qty_in" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qty_out" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(14,3) NOT NULL,
    "ref_type" VARCHAR(40),
    "ref_id" UUID,
    "unit_cost" DECIMAL(12,4),
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "purchase_item_id" UUID,
    "asset_tag" VARCHAR(60) NOT NULL,
    "serial_no" VARCHAR(80),
    "status" "asset_unit_status_enum" NOT NULL DEFAULT 'IN_STORE',
    "condition" "asset_condition_enum" NOT NULL DEFAULT 'GOOD',
    "location_text" VARCHAR(160),
    "custodian_type" "inventory_holder_type_enum",
    "custodian_dept_id" UUID,
    "custodian_person_type" "inventory_person_type_enum",
    "custodian_person_id" UUID,
    "custodian_room" VARCHAR(160),
    "purchase_price" DECIMAL(12,2),
    "purchase_date" DATE,
    "warranty_until" DATE,
    "disposed_at" DATE,
    "disposal_reason" TEXT,
    "disposed_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "asset_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "issue_no" VARCHAR(40) NOT NULL,
    "issue_date" DATE NOT NULL,
    "issued_to_type" "inventory_holder_type_enum" NOT NULL,
    "issued_to_dept_id" UUID,
    "issued_to_person_type" "inventory_person_type_enum",
    "issued_to_person_id" UUID,
    "issued_to_room" VARCHAR(160),
    "purpose" TEXT,
    "status" "stock_issue_status_enum" NOT NULL DEFAULT 'ISSUED',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issue_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "returned_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_issue_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_suppliers_status" ON "suppliers"("school_id", "status");
CREATE INDEX "idx_item_categories_parent" ON "item_categories"("school_id", "parent_id");
CREATE INDEX "idx_items_category" ON "items"("school_id", "category_id");
CREATE INDEX "idx_items_type" ON "items"("school_id", "type");
CREATE INDEX "idx_purchases_status" ON "purchases"("school_id", "status", "date");
CREATE INDEX "idx_purchases_supplier" ON "purchases"("school_id", "supplier_id");
CREATE INDEX "idx_purchase_items_purchase" ON "purchase_items"("purchase_id");
CREATE INDEX "idx_purchase_items_item" ON "purchase_items"("school_id", "item_id");
CREATE INDEX "idx_stock_ledger_item" ON "stock_ledger"("school_id", "item_id", "created_at");
CREATE INDEX "idx_stock_ledger_txn" ON "stock_ledger"("school_id", "txn", "created_at");
CREATE INDEX "idx_stock_ledger_ref" ON "stock_ledger"("ref_type", "ref_id");
CREATE INDEX "idx_asset_units_item" ON "asset_units"("school_id", "item_id", "status");
CREATE INDEX "idx_asset_units_status" ON "asset_units"("school_id", "status");
CREATE INDEX "idx_asset_units_dept" ON "asset_units"("school_id", "custodian_dept_id");
CREATE INDEX "idx_asset_units_person" ON "asset_units"("school_id", "custodian_person_id");
CREATE INDEX "idx_asset_units_warranty" ON "asset_units"("school_id", "warranty_until");
CREATE INDEX "idx_stock_issues_status" ON "stock_issues"("school_id", "status", "issue_date");
CREATE INDEX "idx_stock_issues_dept" ON "stock_issues"("school_id", "issued_to_dept_id");
CREATE INDEX "idx_stock_issue_items_issue" ON "stock_issue_items"("issue_id");
CREATE INDEX "idx_stock_issue_items_item" ON "stock_issue_items"("school_id", "item_id");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "fk_suppliers_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_categories" ADD CONSTRAINT "fk_item_categories_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_categories" ADD CONSTRAINT "fk_item_categories_parent" FOREIGN KEY ("parent_id") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "fk_items_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "fk_items_category" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_items" ADD CONSTRAINT "fk_purchase_items_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The only CASCADE in the module, and it is deliberate: a draft's lines
-- are edited as a grid and replaced as a set (the M13 `timetable_entries`
-- / M20 `voucher_entries` precedent). Deleting a RECEIVED purchase is
-- refused by the service long before this could fire.
ALTER TABLE "purchase_items" ADD CONSTRAINT "fk_purchase_items_purchase" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_items" ADD CONSTRAINT "fk_purchase_items_item" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "fk_stock_ledger_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "fk_stock_ledger_item" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_units" ADD CONSTRAINT "fk_asset_units_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_units" ADD CONSTRAINT "fk_asset_units_item" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_units" ADD CONSTRAINT "fk_asset_units_purchase_item" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_units" ADD CONSTRAINT "fk_asset_units_custodian_dept" FOREIGN KEY ("custodian_dept_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issues" ADD CONSTRAINT "fk_stock_issues_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issues" ADD CONSTRAINT "fk_stock_issues_dept" FOREIGN KEY ("issued_to_dept_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "fk_stock_issue_items_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "fk_stock_issue_items_issue" FOREIGN KEY ("issue_id") REFERENCES "stock_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "fk_stock_issue_items_item" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written identity indexes ───────────────────────────────────
-- Prisma cannot express a partial unique, so every one of these is
-- written here and mirrored nowhere else (the M11/M12/M15/M16 rule).

-- A supplier name is how the office refers to them on a delivery note;
-- two live rows sharing one means somebody picks the wrong one. Live-rows
-- scoped, so deleting a mis-typed row frees the name.
CREATE UNIQUE INDEX "uq_suppliers_name" ON "suppliers"("school_id", lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

-- Sibling categories may not share a name — "Lab → Glassware" twice is a
-- tree nobody can file against. NULL-safe over the optional parent via
-- COALESCE, the M06 `sections` identity-index trick, because two ROOT
-- categories called "Stationery" are the same collision and a plain
-- unique would let them both through (NULL <> NULL in SQL).
CREATE UNIQUE INDEX "uq_item_categories_identity"
  ON "item_categories"("school_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

-- The item code is a catalogue label the school chooses, so it is scoped
-- to LIVE rows — the M25 `uq_vehicles_reg_no` rule rather than the M07 /
-- M09 / M23 never-reuse one, and the contrast is deliberate: an asset TAG
-- below is the never-reused kind, because that one is stuck to an object.
CREATE UNIQUE INDEX "uq_items_code" ON "items"("school_id", upper(btrim("code")))
  WHERE "deleted_at" IS NULL;

-- Purchase numbers come from SequenceService and are gap-free; the index
-- ignores `deleted_at` because the number is printed on a document that
-- left the office and went to a supplier. Re-issuing PO-26-00007 to a
-- different delivery would make two invoices reference one purchase.
CREATE UNIQUE INDEX "uq_purchases_no" ON "purchases"("school_id", "purchase_no");

-- Same rule for the gate pass, and for the same reason: somebody signed
-- for it.
CREATE UNIQUE INDEX "uq_stock_issues_no" ON "stock_issues"("school_id", "issue_no");

-- **The asset tag is never reused.** It is a sticker on a projector — the
-- M07 employee-ID / M09 student-UID / M23 accession rule — so this index
-- deliberately IGNORES `deleted_at`. Deleting a mis-entered unit frees
-- the shelf, not the number; re-issuing it would make every asset
-- register printed since then lie about what was counted.
CREATE UNIQUE INDEX "uq_asset_units_tag" ON "asset_units"("school_id", upper(btrim("asset_tag")));

-- A serial number is the manufacturer's, so two live units sharing one
-- means the same physical machine was entered twice. Live-rows scoped
-- (unlike the tag) because the serial belongs to the object rather than
-- to the school's numbering — the same distinction M25 draws for a plate.
CREATE UNIQUE INDEX "uq_asset_units_serial" ON "asset_units"("school_id", upper(btrim("serial_no")))
  WHERE "serial_no" IS NOT NULL AND "deleted_at" IS NULL;

-- One line per item per purchase. Without it a clerk entering the same
-- item twice on one delivery note produces a purchase whose total is
-- right and whose stock movement is double-counted in the item ledger —
-- which nobody notices, because both numbers look plausible.
CREATE UNIQUE INDEX "uq_purchase_items_identity" ON "purchase_items"("purchase_id", "item_id");

-- Same rule for a gate pass: one line per item, so a return has one row
-- to move `returned_qty` on and cannot be split ambiguously across two.
CREATE UNIQUE INDEX "uq_stock_issue_items_identity" ON "stock_issue_items"("issue_id", "item_id");

-- ── CHECK constraints ───────────────────────────────────────────────

ALTER TABLE "suppliers"
  ADD CONSTRAINT "chk_suppliers_shape"
  CHECK (
    length(btrim("name")) > 0
    -- A blacklisting with no reason on it is a decision nobody can
    -- review, and the office needs to know WHY when the next delivery
    -- is refused (the M07 status-reason rule, made structural).
    AND ("status" <> 'BLACKLISTED' OR length(btrim(coalesce("status_reason", ''))) > 0)
  );

ALTER TABLE "item_categories"
  ADD CONSTRAINT "chk_item_categories_shape"
  CHECK (
    length(btrim("name")) > 0
    -- A category cannot be its own parent. Deeper cycles need a walk
    -- (`categoryTree` does it, the M20 `wouldCycle` precedent); this
    -- catches the one case a single row can express.
    AND ("parent_id" IS NULL OR "parent_id" <> "id")
  );

-- `pack_size` is §8's box→pcs conversion factor. Zero would make a
-- purchase of four boxes arrive as nothing; a negative one would take
-- stock away by buying it. NULL is the legitimate "no pack" case, which
-- is why the guard is written around it rather than defaulting to 1.
ALTER TABLE "items"
  ADD CONSTRAINT "chk_items_shape"
  CHECK (
    length(btrim("code")) > 0
    AND length(btrim("name")) > 0
    AND ("pack_size" IS NULL OR "pack_size" > 0)
    AND ("reorder_level" IS NULL OR "reorder_level" >= 0)
    AND ("last_unit_cost" IS NULL OR "last_unit_cost" >= 0)
  );

-- A status with no date behind it cannot be audited — the M22 / M25
-- status-evidence rule. RECEIVED is the one that matters: it is the
-- moment the stock ledger moved, and a RECEIVED purchase with no
-- `received_at` leaves "when did the paper arrive" unanswerable.
ALTER TABLE "purchases"
  ADD CONSTRAINT "chk_purchases_status_evidence"
  CHECK (
    ("status" <> 'RECEIVED' OR "received_at" IS NOT NULL)
    AND ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL)
    AND ("status" <> 'DRAFT' OR ("received_at" IS NULL AND "cancelled_at" IS NULL))
    AND "total" >= 0
  );

-- **The unit conversion, pinned.** `base_qty = qty × pack_size` and
-- `total = qty × unit_price` are both computable from columns on this
-- row, so unlike the purchase total (which sums siblings a CHECK cannot
-- see) they are enforceable here. Without the first, a service that
-- forgets to convert writes 4 into a ledger that means 48.
ALTER TABLE "purchase_items"
  ADD CONSTRAINT "chk_purchase_items_shape"
  CHECK (
    "qty" > 0
    AND "pack_size" > 0
    AND "unit_price" >= 0
    AND "base_qty" = "qty" * "pack_size"
    AND "total" = "qty" * "unit_price"
  );

-- **The module's central invariant.** Each row moves stock in exactly one
-- direction (the M20 `chk_voucher_entries_one_sided` shape), and the
-- running balance may never go below zero — a school cannot issue what it
-- does not have, and the database says so even when a service forgets to
-- check. An ADJUST that would drive the balance negative is refused here
-- rather than silently stored as a debt of paper.
ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "chk_stock_ledger_one_sided"
  CHECK (
    "qty_in" >= 0
    AND "qty_out" >= 0
    AND ("qty_in" = 0) <> ("qty_out" = 0)
    AND "balance_after" >= 0
    AND ("unit_cost" IS NULL OR "unit_cost" >= 0)
  );

-- An ADJUST or a DISPOSE with no reason on it is exactly the movement a
-- stock-take dispute turns on (roadmap §4: "permission + reason"). The
-- other three carry their reason in the document they point at.
ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "chk_stock_ledger_reason"
  CHECK (
    "txn" NOT IN ('ADJUST', 'DISPOSE')
    OR length(btrim(coalesce("remarks", ''))) > 0
  );

-- **The shared holder shape**, pinned for the asset custodian. Exactly
-- the columns the kind names are populated and the others are NULL, so
-- the register and the issue desk cannot end up describing the same
-- projector as both "Science dept" and "Mr Rahman". A NULL kind is a unit
-- sitting in the store, held by nobody — which is why the whole clause is
-- guarded on `custodian_type IS NULL` first.
ALTER TABLE "asset_units"
  ADD CONSTRAINT "chk_asset_units_custodian"
  CHECK (
    (
      "custodian_type" IS NULL
      AND "custodian_dept_id" IS NULL
      AND "custodian_person_type" IS NULL
      AND "custodian_person_id" IS NULL
      AND "custodian_room" IS NULL
    )
    OR (
      "custodian_type" = 'DEPARTMENT'
      AND "custodian_dept_id" IS NOT NULL
      AND "custodian_person_id" IS NULL
      AND "custodian_room" IS NULL
    )
    OR (
      "custodian_type" = 'PERSON'
      AND "custodian_person_type" IS NOT NULL
      AND "custodian_person_id" IS NOT NULL
      AND "custodian_dept_id" IS NULL
      AND "custodian_room" IS NULL
    )
    OR (
      "custodian_type" = 'ROOM'
      AND length(btrim(coalesce("custodian_room", ''))) > 0
      AND "custodian_dept_id" IS NULL
      AND "custodian_person_id" IS NULL
    )
  );

-- Roadmap §7: "warranty date ≥ purchase date". A warranty that expired
-- before the thing was bought is a typo the register would otherwise
-- print forever, and the warranty-expiring report would keep flagging it.
ALTER TABLE "asset_units"
  ADD CONSTRAINT "chk_asset_units_warranty"
  CHECK (
    "warranty_until" IS NULL
    OR "purchase_date" IS NULL
    OR "warranty_until" >= "purchase_date"
  );

-- Roadmap §6 makes disposal an approved act, so a written-off unit
-- carries the date, the reason and the name — the M23 waiver-evidence
-- rule. LOST is included: "we cannot find it" is a claim somebody has to
-- put their name to, not a status a form can set quietly.
ALTER TABLE "asset_units"
  ADD CONSTRAINT "chk_asset_units_disposal_evidence"
  CHECK (
    "status" NOT IN ('DISPOSED', 'LOST')
    OR (
      "disposed_at" IS NOT NULL
      AND length(btrim(coalesce("disposal_reason", ''))) > 0
      AND "disposed_by" IS NOT NULL
    )
  );

ALTER TABLE "asset_units"
  ADD CONSTRAINT "chk_asset_units_shape"
  CHECK (
    length(btrim("asset_tag")) > 0
    AND ("purchase_price" IS NULL OR "purchase_price" >= 0)
  );

-- The same holder shape as the asset custodian, one table over. Here the
-- kind is NOT NULL: a gate pass with no recipient is a slip that cannot
-- be chased, which is the only thing an issue register is for.
ALTER TABLE "stock_issues"
  ADD CONSTRAINT "chk_stock_issues_recipient"
  CHECK (
    (
      "issued_to_type" = 'DEPARTMENT'
      AND "issued_to_dept_id" IS NOT NULL
      AND "issued_to_person_id" IS NULL
      AND "issued_to_room" IS NULL
    )
    OR (
      "issued_to_type" = 'PERSON'
      AND "issued_to_person_type" IS NOT NULL
      AND "issued_to_person_id" IS NOT NULL
      AND "issued_to_dept_id" IS NULL
      AND "issued_to_room" IS NULL
    )
    OR (
      "issued_to_type" = 'ROOM'
      AND length(btrim(coalesce("issued_to_room", ''))) > 0
      AND "issued_to_dept_id" IS NULL
      AND "issued_to_person_id" IS NULL
    )
  );

-- Roadmap §6: "consumable returns ≤ issued". Without the upper bound a
-- department could return more chalk than it took and manufacture stock
-- out of a data-entry slip — the ledger would balance and the store would
-- be short.
ALTER TABLE "stock_issue_items"
  ADD CONSTRAINT "chk_stock_issue_items_returned"
  CHECK (
    "qty" > 0
    AND "returned_qty" >= 0
    AND "returned_qty" <= "qty"
  );
