import { describe, expect, it } from "vitest";
import { createRoleSchema } from "./rbac";

describe("createRoleSchema", () => {
  it("accepts a valid role", () => {
    const result = createRoleSchema.safeParse({
      name: "Exam Controller",
      slug: "exam-controller",
      description: "Runs exams",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-kebab-case slugs", () => {
    for (const slug of ["Exam", "exam_controller", "-exam", "exam-", "e xam"]) {
      expect(
        createRoleSchema.safeParse({ name: "Valid", slug }).success,
      ).toBe(false);
    }
  });

  it("rejects too-short names and allows empty description", () => {
    expect(
      createRoleSchema.safeParse({ name: "X", slug: "valid-slug" }).success,
    ).toBe(false);
    expect(
      createRoleSchema.safeParse({
        name: "Valid",
        slug: "valid-slug",
        description: "",
      }).success,
    ).toBe(true);
  });
});
