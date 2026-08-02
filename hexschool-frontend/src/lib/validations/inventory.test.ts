import { describe, expect, it } from "vitest";
import {
  adjustmentSchema,
  assetSchema,
  cancelPurchaseSchema,
  categorySchema,
  disposeAssetSchema,
  holderSchema,
  issueSchema,
  itemSchema,
  purchaseSchema,
  supplierSchema,
} from "./inventory";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

describe("inventory validations", () => {
  describe("supplierSchema", () => {
    it("accepts a name on its own", () => {
      expect(supplierSchema.safeParse({ name: "Karim Traders" }).success).toBe(
        true,
      );
    });

    it("**refuses a blacklisting with no reason**", () => {
      // The office refusing their next delivery has to be able to say why —
      // `chk_suppliers_shape` is the database's copy of this rule.
      const result = supplierSchema.safeParse({
        name: "Karim Traders",
        status: "BLACKLISTED",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["statusReason"]);
      }
    });

    it("accepts a blacklisting that carries one", () => {
      expect(
        supplierSchema.safeParse({
          name: "Karim Traders",
          status: "BLACKLISTED",
          statusReason: "Short-delivered twice",
        }).success,
      ).toBe(true);
    });

    it("does not demand a reason for the other statuses", () => {
      expect(
        supplierSchema.safeParse({ name: "Karim", status: "INACTIVE" }).success,
      ).toBe(true);
    });

    it("refuses a non-BD phone", () => {
      expect(
        supplierSchema.safeParse({ name: "Karim", phone: "12345" }).success,
      ).toBe(false);
    });
  });

  describe("itemSchema", () => {
    const base = { code: "STA-1", name: "A4 Paper", type: "CONSUMABLE" as const };

    it("accepts the minimum an item needs", () => {
      expect(itemSchema.safeParse(base).success).toBe(true);
    });

    it("**refuses a pack size of zero**", () => {
      // A pack of zero makes a purchase of four boxes arrive as nothing.
      expect(itemSchema.safeParse({ ...base, packSize: 0 }).success).toBe(false);
      expect(itemSchema.safeParse({ ...base, packSize: -12 }).success).toBe(
        false,
      );
    });

    it("accepts a real pack size", () => {
      expect(itemSchema.safeParse({ ...base, packSize: 500 }).success).toBe(true);
    });

    it("allows a reorder level of zero, and allows omitting it entirely", () => {
      // These are different things: 0 means "tell me when it is empty",
      // omitted means "never tell me about this item".
      expect(itemSchema.safeParse({ ...base, reorderLevel: 0 }).success).toBe(
        true,
      );
      const omitted = itemSchema.safeParse(base);
      expect(omitted.success).toBe(true);
      if (omitted.success) expect(omitted.data.reorderLevel).toBeUndefined();
    });

    it("refuses a negative reorder level", () => {
      expect(itemSchema.safeParse({ ...base, reorderLevel: -1 }).success).toBe(
        false,
      );
    });

    it("refuses more than three decimals on a quantity field", () => {
      expect(
        itemSchema.safeParse({ ...base, reorderLevel: 1.2345 }).success,
      ).toBe(false);
    });
  });

  describe("purchaseSchema", () => {
    const line = { itemId: UUID, qty: 2, unitPrice: 300 };
    const base = { date: "2026-08-02", lines: [line] };

    it("accepts a delivery with one line", () => {
      expect(purchaseSchema.safeParse(base).success).toBe(true);
    });

    it("refuses a delivery with no lines", () => {
      expect(purchaseSchema.safeParse({ ...base, lines: [] }).success).toBe(
        false,
      );
    });

    it("**refuses the same item twice on one purchase**", () => {
      // `uq_purchase_items_identity` refuses it at the database too; here
      // the message can say to combine the quantities.
      const result = purchaseSchema.safeParse({
        ...base,
        lines: [line, { ...line, qty: 5 }],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/only once/);
      }
    });

    it("allows two different items", () => {
      expect(
        purchaseSchema.safeParse({
          ...base,
          lines: [line, { ...line, itemId: UUID2 }],
        }).success,
      ).toBe(true);
    });

    it("refuses a zero or negative quantity", () => {
      expect(
        purchaseSchema.safeParse({ ...base, lines: [{ ...line, qty: 0 }] })
          .success,
      ).toBe(false);
    });

    it("allows a price of zero — a donation still arrives", () => {
      expect(
        purchaseSchema.safeParse({
          ...base,
          lines: [{ ...line, unitPrice: 0 }],
        }).success,
      ).toBe(true);
    });

    it("refuses a negative price", () => {
      expect(
        purchaseSchema.safeParse({
          ...base,
          lines: [{ ...line, unitPrice: -1 }],
        }).success,
      ).toBe(false);
    });

    it("refuses a badly shaped date", () => {
      expect(purchaseSchema.safeParse({ ...base, date: "02/08/2026" }).success).toBe(
        false,
      );
    });
  });

  describe("holderSchema — the shared 'who has it' shape", () => {
    it("demands a department when the kind is DEPARTMENT", () => {
      const result = holderSchema.safeParse({ type: "DEPARTMENT" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["departmentId"]);
      }
    });

    it("demands both halves of a person", () => {
      expect(
        holderSchema.safeParse({ type: "PERSON", personId: UUID }).success,
      ).toBe(false);
      expect(
        holderSchema.safeParse({
          type: "PERSON",
          personId: UUID,
          personType: "TEACHER",
        }).success,
      ).toBe(true);
    });

    it("demands a room name that is not just spaces", () => {
      expect(holderSchema.safeParse({ type: "ROOM", room: "   " }).success).toBe(
        false,
      );
      expect(holderSchema.safeParse({ type: "ROOM", room: "Room 7" }).success).toBe(
        true,
      );
    });

    it("accepts a department", () => {
      expect(
        holderSchema.safeParse({ type: "DEPARTMENT", departmentId: UUID })
          .success,
      ).toBe(true);
    });
  });

  describe("issueSchema", () => {
    const base = {
      issueDate: "2026-08-02",
      issuedTo: { type: "ROOM" as const, room: "Room 7" },
      lines: [{ itemId: UUID, qty: 5 }],
    };

    it("accepts a slip", () => {
      expect(issueSchema.safeParse(base).success).toBe(true);
    });

    it("refuses an empty slip", () => {
      expect(issueSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    });

    it("refuses one item listed twice", () => {
      expect(
        issueSchema.safeParse({
          ...base,
          lines: [
            { itemId: UUID, qty: 5 },
            { itemId: UUID, qty: 3 },
          ],
        }).success,
      ).toBe(false);
    });

    it("carries the holder rules through", () => {
      expect(
        issueSchema.safeParse({
          ...base,
          issuedTo: { type: "DEPARTMENT" },
        }).success,
      ).toBe(false);
    });

    it("allows a fractional quantity — litres and kilos are real", () => {
      expect(
        issueSchema.safeParse({ ...base, lines: [{ itemId: UUID, qty: 0.5 }] })
          .success,
      ).toBe(true);
    });

    it("refuses more than three decimals", () => {
      expect(
        issueSchema.safeParse({ ...base, lines: [{ itemId: UUID, qty: 0.5001 }] })
          .success,
      ).toBe(false);
    });
  });

  describe("adjustmentSchema", () => {
    it("**demands a reason**", () => {
      // Roadmap §4: "permission + reason", pinned by
      // `chk_stock_ledger_reason`.
      expect(
        adjustmentSchema.safeParse({
          lines: [{ itemId: UUID, countedQty: 5 }],
        }).success,
      ).toBe(false);
      expect(
        adjustmentSchema.safeParse({
          lines: [{ itemId: UUID, countedQty: 5 }],
          reason: "ok",
        }).success,
      ).toBe(false);
    });

    it("accepts a real reason", () => {
      expect(
        adjustmentSchema.safeParse({
          lines: [{ itemId: UUID, countedQty: 5 }],
          reason: "March physical count",
        }).success,
      ).toBe(true);
    });

    it("**allows a counted quantity of zero** — the shelf can be empty", () => {
      expect(
        adjustmentSchema.safeParse({
          lines: [{ itemId: UUID, countedQty: 0 }],
          reason: "Everything used up",
        }).success,
      ).toBe(true);
    });

    it("refuses a negative count", () => {
      expect(
        adjustmentSchema.safeParse({
          lines: [{ itemId: UUID, countedQty: -1 }],
          reason: "Impossible",
        }).success,
      ).toBe(false);
    });
  });

  describe("assetSchema", () => {
    it("accepts a bare registration", () => {
      expect(assetSchema.safeParse({ itemId: UUID }).success).toBe(true);
    });

    it("**refuses a warranty that ends before the purchase** (roadmap §7)", () => {
      const result = assetSchema.safeParse({
        itemId: UUID,
        purchaseDate: "2026-06-01",
        warrantyUntil: "2026-01-01",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["warrantyUntil"]);
      }
    });

    it("accepts a warranty on the purchase date itself", () => {
      expect(
        assetSchema.safeParse({
          itemId: UUID,
          purchaseDate: "2026-06-01",
          warrantyUntil: "2026-06-01",
        }).success,
      ).toBe(true);
    });

    it("does not object when only one of the two dates is given", () => {
      expect(
        assetSchema.safeParse({ itemId: UUID, warrantyUntil: "2020-01-01" })
          .success,
      ).toBe(true);
    });
  });

  describe("disposeAssetSchema", () => {
    it("demands a date and a reason", () => {
      expect(
        disposeAssetSchema.safeParse({
          status: "DISPOSED",
          disposedAt: "2026-08-02",
        }).success,
      ).toBe(false);
    });

    it("accepts a complete write-off", () => {
      expect(
        disposeAssetSchema.safeParse({
          status: "LOST",
          disposedAt: "2026-08-02",
          reason: "Not found at the March count",
        }).success,
      ).toBe(true);
    });

    it("takes only DISPOSED or LOST", () => {
      expect(
        disposeAssetSchema.safeParse({
          status: "IN_STORE",
          disposedAt: "2026-08-02",
          reason: "Nope",
        }).success,
      ).toBe(false);
    });
  });

  describe("cancelPurchaseSchema", () => {
    it("demands a reason of some substance", () => {
      expect(cancelPurchaseSchema.safeParse({ reason: "x" }).success).toBe(false);
      expect(
        cancelPurchaseSchema.safeParse({ reason: "Wrong goods delivered" })
          .success,
      ).toBe(true);
    });
  });

  describe("categorySchema", () => {
    it("accepts a top-level category", () => {
      expect(categorySchema.safeParse({ name: "Stationery" }).success).toBe(true);
    });

    it("accepts a nested one", () => {
      expect(
        categorySchema.safeParse({ name: "Paper", parentId: UUID }).success,
      ).toBe(true);
    });

    it("refuses a one-character name", () => {
      expect(categorySchema.safeParse({ name: "S" }).success).toBe(false);
    });
  });
});
