import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function req(path: string, userType?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: userType ? { cookie: `hs_session=${userType}` } : {},
  });
}

function redirectTarget(res: Response): string | null {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
}

describe("proxy route guards", () => {
  it("anonymous → /login with next param", () => {
    const res = proxy(req("/admin"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/admin");
  });

  it("admin types reach /admin; portal types get bounced to /portal", () => {
    expect(proxy(req("/admin", "ADMIN")).headers.get("location")).toBeNull();
    expect(proxy(req("/admin", "STAFF")).headers.get("location")).toBeNull();
    expect(redirectTarget(proxy(req("/admin", "STUDENT")))).toBe("/portal");
    expect(redirectTarget(proxy(req("/admin", "PARENT")))).toBe("/portal");
  });

  it("portal types reach /portal; admin types get bounced to /admin", () => {
    expect(
      proxy(req("/portal", "STUDENT")).headers.get("location"),
    ).toBeNull();
    expect(redirectTarget(proxy(req("/portal", "ADMIN")))).toBe("/admin");
  });

  it("any authenticated type reaches /account pages", () => {
    expect(
      proxy(req("/account/sessions", "STUDENT")).headers.get("location"),
    ).toBeNull();
    expect(
      proxy(req("/account/sessions", "ADMIN")).headers.get("location"),
    ).toBeNull();
  });
});
