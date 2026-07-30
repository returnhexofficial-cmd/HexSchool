import { describe, expect, it } from "vitest";
import {
  assignmentSchema,
  fileIssue,
  linkHostIssue,
  marksIssue,
  materialSchema,
  returnSchema,
  submitSchema,
} from "./assignment";

const UUID = "11111111-1111-4111-8111-111111111111";
const MB = 1024 * 1024;

const iso = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16);

const assignmentBase = {
  sessionId: UUID,
  sectionId: UUID,
  subjectId: UUID,
  type: "HOMEWORK" as const,
  title: "Newton's laws",
  instructions: "",
  assignedAt: iso(0),
  dueAt: iso(48),
  fullMarks: "20",
  allowLate: false,
};

describe("assignmentSchema", () => {
  it("accepts a well-formed assignment", () => {
    expect(assignmentSchema.safeParse(assignmentBase).success).toBe(true);
  });

  it("refuses a due date before the work is set", () => {
    const result = assignmentSchema.safeParse({
      ...assignmentBase,
      assignedAt: iso(48),
      dueAt: iso(24),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["dueAt"]);
    }
  });

  it("refuses a due date equal to the assigned date", () => {
    const same = iso(12);
    expect(
      assignmentSchema.safeParse({
        ...assignmentBase,
        assignedAt: same,
        dueAt: same,
      }).success,
    ).toBe(false);
  });

  it("refuses a title over 200 characters", () => {
    expect(
      assignmentSchema.safeParse({
        ...assignmentBase,
        title: "x".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("accepts an empty fullMarks — feedback-only work", () => {
    expect(
      assignmentSchema.safeParse({ ...assignmentBase, fullMarks: "" }).success,
    ).toBe(true);
  });

  it("refuses zero or negative full marks", () => {
    expect(
      assignmentSchema.safeParse({ ...assignmentBase, fullMarks: "0" }).success,
    ).toBe(false);
    expect(
      assignmentSchema.safeParse({ ...assignmentBase, fullMarks: "-5" }).success,
    ).toBe(false);
  });

  it("refuses a non-uuid section", () => {
    expect(
      assignmentSchema.safeParse({ ...assignmentBase, sectionId: "8B" }).success,
    ).toBe(false);
  });
});

describe("marksIssue", () => {
  it("accepts a mark inside the range, including the boundary", () => {
    expect(marksIssue(0, 20)).toBeNull();
    expect(marksIssue(20, 20)).toBeNull();
  });

  it("refuses a mark above full marks", () => {
    expect(marksIssue(21, 20)).toMatch(/exceed/i);
  });

  it("refuses a mark that only exceeds after rounding to two decimals", () => {
    expect(marksIssue(20.006, 20)).not.toBeNull();
    expect(marksIssue(20.004, 20)).toBeNull();
  });

  it("refuses a negative mark", () => {
    expect(marksIssue(-1, 20)).toMatch(/negative/i);
  });

  it("refuses any mark on ungraded work", () => {
    expect(marksIssue(5, null)).toMatch(/not graded/i);
  });

  it("treats an empty cell as no issue, not as zero", () => {
    expect(marksIssue(null, 20)).toBeNull();
    expect(marksIssue(undefined, 20)).toBeNull();
    expect(marksIssue(Number.NaN, 20)).toBeNull();
  });
});

describe("submitSchema", () => {
  it("accepts a text-only submission", () => {
    expect(submitSchema.safeParse({ textAnswer: "F = ma" }).success).toBe(true);
  });

  it("accepts a file-only submission", () => {
    expect(
      submitSchema.safeParse({
        textAnswer: "",
        attachments: [
          { key: "k", name: "essay.pdf", size: 100, contentType: "application/pdf" },
        ],
      }).success,
    ).toBe(true);
  });

  it("refuses an empty submission", () => {
    expect(submitSchema.safeParse({}).success).toBe(false);
    expect(submitSchema.safeParse({ textAnswer: "   " }).success).toBe(false);
  });
});

describe("returnSchema", () => {
  it("requires feedback", () => {
    expect(returnSchema.safeParse({ feedback: "" }).success).toBe(false);
    expect(returnSchema.safeParse({ feedback: "  " }).success).toBe(false);
    expect(
      returnSchema.safeParse({ feedback: "Redo part (b)." }).success,
    ).toBe(true);
  });
});

describe("materialSchema", () => {
  const base = {
    sessionId: UUID,
    classId: UUID,
    sectionId: "",
    subjectId: UUID,
    title: "Chapter 4 notes",
    description: "",
    linkUrl: "",
    files: [],
  };

  it("accepts a class-wide link material", () => {
    expect(
      materialSchema.safeParse({
        ...base,
        type: "VIDEO_URL",
        linkUrl: "https://www.youtube.com/watch?v=x",
      }).success,
    ).toBe(true);
  });

  it("refuses a link material with no URL", () => {
    const result = materialSchema.safeParse({ ...base, type: "LINK" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["linkUrl"]);
    }
  });

  it("refuses http, always", () => {
    expect(
      materialSchema.safeParse({
        ...base,
        type: "LINK",
        linkUrl: "http://youtube.com/x",
      }).success,
    ).toBe(false);
  });

  it("accepts a NOTE with a file", () => {
    expect(
      materialSchema.safeParse({
        ...base,
        type: "NOTE",
        files: [
          { key: "k", name: "notes.pdf", size: 10, contentType: "application/pdf" },
        ],
      }).success,
    ).toBe(true);
  });

  it("refuses a NOTE carrying neither a file nor a link", () => {
    const result = materialSchema.safeParse({ ...base, type: "NOTE" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["files"]);
    }
  });

  it("accepts a NOTE that is really a pointer, with just a link", () => {
    expect(
      materialSchema.safeParse({
        ...base,
        type: "NOTE",
        linkUrl: "https://drive.google.com/file/abc",
      }).success,
    ).toBe(true);
  });
});

describe("linkHostIssue", () => {
  const hosts = ["youtube.com", "youtu.be", "drive.google.com"];

  it("accepts an allow-listed host and its subdomains", () => {
    expect(linkHostIssue("https://youtube.com/x", hosts)).toBeNull();
    expect(linkHostIssue("https://www.youtube.com/x", hosts)).toBeNull();
  });

  it("refuses a look-alike host that merely contains an allowed one", () => {
    // Matched at a label boundary, not with `includes` — the same rule the
    // backend applies.
    expect(linkHostIssue("https://youtube.com.evil.test/x", hosts)).not.toBeNull();
    expect(linkHostIssue("https://notyoutube.com/x", hosts)).not.toBeNull();
  });

  it("treats an empty allow-list as any host", () => {
    expect(linkHostIssue("https://example.test/x", [])).toBeNull();
  });

  it("reports an unparseable URL", () => {
    expect(linkHostIssue("not a url", hosts)).toMatch(/valid URL/i);
  });
});

describe("fileIssue", () => {
  const limits = {
    maxBytes: 10 * MB,
    allowedTypes: ["pdf", "jpg", "png"] as const,
  };

  it("accepts an allowed type inside the limit", () => {
    expect(fileIssue({ name: "essay.pdf", size: 2 * MB }, limits)).toBeNull();
  });

  it("accepts a file of exactly the limit", () => {
    expect(fileIssue({ name: "scan.jpg", size: 10 * MB }, limits)).toBeNull();
  });

  it("refuses a disallowed extension, case-insensitively", () => {
    expect(fileIssue({ name: "payload.EXE", size: 10 }, limits)).toMatch(/exe/i);
  });

  it("refuses a file with no extension", () => {
    expect(fileIssue({ name: "homework", size: 10 }, limits)).not.toBeNull();
  });

  it("refuses an over-size file and names the limit", () => {
    expect(fileIssue({ name: "big.png", size: 11 * MB }, limits)).toMatch(
      /10 MB/,
    );
  });

  it("refuses an empty file", () => {
    expect(fileIssue({ name: "blank.pdf", size: 0 }, limits)).not.toBeNull();
  });
});
