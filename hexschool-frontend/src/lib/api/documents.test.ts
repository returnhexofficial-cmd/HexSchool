import { describe, expect, it } from "vitest";
import {
  ARCHIVE_LINK_LABELS,
  CERTIFICATE_STATUS_LABELS,
  CERTIFICATE_STATUS_VARIANT,
  CERTIFICATE_TYPES,
  CERTIFICATE_TYPE_LABELS,
  ISSUE_KIND_LABELS,
  type ArchiveLinkType,
  type CertificateIssueKind,
  type CertificateStatus,
} from "./documents";

const STATUSES: CertificateStatus[] = ["DRAFT", "ISSUED", "REVOKED"];
const KINDS: CertificateIssueKind[] = ["ORIGINAL", "DUPLICATE", "CORRECTION"];
const LINKS: ArchiveLinkType[] = [
  "STUDENT",
  "TEACHER",
  "STAFF",
  "CERTIFICATE",
];

describe("enum lists stay in step with the PG enums", () => {
  it("carries exactly the six certificate types", () => {
    // CUSTOM is the escape hatch a BD school always needs (a no-objection
    // letter, a bona-fide certificate). Dropping it here would push those
    // into TESTIMONIAL and corrupt the per-type numbering.
    expect(CERTIFICATE_TYPES).toEqual([
      "TRANSFER",
      "CHARACTER",
      "TESTIMONIAL",
      "PRIZE",
      "PARTICIPATION",
      "CUSTOM",
    ]);
  });

  it("labels every type", () => {
    for (const type of CERTIFICATE_TYPES) {
      expect(CERTIFICATE_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("labels every status and gives each a badge variant", () => {
    for (const status of STATUSES) {
      expect(CERTIFICATE_STATUS_LABELS[status]).toBeTruthy();
      expect(CERTIFICATE_STATUS_VARIANT[status]).toBeTruthy();
    }
  });

  it("shows a revoked certificate destructively, not as an ordinary state", () => {
    // A revoked certificate is still in somebody's hands; the register has
    // to read as an alarm rather than as one row among others.
    expect(CERTIFICATE_STATUS_VARIANT.REVOKED).toBe("destructive");
  });

  it("labels the three issue kinds", () => {
    for (const kind of KINDS) {
      expect(ISSUE_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("labels every archive link target", () => {
    for (const link of LINKS) {
      expect(ARCHIVE_LINK_LABELS[link]).toBeTruthy();
    }
  });
});
