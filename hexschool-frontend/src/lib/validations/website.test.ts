import { describe, expect, it } from "vitest";
import {
  careerApplySchema,
  cmsPageSchema,
  contactSchema,
  newsPostSchema,
  RESERVED_SLUGS,
  slugify,
  slugSchema,
  verifyStudentSchema,
} from "./website";

describe("website validations", () => {
  describe("slugSchema", () => {
    it("accepts kebab-case", () => {
      expect(slugSchema.safeParse("principal-message").success).toBe(true);
      expect(slugSchema.safeParse("class-9-routine").success).toBe(true);
    });

    it("rejects spaces, capitals and underscores", () => {
      for (const bad of ["About Us", "AboutUs", "about_us", "-about", "about-"]) {
        expect(slugSchema.safeParse(bad).success).toBe(false);
      }
    });

    it("rejects every reserved application segment", () => {
      // Mirrors the backend list; if one drifts, this fails loudly.
      for (const reserved of RESERVED_SLUGS) {
        expect(slugSchema.safeParse(reserved).success).toBe(false);
      }
    });
  });

  describe("slugify", () => {
    it.each([
      ["About Us", "about-us"],
      ["Class 9 — Routine (2026)", "class-9-routine-2026"],
      ["  Principal’s Message  ", "principal-s-message"],
    ])("%s → %s", (input, expected) => {
      expect(slugify(input)).toBe(expected);
    });

    it("returns empty for a Bangla-only title (the editor then asks for a slug)", () => {
      expect(slugify("শিক্ষক পরিচিতি")).toBe("");
    });
  });

  describe("cmsPageSchema", () => {
    it("requires a title and content", () => {
      expect(cmsPageSchema.safeParse({ title: "", content: "" }).success).toBe(
        false,
      );
    });

    it("accepts a page with no explicit slug (the server derives one)", () => {
      const result = cmsPageSchema.safeParse({
        title: "About Us",
        content: "<p>Hello</p>",
      });
      expect(result.success).toBe(true);
    });

    it("refuses a reserved slug before the request is sent", () => {
      const result = cmsPageSchema.safeParse({
        title: "Admin",
        content: "<p>x</p>",
        slug: "admin",
      });
      expect(result.success).toBe(false);
    });

    it("defaults to DRAFT", () => {
      const result = cmsPageSchema.parse({
        title: "T",
        content: "<p>c</p>",
      });
      expect(result.status).toBe("DRAFT");
    });
  });

  describe("newsPostSchema", () => {
    it("defaults the category to NEWS", () => {
      expect(
        newsPostSchema.parse({ title: "T", content: "<p>c</p>" }).category,
      ).toBe("NEWS");
    });
  });

  describe("contactSchema", () => {
    it("requires a phone or an email", () => {
      const result = contactSchema.safeParse({
        name: "Rafi",
        body: "Hello there",
      });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).toMatch(/phone number or an email/);
    });

    it("accepts a message with only a phone", () => {
      expect(
        contactSchema.safeParse({
          name: "Rafi",
          phone: "01712345678",
          body: "Hello there",
        }).success,
      ).toBe(true);
    });

    it("accepts a message with only an email", () => {
      expect(
        contactSchema.safeParse({
          name: "Rafi",
          email: "rafi@example.com",
          body: "Hello there",
        }).success,
      ).toBe(true);
    });

    it("rejects an invalid BD phone", () => {
      expect(
        contactSchema.safeParse({
          name: "Rafi",
          phone: "12345",
          body: "Hello there",
        }).success,
      ).toBe(false);
    });

    it("rejects a message that is too short", () => {
      expect(
        contactSchema.safeParse({
          name: "Rafi",
          phone: "01712345678",
          body: "hi",
        }).success,
      ).toBe(false);
    });
  });

  describe("careerApplySchema", () => {
    it("requires a phone number", () => {
      expect(careerApplySchema.safeParse({ name: "Rafi" }).success).toBe(false);
    });

    it("normalizes a +88-prefixed number", () => {
      const result = careerApplySchema.parse({
        name: "Rafi",
        phone: "+8801712345678",
      });
      expect(result.phone).toBe("01712345678");
    });
  });

  describe("verifyStudentSchema", () => {
    it("requires an identifier of a plausible length", () => {
      expect(verifyStudentSchema.safeParse({ identifier: "ab" }).success).toBe(
        false,
      );
      expect(
        verifyStudentSchema.safeParse({ identifier: "DS-202600001" }).success,
      ).toBe(true);
    });
  });
});
