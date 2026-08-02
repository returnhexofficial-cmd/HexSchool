import { z } from "zod";

/** Mirrors the backend Inventory & Assets DTOs (Module 24). */

export const ITEM_TYPE_VALUES = ["ASSET", "CONSUMABLE"] as const;
export const ITEM_UNIT_VALUES = [
  "PCS",
  "BOX",
  "REAM",
  "SET",
  "LITER",
  "KG",
  "OTHER",
] as const;
export const SUPPLIER_STATUS_VALUES = [
  "ACTIVE",
  "INACTIVE",
  "BLACKLISTED",
] as const;
export const ASSET_CONDITION_VALUES = [
  "NEW",
  "GOOD",
  "FAIR",
  "POOR",
  "UNSERVICEABLE",
] as const;
export const HOLDER_TYPE_VALUES = ["DEPARTMENT", "PERSON", "ROOM"] as const;
export const PERSON_TYPE_VALUES = ["TEACHER", "STAFF"] as const;

/** PROJECT_CONTEXT §12's BD mobile shape, mirrored from the DTO. */
export const BD_PHONE = /^01[3-9]\d{8}$/;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");
const optionalDate = z
  .string()
  .optional()
  .refine(
    (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Use the date picker (YYYY-MM-DD)",
  );

/**
 * The `NUMERIC(14,3)` contract, mirrored client-side (roadmap §7). More
 * than three decimals is not a rounding preference: Postgres would round
 * it on the way in and the balance the screen just showed would disagree
 * with the one the database stored.
 */
export const QTY_SCALE = 3;
const atMostThreeDecimals = (value: number) =>
  Math.round(value * 1000) / 1000 === value;

const quantity = z
  .number({ message: "Enter a quantity" })
  .positive("Must be more than zero")
  .refine(atMostThreeDecimals, "At most 3 decimal places");

const money = z
  .number({ message: "Enter an amount" })
  .min(0, "Cannot be negative")
  .refine(
    (value) => Math.round(value * 100) / 100 === value,
    "At most 2 decimal places",
  );

// ── suppliers ──────────────────────────────────────────────────────────

/**
 * Blacklisting carries a mandatory reason — the office refusing the next
 * delivery has to be able to say why. `chk_suppliers_shape` is the
 * database's copy of this rule; the form is where somebody can still fix
 * it.
 */
export const supplierSchema = z
  .object({
    name: z.string().trim().min(2, "At least 2 characters").max(160),
    contactPerson: z.string().trim().max(120).optional().or(z.literal("")),
    phone: z
      .string()
      .trim()
      .regex(BD_PHONE, "Enter a valid BD phone number")
      .optional()
      .or(z.literal("")),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
    address: z.string().trim().max(500).optional().or(z.literal("")),
    status: z.enum(SUPPLIER_STATUS_VALUES).optional(),
    statusReason: z.string().trim().max(500).optional().or(z.literal("")),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
  })
  .refine(
    (value) =>
      value.status !== "BLACKLISTED" || (value.statusReason ?? "").trim().length > 0,
    { message: "Say why they are blacklisted", path: ["statusReason"] },
  );

export type SupplierFormValues = z.infer<typeof supplierSchema>;

// ── categories ─────────────────────────────────────────────────────────

export const categorySchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120),
  nameBn: z.string().trim().max(120).optional().or(z.literal("")),
  parentId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;

// ── items ──────────────────────────────────────────────────────────────

/**
 * `packSize` is roadmap §8's `box_size`: how many BASE units are in one
 * pack. Zero is refused rather than treated as "no pack", because a pack
 * of zero would make a purchase of four boxes arrive as nothing — leave
 * the field empty for an unpacked item.
 */
export const itemSchema = z.object({
  code: z.string().trim().min(1, "Required").max(40),
  name: z.string().trim().min(2, "At least 2 characters").max(160),
  nameBn: z.string().trim().max(160).optional().or(z.literal("")),
  type: z.enum(ITEM_TYPE_VALUES, { message: "Choose asset or consumable" }),
  unit: z.enum(ITEM_UNIT_VALUES).optional(),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  packSize: z
    .number()
    .positive("A pack holds at least some of the base unit")
    .max(100000)
    .refine(atMostThreeDecimals, "At most 3 decimal places")
    .optional(),
  packLabel: z.string().trim().max(40).optional().or(z.literal("")),
  // Deliberately optional and NOT defaulted to 0 — an empty field means
  // "do not alert me about this item", which is not the same as zero.
  reorderLevel: z
    .number()
    .min(0, "Cannot be negative")
    .refine(atMostThreeDecimals, "At most 3 decimal places")
    .optional(),
});

export type ItemFormValues = z.infer<typeof itemSchema>;

// ── purchases ──────────────────────────────────────────────────────────

export const purchaseLineSchema = z.object({
  itemId: z.string().uuid("Pick an item"),
  qty: quantity,
  unitPrice: money,
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

export const purchaseSchema = z
  .object({
    supplierId: z.string().uuid().optional().or(z.literal("")),
    date: isoDate,
    invoiceRef: z.string().trim().max(80).optional().or(z.literal("")),
    remarks: z.string().trim().max(1000).optional().or(z.literal("")),
    lines: z
      .array(purchaseLineSchema)
      .min(1, "A delivery needs at least one line")
      .max(200, "Split a delivery larger than 200 lines"),
  })
  .refine(
    (value) =>
      new Set(value.lines.map((line) => line.itemId)).size === value.lines.length,
    {
      message: "An item may appear only once — combine the quantities",
      path: ["lines"],
    },
  );

export type PurchaseFormValues = z.infer<typeof purchaseSchema>;

export const receiveSchema = z.object({
  locationText: z.string().trim().max(160).optional().or(z.literal("")),
  custodianDeptId: z.string().uuid().optional().or(z.literal("")),
  warrantyUntil: optionalDate,
  condition: z.enum(ASSET_CONDITION_VALUES).optional(),
});

export type ReceiveFormValues = z.infer<typeof receiveSchema>;

/**
 * Cancelling a received delivery reverses stock the school may already
 * have issued, so "why" is the first question anybody reading the
 * register will ask.
 */
export const cancelPurchaseSchema = z.object({
  reason: z.string().trim().min(3, "Say why it is being cancelled").max(500),
});

// ── the holder shape, shared by issues and asset custody ───────────────

/**
 * One shape for "who has it". `chk_stock_issues_recipient` and
 * `chk_asset_units_custodian` are the database's copy; this is where the
 * clerk can still fix it, which is why the message names the field rather
 * than the constraint.
 */
export const holderSchema = z
  .object({
    type: z.enum(HOLDER_TYPE_VALUES),
    departmentId: z.string().uuid().optional().or(z.literal("")),
    personType: z.enum(PERSON_TYPE_VALUES).optional(),
    personId: z.string().uuid().optional().or(z.literal("")),
    room: z.string().trim().max(160).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.type === "DEPARTMENT" && !value.departmentId) {
      ctx.addIssue({
        code: "custom",
        message: "Choose the department",
        path: ["departmentId"],
      });
    }
    if (value.type === "PERSON" && (!value.personId || !value.personType)) {
      ctx.addIssue({
        code: "custom",
        message: "Choose the person",
        path: ["personId"],
      });
    }
    if (value.type === "ROOM" && !(value.room ?? "").trim()) {
      ctx.addIssue({ code: "custom", message: "Name the room", path: ["room"] });
    }
  });

export type HolderFormValues = z.infer<typeof holderSchema>;

// ── issues ─────────────────────────────────────────────────────────────

export const issueLineSchema = z.object({
  itemId: z.string().uuid("Pick an item"),
  qty: quantity,
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

export const issueSchema = z
  .object({
    issueDate: isoDate,
    issuedTo: holderSchema,
    purpose: z.string().trim().max(500).optional().or(z.literal("")),
    remarks: z.string().trim().max(1000).optional().or(z.literal("")),
    lines: z
      .array(issueLineSchema)
      .min(1, "An issue needs at least one item")
      .max(200),
  })
  .refine(
    (value) =>
      new Set(value.lines.map((line) => line.itemId)).size === value.lines.length,
    {
      message: "An item may appear only once on a slip",
      path: ["lines"],
    },
  );

export type IssueFormValues = z.infer<typeof issueSchema>;

export const returnSchema = z.object({
  lines: z
    .array(
      z.object({
        issueItemId: z.string().uuid(),
        qty: quantity,
      }),
    )
    .min(1, "Choose what is coming back"),
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

// ── adjustments ────────────────────────────────────────────────────────

/**
 * The caller sends **what is on the shelf**, not a delta — which is why
 * `countedQty` may legitimately be zero, and why the reason is mandatory
 * (roadmap §4 "permission + reason", pinned by
 * `chk_stock_ledger_reason`).
 */
export const adjustmentSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        countedQty: z
          .number()
          .min(0, "Cannot be negative")
          .refine(atMostThreeDecimals, "At most 3 decimal places"),
      }),
    )
    .min(1, "Count at least one item")
    .max(200),
  reason: z.string().trim().min(3, "Say why the ledger is being corrected").max(500),
});

export type AdjustmentFormValues = z.infer<typeof adjustmentSchema>;

// ── assets ─────────────────────────────────────────────────────────────

/** Roadmap §7: a warranty may not predate the purchase. */
export const assetSchema = z
  .object({
    itemId: z.string().uuid("Pick an asset item"),
    assetTag: z.string().trim().max(60).optional().or(z.literal("")),
    serialNo: z.string().trim().max(80).optional().or(z.literal("")),
    condition: z.enum(ASSET_CONDITION_VALUES).optional(),
    locationText: z.string().trim().max(160).optional().or(z.literal("")),
    purchasePrice: money.optional(),
    purchaseDate: optionalDate,
    warrantyUntil: optionalDate,
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
  })
  .refine(
    (value) =>
      !value.warrantyUntil ||
      !value.purchaseDate ||
      value.warrantyUntil >= value.purchaseDate,
    {
      message: "A warranty cannot end before the thing was bought",
      path: ["warrantyUntil"],
    },
  );

export type AssetFormValues = z.infer<typeof assetSchema>;

export const assignAssetSchema = z.object({
  custodian: holderSchema,
  locationText: z.string().trim().max(160).optional().or(z.literal("")),
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * A write-off carries a date, a reason and (server-side) the name of
 * whoever approved it — `chk_asset_units_disposal_evidence`.
 */
export const disposeAssetSchema = z.object({
  status: z.enum(["DISPOSED", "LOST"] as const),
  disposedAt: isoDate,
  reason: z.string().trim().min(3, "Say what happened to it").max(500),
});

export type DisposeFormValues = z.infer<typeof disposeAssetSchema>;
