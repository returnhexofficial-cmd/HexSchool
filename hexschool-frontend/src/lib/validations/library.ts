import { z } from "zod";

/** Mirrors the backend Library Management DTOs (Module 23). */

export const BOOK_CONDITION_VALUES = [
  "NEW",
  "GOOD",
  "FAIR",
  "POOR",
  "DAMAGED",
] as const;

export const MEMBER_TYPE_VALUES = ["STUDENT", "TEACHER", "STAFF"] as const;
export const MEMBER_STATUS_VALUES = [
  "ACTIVE",
  "SUSPENDED",
  "CLOSED",
] as const;
export const WRITE_OFF_VALUES = ["LOST", "DAMAGED", "WITHDRAWN"] as const;

/**
 * ISBN-10 / ISBN-13 **checksum**, mirroring `isbn.util.ts` on the server.
 *
 * Mirrored rather than shared because the form has to say "that check
 * digit is wrong" while the librarian is still looking at the book — a
 * round trip to find out is a round trip too late. A blank ISBN is legal
 * and common: most of a BD school library has none, which is why
 * `books.isbn` is nullable and not unique.
 */
export function isbnChecksumOk(raw: string): boolean {
  const value = raw.replace(/[\s-]/g, "").toUpperCase();

  if (/^\d{9}[\dX]$/.test(value)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const ch = value[i];
      sum += (ch === "X" ? 10 : Number(ch)) * (10 - i);
    }
    return sum % 11 === 0;
  }

  if (/^\d{13}$/.test(value)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
    return sum % 10 === 0;
  }

  return false;
}

export const isbnField = z
  .string()
  .optional()
  .refine(
    (value) => !value || value.trim() === "" || isbnChecksumOk(value),
    "That ISBN's check digit does not match — leave it blank if the book has no ISBN",
  );

export const categorySchema = z.object({
  name: z.string().min(2, "At least 2 characters").max(120),
  nameBn: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
});

export const authorSchema = z.object({
  name: z.string().min(2, "At least 2 characters").max(160),
  nameBn: z.string().max(160).optional(),
  note: z.string().max(1000).optional(),
});

export const publisherSchema = z.object({
  name: z.string().min(2, "At least 2 characters").max(160),
  nameBn: z.string().max(160).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().max(160).optional(),
  address: z.string().max(500).optional(),
});

export const bookSchema = z.object({
  title: z.string().min(2, "At least 2 characters").max(250),
  titleBn: z.string().max(250).optional(),
  isbn: isbnField,
  categoryId: z.string().uuid("Pick a category"),
  publisherId: z.string().uuid().optional().or(z.literal("")),
  authorNames: z.string().max(600).optional(),
  edition: z.string().max(60).optional(),
  language: z.string().max(40).optional(),
  // No NaN-stripping transform here, deliberately: a schema whose input
  // and output types differ cannot be handed straight to
  // `zodResolver` without the form's generics diverging. The empty box
  // is turned into `undefined` at the input instead (`setValueAs`).
  price: z.number().min(0).optional(),
  coverUrl: z.string().max(500).optional(),
  rackNo: z.string().max(40).optional(),
  description: z.string().max(5000).optional(),
});

export type BookFormValues = z.infer<typeof bookSchema>;

export const generateCopiesSchema = z.object({
  count: z
    .number({ message: "How many copies?" })
    .int()
    .min(1, "At least one")
    // The server caps a batch at 200 for the same reason: an unbounded
    // loop claiming sequence numbers inside one transaction is how a
    // request times out holding a row lock.
    .max(200, "At most 200 at a time — run a second batch"),
  condition: z.enum(BOOK_CONDITION_VALUES).optional(),
  purchasePrice: z
    .union([z.number().min(0), z.nan()])
    .optional()
    .transform((value) => (Number.isNaN(value) ? undefined : value)),
});

export const markCopySchema = z.object({
  status: z.enum(WRITE_OFF_VALUES),
  reason: z.string().min(3, "Say what happened — it goes on the record").max(1000),
  fineAmount: z
    .union([z.number().min(0), z.nan()])
    .optional()
    .transform((value) => (Number.isNaN(value) ? undefined : value)),
});

export const waiveFineSchema = z.object({
  amount: z
    .union([z.number().min(0.01), z.nan()])
    .optional()
    .transform((value) => (Number.isNaN(value) ? undefined : value)),
  reason: z
    .string()
    .min(3, "A waiver needs a reason — the database refuses one without it")
    .max(1000),
});

export const collectFineSchema = z.object({
  amount: z
    .union([z.number().min(0.01), z.nan()])
    .optional()
    .transform((value) => (Number.isNaN(value) ? undefined : value)),
  remarks: z.string().max(500).optional(),
});

export const returnSchema = z.object({
  condition: z.enum(BOOK_CONDITION_VALUES).optional(),
  conditionNote: z.string().max(1000).optional(),
  fineOverride: z
    .union([z.number().min(0), z.nan()])
    .optional()
    .transform((value) => (Number.isNaN(value) ? undefined : value)),
  fineReason: z.string().max(1000).optional(),
  collectFine: z.boolean().optional(),
});

/**
 * Mirrors the server's rule that a hand-set fine carries a reason. It is
 * the same reasoning the DB applies to a waiver: a figure with no
 * explanation beside it is indistinguishable from a mistake.
 */
export const returnFormSchema = returnSchema.refine(
  (value) =>
    value.fineOverride === undefined ||
    (value.fineReason?.trim().length ?? 0) > 0,
  {
    path: ["fineReason"],
    message: "A hand-set fine needs a reason",
  },
);

export const enrolMemberSchema = z.object({
  personType: z.enum(MEMBER_TYPE_VALUES),
  personId: z.string().uuid("Pick a person"),
  maxBooks: z
    .union([z.number().int().min(1).max(100), z.nan()])
    .optional()
    .transform((value) => (Number.isNaN(value) ? undefined : value)),
});

export const updateMemberSchema = z.object({
  maxBooks: z
    .union([z.number().int().min(1).max(100), z.nan()])
    .optional()
    .transform((value) => (Number.isNaN(value) ? undefined : value)),
  status: z.enum(MEMBER_STATUS_VALUES).optional(),
  statusReason: z.string().max(1000).optional(),
});

export const stockCheckSchema = z.object({
  name: z.string().min(2, "Name the count").max(160),
  rackNo: z.string().max(40).optional(),
});

/**
 * Turns the author box's free text into the array the API takes. A
 * librarian cataloguing at speed types "Humayun Ahmed, Zafar Iqbal" and
 * expects both to exist afterwards — the server creates any name it does
 * not already hold.
 */
export function splitAuthorNames(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .slice(0, 10);
}
