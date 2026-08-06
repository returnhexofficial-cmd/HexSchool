import { describe, expect, it } from "vitest";
import {
  archiveFileFormSchema,
  bulkPrizeSchema,
  folderSchema,
  issueSchema,
  legacySchema,
  reissueSchema,
  revokeSchema,
  templateSchema,
  verifyCodeSchema,
} from "./document";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("templateSchema", () => {
  it("accepts a minimal layout", () => {
    expect(
      templateSchema.safeParse({
        type: "TRANSFER",
        name: "Standard",
        bodyHtml: "<p>{{student_name}}</p>",
      }).success,
    ).toBe(true);
  });

  it("insists on a type — a layout prints one kind of certificate", () => {
    expect(
      templateSchema.safeParse({ name: "Standard", bodyHtml: "<p>x</p>" })
        .success,
    ).toBe(false);
  });

  it("refuses a type the PG enum does not carry", () => {
    expect(
      templateSchema.safeParse({
        type: "DIPLOMA",
        name: "Standard",
        bodyHtml: "<p>x</p>",
      }).success,
    ).toBe(false);
  });

  it("refuses an empty body — a blank page over the school's stationery", () => {
    expect(
      templateSchema.safeParse({
        type: "TRANSFER",
        name: "Standard",
        bodyHtml: "",
      }).success,
    ).toBe(false);
  });

  it("caps the signatory block at what fits on a page", () => {
    const signatories = Array.from({ length: 7 }, (_, i) => ({
      name: `Signer ${i}`,
    }));
    expect(
      templateSchema.safeParse({
        type: "TRANSFER",
        name: "Standard",
        bodyHtml: "<p>x</p>",
        signatories,
      }).success,
    ).toBe(false);
  });
});

describe("issueSchema", () => {
  it("accepts an issue for a student", () => {
    expect(
      issueSchema.safeParse({ studentId: uuid, type: "CHARACTER" }).success,
    ).toBe(true);
  });

  it("needs a real student id", () => {
    expect(
      issueSchema.safeParse({ studentId: "not-a-uuid", type: "CHARACTER" })
        .success,
    ).toBe(false);
  });

  /**
   * Mirrors the DTO's `@MinLength(10)`. The override reason is the audit
   * trail's only record of WHY a certificate went out over unpaid fees;
   * "ok" recorded against a name is worse than nothing, because it looks
   * like a decision was documented.
   */
  it("refuses a one-word override reason", () => {
    expect(
      issueSchema.safeParse({
        studentId: uuid,
        type: "TRANSFER",
        clearanceOverrideReason: "ok",
      }).success,
    ).toBe(false);
  });

  it("accepts a sentence", () => {
    expect(
      issueSchema.safeParse({
        studentId: uuid,
        type: "TRANSFER",
        clearanceOverrideReason: "Family settled in cash at the office, rcpt 4471",
      }).success,
    ).toBe(true);
  });

  it("treats an empty override reason as absent", () => {
    expect(
      issueSchema.safeParse({
        studentId: uuid,
        type: "TRANSFER",
        clearanceOverrideReason: "",
      }).success,
    ).toBe(true);
  });
});

describe("revokeSchema", () => {
  it("insists on a sentence — the reason is published", () => {
    expect(revokeSchema.safeParse({ reason: "wrong" }).success).toBe(false);
    expect(
      revokeSchema.safeParse({
        reason: "Name corrected and reissued as TC-26-0031",
      }).success,
    ).toBe(true);
  });
});

describe("reissueSchema", () => {
  it("accepts the two re-issue kinds", () => {
    expect(reissueSchema.safeParse({ kind: "DUPLICATE" }).success).toBe(true);
    expect(reissueSchema.safeParse({ kind: "CORRECTION" }).success).toBe(true);
  });

  it("refuses ORIGINAL — a re-issue is never an original", () => {
    expect(reissueSchema.safeParse({ kind: "ORIGINAL" }).success).toBe(false);
  });
});

describe("legacySchema", () => {
  it("accepts a pre-system certificate with its own number", () => {
    expect(
      legacySchema.safeParse({
        studentId: uuid,
        type: "TRANSFER",
        certificateNo: "TC / 2011 / 0042",
        issueDate: "2011-03-14",
      }).success,
    ).toBe(true);
  });

  it("needs a number — that is the whole point of a backfill", () => {
    expect(
      legacySchema.safeParse({
        studentId: uuid,
        type: "TRANSFER",
        certificateNo: "",
        issueDate: "2011-03-14",
      }).success,
    ).toBe(false);
  });

  it("refuses a date that is not a date", () => {
    expect(
      legacySchema.safeParse({
        studentId: uuid,
        type: "TRANSFER",
        certificateNo: "TC-11-0042",
        issueDate: "14/03/2011",
      }).success,
    ).toBe(false);
  });
});

describe("bulkPrizeSchema", () => {
  it("accepts a top-3 run", () => {
    expect(bulkPrizeSchema.safeParse({ examId: uuid, topN: 3 }).success).toBe(
      true,
    );
  });

  it("refuses a zero or negative cut", () => {
    expect(bulkPrizeSchema.safeParse({ examId: uuid, topN: 0 }).success).toBe(
      false,
    );
    expect(bulkPrizeSchema.safeParse({ examId: uuid, topN: -1 }).success).toBe(
      false,
    );
  });

  it("caps the cut, mirroring the DTO", () => {
    expect(bulkPrizeSchema.safeParse({ examId: uuid, topN: 21 }).success).toBe(
      false,
    );
  });

  it("refuses a fractional position", () => {
    expect(bulkPrizeSchema.safeParse({ examId: uuid, topN: 2.5 }).success).toBe(
      false,
    );
  });
});

describe("folderSchema", () => {
  it("accepts a root folder", () => {
    expect(folderSchema.safeParse({ name: "Circulars" }).success).toBe(true);
  });

  it("refuses a blank name — a node the tree cannot render", () => {
    expect(folderSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("archiveFileFormSchema", () => {
  const base = {
    folderId: uuid,
    title: "Board circular",
    fileUrl: "archive/a.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
  };

  it("accepts an unlinked document — most of a cabinet is about nobody", () => {
    expect(archiveFileFormSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a fully linked document", () => {
    expect(
      archiveFileFormSchema.safeParse({
        ...base,
        linkedType: "STUDENT",
        linkedId: uuid,
      }).success,
    ).toBe(true);
  });

  /**
   * Mirrors `chk_archive_files_link`: a file recorded against a type with
   * no id is invisible to every "documents of this student" query while
   * still claiming to belong to one — worse than an unfiled document,
   * because nobody goes looking for it.
   */
  it("refuses half a link either way", () => {
    expect(
      archiveFileFormSchema.safeParse({ ...base, linkedType: "STUDENT" })
        .success,
    ).toBe(false);
    expect(
      archiveFileFormSchema.safeParse({ ...base, linkedId: uuid }).success,
    ).toBe(false);
  });

  it("refuses a zero-byte document", () => {
    expect(
      archiveFileFormSchema.safeParse({ ...base, sizeBytes: 0 }).success,
    ).toBe(false);
  });
});

describe("verifyCodeSchema", () => {
  it("accepts a code typed off a printed page", () => {
    expect(verifyCodeSchema.safeParse({ code: "4KJ7M2QX9B" }).success).toBe(
      true,
    );
  });

  it("accepts one with the printed dashes still in it", () => {
    // The server normalizes separators and case; the form must not be the
    // thing that rejects a correctly-read certificate.
    expect(verifyCodeSchema.safeParse({ code: "4kj7-m2qx-9b" }).success).toBe(
      true,
    );
  });

  it("trims surrounding whitespace from a paste", () => {
    const parsed = verifyCodeSchema.safeParse({ code: "  4KJ7M2QX9B  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("4KJ7M2QX9B");
  });

  it("refuses an empty code", () => {
    expect(verifyCodeSchema.safeParse({ code: "   " }).success).toBe(false);
  });
});
