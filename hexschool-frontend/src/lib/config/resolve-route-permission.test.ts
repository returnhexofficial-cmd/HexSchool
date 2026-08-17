import { describe, expect, it } from "vitest";
import { ShieldCheck } from "lucide-react";
import {
  resolveRoutePermission,
  satisfiesMenuItem,
} from "./resolve-route-permission";
import { ADMIN_MENU, type AdminMenuItem } from "./admin-menu";

/**
 * Regression tests for QA finding F8 — admin routes rendered their full page
 * chrome for users who lacked the permission, because only the sidebar and the
 * data call were gated.
 */

const menu: AdminMenuItem[] = [
  { label: "Dashboard", href: "/admin", icon: ShieldCheck },
  {
    label: "Roles & Permissions",
    href: "/admin/roles",
    icon: ShieldCheck,
    permission: "role.view",
  },
  {
    label: "Examinations",
    href: "/admin/exams",
    icon: ShieldCheck,
    permission: "exam.view",
  },
  {
    label: "Reports",
    href: "/admin/reports",
    icon: ShieldCheck,
    anyOf: ["report.run", "report.schedule"],
  },
];

const holding = (...codes: string[]) => ({
  can: (...needed: string[]) => needed.every((c) => codes.includes(c)),
  canAny: (...needed: string[]) => needed.some((c) => codes.includes(c)),
});

describe("resolveRoutePermission", () => {
  it("matches the dashboard only on an exact path, never as a prefix", () => {
    expect(resolveRoutePermission("/admin", menu)?.label).toBe("Dashboard");
    // The bug this guards: "/admin" prefix-matching everything below it would
    // make every route permissionless.
    expect(resolveRoutePermission("/admin/roles", menu)?.label).toBe(
      "Roles & Permissions",
    );
  });

  it("resolves a nested route to its section, not to a shorter match", () => {
    expect(resolveRoutePermission("/admin/exams/types", menu)?.permission).toBe(
      "exam.view",
    );
  });

  it("resolves a dynamic detail route to its section", () => {
    expect(
      resolveRoutePermission(
        "/admin/roles/c4f06762-f902-435f-8b77-2394cdbfdddb",
        menu,
      )?.permission,
    ).toBe("role.view");
  });

  it("does not match a sibling route that merely shares a prefix", () => {
    // "/admin/rolesomething" must not match "/admin/roles".
    expect(resolveRoutePermission("/admin/rolesomething", menu)).toBeUndefined();
  });

  it("returns undefined for a route the menu does not declare", () => {
    expect(resolveRoutePermission("/admin/unknown-area", menu)).toBeUndefined();
  });
});

describe("satisfiesMenuItem", () => {
  it("refuses a route whose required code is not held", () => {
    const item = resolveRoutePermission("/admin/roles", menu);
    expect(satisfiesMenuItem(item, holding("library.view"))).toBe(false);
  });

  it("allows a route whose required code is held", () => {
    const item = resolveRoutePermission("/admin/roles", menu);
    expect(satisfiesMenuItem(item, holding("role.view"))).toBe(true);
  });

  it("treats anyOf as OR", () => {
    const item = resolveRoutePermission("/admin/reports", menu);
    expect(satisfiesMenuItem(item, holding("report.schedule"))).toBe(true);
    expect(satisfiesMenuItem(item, holding("student.view"))).toBe(false);
  });

  it("allows an undeclared route rather than locking users out of it", () => {
    // Failing open here is deliberate: the API is the authoritative gate, and
    // failing closed would black out any page missing a menu entry.
    expect(satisfiesMenuItem(undefined, holding())).toBe(true);
  });

  it("allows an item that declares no permission at all", () => {
    const item = resolveRoutePermission("/admin", menu);
    expect(satisfiesMenuItem(item, holding())).toBe(true);
  });
});

describe("against the real ADMIN_MENU", () => {
  it("resolves every declared menu href to itself", () => {
    for (const item of ADMIN_MENU) {
      expect(
        resolveRoutePermission(item.href)?.href,
        `${item.href} should resolve to its own menu entry`,
      ).toBe(item.href);
    }
  });

  it("gates /admin/roles behind role.view for a user who lacks it", () => {
    const item = resolveRoutePermission("/admin/roles");
    expect(item?.permission).toBe("role.view");
    expect(satisfiesMenuItem(item, holding("library.view"))).toBe(false);
  });
});
